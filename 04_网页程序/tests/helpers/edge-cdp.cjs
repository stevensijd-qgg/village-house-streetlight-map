const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, execFileSync } = require("node:child_process");

const WEB_ROOT = path.resolve(__dirname, "..", "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PAGE_READY_TIMEOUT_MS = 20000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function contentType(file) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  })[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname
    ).replace(/^[/\\]+/, "");
    const target = path.resolve(WEB_ROOT, pathname || "index.html");
    if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(target, (error, bytes) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": contentType(target) });
      response.end(bytes);
    });
  });
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve(server))
  );
}

async function waitUntil(read, timeoutMs, description) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`等待${description}超时`);
}

class CdpPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.exceptions.push(message.params);
      }
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "浏览器表达式执行失败"
      );
    }
    return result.result ? result.result.value : undefined;
  }

  async setFileInput(selector, absolutePath) {
    const { root } = await this.call("DOM.getDocument", { depth: -1 });
    const { nodeId } = await this.call("DOM.querySelector", {
      nodeId: root.nodeId, selector,
    });
    if (!nodeId) throw new Error(`找不到文件输入框：${selector}`);
    await this.call("DOM.setFileInputFiles", {
      nodeId, files: [path.resolve(absolutePath)],
    });
  }

  async waitFor(expression, timeoutMs = 5000) {
    let lastEvaluationError = null;
    try {
      await waitUntil(
        async () => {
          try {
            return await this.evaluate(`Boolean(${expression})`);
          } catch (error) {
            // 导航切换执行上下文时 CDP 可能短暂拒绝求值；新文档就绪后继续检查同一条件。
            lastEvaluationError = error;
            return false;
          }
        },
        timeoutMs,
        expression
      );
    } catch (error) {
      if (lastEvaluationError) {
        error.message += `；最后一次浏览器求值错误：${lastEvaluationError.message}`;
      }
      throw error;
    }
  }

  async navigate(pageUrl, readyExpression, timeoutMs = PAGE_READY_TIMEOUT_MS) {
    const sentinel = `edge-navigation-${Date.now()}-${Math.random()}`;
    await this.evaluate(
      `window.__edgeNavigationSentinel = ${JSON.stringify(sentinel)}; true`
    );
    const result = await this.call("Page.navigate", { url: pageUrl });
    if (result.errorText) throw new Error(`Page.navigate: ${result.errorText}`);
    await this.waitFor(
      `window.__edgeNavigationSentinel !== ${JSON.stringify(sentinel)} && ` +
      `location.href === ${JSON.stringify(pageUrl)} && ` +
      `document.readyState === "complete" && (${readyExpression})`,
      timeoutMs
    );
  }

  async reload(readyExpression = "true", timeoutMs = PAGE_READY_TIMEOUT_MS) {
    const sentinel = `edge-reload-${Date.now()}-${Math.random()}`;
    await this.evaluate(
      `window.__edgeReloadSentinel = ${JSON.stringify(sentinel)}; true`
    );
    await this.call("Page.reload");
    await this.waitFor(
      `window.__edgeReloadSentinel !== ${JSON.stringify(sentinel)} && ` +
      `document.readyState === "complete" && (${readyExpression})`,
      timeoutMs
    );
  }
}

async function connectPage(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const page = new CdpPage(socket);
  await page.call("Runtime.enable");
  await page.call("DOM.enable");
  await page.call("Page.enable");
  return page;
}

const PROFILE_PREFIX = "heqiao-edge-";

// Edge 的浏览器、GPU、崩溃上报等进程不一定是 spawn 出来的那个进程的子进程，
// 只 kill 启动进程会留下整组无界面 Edge，持续占用临时 profile（打印测试每个约 800MB）。
// 按命令行里的 profile 路径精确结束本测试启动的进程，不碰用户自己的 Edge。
function killProfileProcesses(profile) {
  if (process.platform !== "win32") return;
  const needle = profile.replace(/'/g, "''");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | " +
      `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ` +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
      { stdio: "ignore", windowsHide: true, timeout: 20000 });
  } catch (error) {}
}

// 清理失败只告警，不能把已经通过的测试误判为失败。
function removeProfile(profile) {
  killProfileProcesses(profile);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  } catch (error) {
    console.warn(`临时浏览器目录暂未删除，可稍后手动清理：${profile}（${error.code}）`);
  }
}

// 上次异常中断留下的、超过 1 小时的测试 profile 顺手清掉，避免越积越多占满系统盘
function removeStaleProfiles() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) removeProfile(dir);
    } catch (error) {}
  }
}

async function withLaunchedPage(pageUrl, readyExpression, callback) {
  if (!fs.existsSync(EDGE)) throw new Error(`未找到 Edge：${EDGE}`);
  removeStaleProfiles();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const child = spawn(EDGE, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--disk-cache-size=1048576",
    "--no-first-run",
    "--disable-gpu",
    "--no-sandbox",
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let page;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    const port = await waitUntil(() => {
      if (!fs.existsSync(portFile)) return null;
      const first = fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0];
      return /^\d+$/.test(first) ? Number(first) : null;
    }, 10000, "Edge 调试端口");
    const target = await waitUntil(async () => {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then(response => response.json());
      return targets.find(item => item.type === "page" && item.url === "about:blank");
    }, 10000, "网页调试目标");
    page = await connectPage(target.webSocketDebuggerUrl);
    await page.navigate(pageUrl, readyExpression);
    await callback(page);
  } finally {
    if (page) {
      await page.call("Browser.close").catch(() => {});
      page.socket.close();
    }
    if (!child.killed) child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) resolve();
      else {
        child.once("exit", resolve);
        setTimeout(resolve, 5000);
      }
    });
    removeProfile(profile);
  }
}

async function withBrowserPage(relativeUrl, callback) {
  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  const pageUrl = new URL(relativeUrl, baseUrl).href;
  const readyExpression = new URL(pageUrl).pathname.endsWith("/index.html")
    ? `typeof RoadData !== "undefined" &&
       typeof AreaData !== "undefined" &&
       typeof bigPrint === "function"`
    : "true";
  try {
    await withLaunchedPage(pageUrl, readyExpression, callback);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function withFileBrowserPage(relativeUrl, callback) {
  const target = path.resolve(WEB_ROOT, relativeUrl);
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) {
    throw new Error("file:// 测试路径超出网页目录");
  }
  const pageUrl = pathToFileURL(target).href;
  const readyExpression = path.basename(target).toLowerCase() === "index.html"
    ? `typeof RoadData !== "undefined" &&
       typeof AreaData !== "undefined" &&
       typeof bigPrint === "function"`
    : "true";
  await withLaunchedPage(pageUrl, readyExpression, callback);
}

module.exports = { withBrowserPage, withFileBrowserPage };

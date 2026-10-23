# Road Streetlight Data Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让道路的路灯标记和盏数可靠进入导出文件，并可从任意目录安全载入，同时恢复何桥村标准数据和正确的村名存档隔离。

**Architecture:** 新增一个无依赖的 `road-data.js`，集中负责道路规范化、安全解析、汇总和序列化；现有 `index.html` 继续承担地图和交互，只调用该小模块。Node 原生测试直接执行真实数据模块，临时 Edge + CDP 测试执行真实页面、文件选择、localStorage、统计和打印，不增加 npm 或构建步骤。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Leaflet 本地副本、Node.js 24 内置 `node:test`/HTTP/WebSocket、Microsoft Edge 无头模式、Git。

**Status:** 已完成。035 实施主体通过；036 完成终审发现的原型保留名、导入事务、
导出对象身份、刷新等待、`file://` 与真实打印回归加固。

## Global Constraints

- 标准道路来源固定为 `04_网页程序/road/roads-路灯标注版.js`。
- 标准结果固定为 51 条道路、51 条 `lamped: true`、48 条正数记录、合计 597 盏。
- `路灯4`、`路灯21补充`、`路灯25补充` 的 `lamps` 规范化为 `0`，不得推测补数。
- 道路坐标保持 GCJ-02；不得混入或转换为 BD-09。
- 保持双击打开、离线优先、手机兼容；不得新增必须安装的包或构建步骤。
- 选择文件时不得使用 `eval`、`Function`、动态 `<script>` 或其他代码执行方式。
- 浏览器存档只读取 `roadData_<当前村名>` 精确键，不自动复制其他村的数据。
- 覆盖道路前必须提示先导出备份；取消或校验失败不得改变现有道路。
- `data.js` 仍由 Excel 经数据更新工具生成；本次修正当前生成结果时必须同步修正工具源头。
- 用户姓名、电话、照片属于敏感资料；测试输出不得打印这些内容。
- `05_成品图/` 下 4 份未跟踪 PDF 不得修改、删除或加入 Git。
- 不大规模拆分 `index.html`，不改变现有打印档入口。

## File Map

**Create**

- `04_网页程序/road-data.js`：道路文件的纯数据边界；导出浏览器全局 `RoadData`，Node 下导出 CommonJS API。
- `04_网页程序/tests/road-data.test.cjs`：解析、规范化、校验、汇总、序列化单元测试。
- `04_网页程序/tests/helpers/edge-cdp.cjs`：仅供测试使用的临时 HTTP、Edge 和 CDP 驱动器。
- `04_网页程序/tests/fixtures/roads-with-lamps.js`：改名/子目录导入的合法道路文件。
- `04_网页程序/tests/fixtures/roads-with-code.js`：验证不会执行任意 JavaScript 的恶意样例。
- `04_网页程序/tests/browser-road-portability.test.cjs`：真实页面导入、导出、持久化和存档隔离测试。
- `04_网页程序/tests/data-tool.test.cjs`：真实数据更新工具的空村名和正确村名测试。
- `04_网页程序/tests/project-regression.test.cjs`：标准数据、语法和 DOM 静态回归。

**Modify**

- `04_网页程序/index.html`：载入数据模块、文件选择控件、导入/导出流程、精确 localStorage 读取。
- `04_网页程序/roads.js`：替换为规范化后的 51 条标准道路。
- `04_网页程序/data.js`：当前生成结果村名从“示例村”恢复为“何桥村”。
- `04_网页程序/数据更新工具.html`：空村名时阻止生成。
- `README.md`：更新道路操作和当前数据基线。
- `04_网页程序/使用说明.txt`：更新导出、选择文件载入和一次性迁移步骤。
- `04_网页程序/换电脑迁移说明.txt`：更新跨设备道路恢复方法。
- `项目说明.md`：补充 `road-data.js` 数据边界和精确村名存档规则。
- `docs/superpowers/specs/2026-07-27-road-streetlight-portability-design.md`：实施完成后更新状态。
- `项目日志.md`：增加 035 实施记录。
- `对话交接记录.md`：增加最终代码、测试、Git 和遗留事项。

---

### Task 1: 建立可测试的道路文件数据边界

**Files:**

- Create: `04_网页程序/tests/road-data.test.cjs`
- Create: `04_网页程序/road-data.js`

**Interfaces:**

- Consumes: 普通 JavaScript 道路对象数组和网页导出的 UTF-8 文本。
- Produces:
  - `RoadData.normalizeRoads(value: unknown): Road[]`
  - `RoadData.parseRoadsFile(text: string): Road[]`
  - `RoadData.summarizeRoads(roads: Road[]): {roadCount, lampedCount, positiveLampCount, lampTotal}`
  - `RoadData.serializeRoadsFile(roads: Road[], villageName: string): string`
- `Road` 的输出字段固定为
  `{id, name, type, width, pts, lamped, lamps}`，其中 `pts` 为 `[lat, lng][]`。

- [x] **Step 1: 写入会失败的真实行为测试**

先只创建测试文件。测试加载不到尚未存在的模块时使用空对象，使 RED 表现为明确的
断言失败，而不是测试框架启动错误：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modulePath = path.join(__dirname, "..", "road-data.js");
const api = fs.existsSync(modulePath) ? require(modulePath) : {};

const validText = `// 何桥村道路数据
// 导出说明
const ROADS = [
  {"id":"R1","name":"一号路","type":"柏油路","width":5,
   "pts":[[28.4,112.89],[28.41,112.9]],"lamped":true,"lamps":7},
  {"id":"R2","name":"二号路","type":"水泥路","width":4,
   "pts":[[28.42,112.91],[28.43,112.92]],"lamped":true}
];`;

test("解析导出文件并把缺失路灯数规范化为零", () => {
  assert.equal(typeof api.parseRoadsFile, "function", "parseRoadsFile 尚未实现");
  const roads = api.parseRoadsFile(validText);
  assert.deepEqual(
    roads.map(r => ({ id: r.id, lamped: r.lamped, lamps: r.lamps })),
    [
      { id: "R1", lamped: true, lamps: 7 },
      { id: "R2", lamped: true, lamps: 0 },
    ]
  );
});

test("正数盏数会把缺失或 false 的亮化标记统一为 true", () => {
  assert.equal(typeof api.normalizeRoads, "function", "normalizeRoads 尚未实现");
  const roads = api.normalizeRoads([{
    id: "R3", name: "三号路", type: "水泥路", width: 5,
    pts: [[28.4, 112.89], [28.41, 112.9]], lamped: false, lamps: 3,
  }]);
  assert.deepEqual(
    { lamped: roads[0].lamped, lamps: roads[0].lamps },
    { lamped: true, lamps: 3 }
  );
});

test("null 和空字符串盏数按零处理且旧路灯线保持亮化", () => {
  const roads = api.normalizeRoads([
    {
      id: "R4", name: "四号路", type: "路灯线", width: 5,
      pts: [[28.4, 112.89], [28.41, 112.9]], lamps: null,
    },
    {
      id: "R5", name: "五号路", type: "水泥路", width: 5,
      pts: [[28.4, 112.89], [28.41, 112.9]], lamps: "",
    },
  ]);
  assert.deepEqual(
    roads.map(r => ({ lamped: r.lamped, lamps: r.lamps })),
    [{ lamped: true, lamps: 0 }, { lamped: false, lamps: 0 }]
  );
});

test("汇总道路、有灯路段、正数记录和总盏数", () => {
  assert.equal(typeof api.summarizeRoads, "function", "summarizeRoads 尚未实现");
  const roads = api.parseRoadsFile(validText);
  assert.deepEqual(api.summarizeRoads(roads), {
    roadCount: 2, lampedCount: 2, positiveLampCount: 1, lampTotal: 7,
  });
});

test("序列化后每条道路都有显式 lamped 和 lamps 且能重新解析", () => {
  assert.equal(typeof api.serializeRoadsFile, "function", "serializeRoadsFile 尚未实现");
  const text = api.serializeRoadsFile(api.parseRoadsFile(validText), "何桥村\n注入");
  assert.match(text, /^\/\/ 何桥村 注入道路数据/m);
  assert.doesNotMatch(text, /\n注入道路数据/);
  const roundTrip = api.parseRoadsFile(text);
  assert.equal(roundTrip.every(r => typeof r.lamped === "boolean"), true);
  assert.equal(roundTrip.every(r => Number.isInteger(r.lamps) && r.lamps >= 0), true);
  assert.equal(api.summarizeRoads(roundTrip).lampTotal, 7);
});

const invalidCases = [
  ["顶层不是数组", `const ROADS = {};`],
  ["附加代码", `globalThis.__roadFileExecuted = true; const ROADS = [];`],
  ["声明后附加代码", `const ROADS = []; globalThis.__roadFileExecuted = true;`],
  ["重复编号", `const ROADS = [
    {"id":"R1","name":"甲","type":"水泥路","pts":[[28,112],[29,113]]},
    {"id":"R1","name":"乙","type":"水泥路","pts":[[28,112],[29,113]]}
  ];`],
  ["少于两个点", `const ROADS = [
    {"id":"R1","name":"甲","type":"水泥路","pts":[[28,112]]}
  ];`],
  ["越界坐标", `const ROADS = [
    {"id":"R1","name":"甲","type":"水泥路","pts":[[128,112],[29,113]]}
  ];`],
  ["负数盏数", `const ROADS = [
    {"id":"R1","name":"甲","type":"水泥路","pts":[[28,112],[29,113]],"lamps":-1}
  ];`],
  ["小数盏数", `const ROADS = [
    {"id":"R1","name":"甲","type":"水泥路","pts":[[28,112],[29,113]],"lamps":1.5}
  ];`],
  ["非布尔亮化标记", `const ROADS = [
    {"id":"R1","name":"甲","type":"水泥路","pts":[[28,112],[29,113]],"lamped":"true"}
  ];`],
  ["危险编号", `const ROADS = [
    {"id":"R1');alert(1);//","name":"甲","type":"水泥路","pts":[[28,112],[29,113]]}
  ];`],
];

for (const [name, text] of invalidCases) {
  test(`拒绝${name}且不执行文件代码`, () => {
    globalThis.__roadFileExecuted = false;
    assert.throws(() => api.parseRoadsFile(text), /道路文件|道路.*第|ROADS/);
    assert.equal(globalThis.__roadFileExecuted, false);
  });
}
```

- [x] **Step 2: 运行测试并确认因功能缺失而失败**

Run:

```powershell
node --test "04_网页程序/tests/road-data.test.cjs"
```

Expected: FAIL；首个失败明确显示 `parseRoadsFile 尚未实现`，不是语法错误或路径错误。

- [x] **Step 3: 写入最小数据模块实现**

`road-data.js` 使用 UMD 风格，浏览器得到 `globalThis.RoadData`，Node 得到
`module.exports`。实现以下逻辑：

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RoadData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function roadError(index, message) {
    const where = Number.isInteger(index) ? `道路第 ${index + 1} 条` : "道路文件";
    throw new Error(`${where}：${message}`);
  }

  function normalizeRoad(road, index) {
    if (!road || typeof road !== "object" || Array.isArray(road)) {
      roadError(index, "必须是对象");
    }
    if (typeof road.id !== "string" || !road.id.trim()) roadError(index, "id 不能为空");
    if (!/^[A-Za-z0-9_-]+$/.test(road.id.trim())) {
      roadError(index, "id 只能包含英文字母、数字、下划线和连字符");
    }
    if (typeof road.name !== "string") roadError(index, "name 必须是字符串");
    if (typeof road.type !== "string" || !road.type.trim()) roadError(index, "type 不能为空");
    if (!Array.isArray(road.pts) || road.pts.length < 2) roadError(index, "pts 至少需要两个点");

    const pts = road.pts.map((point, pointIndex) => {
      if (!Array.isArray(point) || point.length !== 2 ||
          !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        roadError(index, `第 ${pointIndex + 1} 个坐标必须是两个有限数字`);
      }
      const lat = point[0], lng = point[1];
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        roadError(index, `第 ${pointIndex + 1} 个坐标超出经纬度范围`);
      }
      return [lat, lng];
    });

    const width = road.width === undefined || road.width === null || road.width === ""
      ? 5 : road.width;
    if (!Number.isFinite(width) || width <= 0) roadError(index, "width 必须是正数");

    const rawLamps = road.lamps === undefined || road.lamps === null || road.lamps === ""
      ? 0 : road.lamps;
    if (!Number.isInteger(rawLamps) || rawLamps < 0) {
      roadError(index, "lamps 必须是非负整数");
    }

    let lamped = road.lamped === undefined ? false : road.lamped;
    if (typeof lamped !== "boolean") roadError(index, "lamped 必须是布尔值");
    if (road.type === "路灯线" || rawLamps > 0) lamped = true;

    return {
      id: road.id.trim(),
      name: road.name,
      type: road.type,
      width,
      pts,
      lamped,
      lamps: rawLamps,
    };
  }

  function normalizeRoads(value) {
    if (!Array.isArray(value)) roadError(null, "ROADS 必须是数组");
    const roads = value.map(normalizeRoad);
    const seen = new Set();
    roads.forEach((road, index) => {
      if (seen.has(road.id)) roadError(index, `id“${road.id}”重复`);
      seen.add(road.id);
    });
    return roads;
  }

  function parseRoadsFile(text) {
    let body = String(text === undefined || text === null ? "" : text)
      .replace(/^\uFEFF/, "");
    body = body.replace(/^(?:[ \t]*\/\/[^\r\n]*(?:\r?\n|$)|[ \t\r\n])*/, "");
    const match = body.match(/^const\s+ROADS\s*=\s*([\s\S]*?)\s*;\s*$/);
    if (!match) roadError(null, "只接受 const ROADS = <JSON数组>;，不得附加其他代码");
    let value;
    try {
      value = JSON.parse(match[1]);
    } catch (error) {
      roadError(null, `ROADS 不是有效 JSON（${error.message}）`);
    }
    return normalizeRoads(value);
  }

  function summarizeRoads(value) {
    const roads = normalizeRoads(value);
    return roads.reduce((summary, road) => {
      summary.roadCount++;
      if (road.lamped) summary.lampedCount++;
      if (road.lamps > 0) summary.positiveLampCount++;
      summary.lampTotal += road.lamps;
      return summary;
    }, { roadCount: 0, lampedCount: 0, positiveLampCount: 0, lampTotal: 0 });
  }

  function serializeRoadsFile(value, villageName) {
    const roads = normalizeRoads(value);
    const village = String(villageName || "").replace(/[\r\n]+/g, " ").trim();
    return `// ${village}道路数据 —— 由网页【导出道路文件】生成\n` +
      "// 文件包含道路坐标、路面、路灯标记和路灯盏数\n" +
      "// 可在网页中点【选择道路文件】载入；浏览器同名下载可能自动改名\n" +
      `const ROADS = ${JSON.stringify(roads)};\n`;
  }

  return { normalizeRoads, parseRoadsFile, summarizeRoads, serializeRoadsFile };
});
```

- [x] **Step 4: 运行测试并确认全部通过**

Run:

```powershell
node --test "04_网页程序/tests/road-data.test.cjs"
```

Expected: PASS；所有解析、规范化、拒绝代码、坐标和路灯数测试通过，零警告。

- [x] **Step 5: 做变异检查并提交**

依次临时思考以下变异是否会被现有测试捕获：删除 JSON 锚定、允许重复 ID、
把缺失 `lamps` 留为 `undefined`、不把正数盏数统一为亮化。每项都应至少使一个测试失败。

Run:

```powershell
git diff --check
git add -- "04_网页程序/road-data.js" "04_网页程序/tests/road-data.test.cjs"
git commit -m "test: add safe road data boundary"
```

Expected: 新提交只含道路数据模块和单元测试，不含用户 PDF。

---

### Task 2: 在真实网页接入安全文件选择、规范化导出和精确存档读取

**Files:**

- Create: `04_网页程序/tests/helpers/edge-cdp.cjs`
- Create: `04_网页程序/tests/fixtures/roads-with-lamps.js`
- Create: `04_网页程序/tests/fixtures/roads-with-code.js`
- Create: `04_网页程序/tests/browser-road-portability.test.cjs`
- Modify: `04_网页程序/index.html:297-299`
- Modify: `04_网页程序/index.html:386-393`
- Modify: `04_网页程序/index.html:416-434`
- Modify: `04_网页程序/index.html:663-679`
- Modify: `04_网页程序/index.html:1185-1222`

**Interfaces:**

- Consumes: Task 1 的 `globalThis.RoadData`。
- Produces:
  - DOM `#roadFileInput`：隐藏的原生 `.js` 文件选择器。
  - `readRoadFile(file: File): Promise<string>`：用 `FileReader` 读取 UTF-8 文本。
  - `replaceRoads(nextRoads: Road[]): void`：校验完成后一次性替换道路并刷新页面。
  - `lsRead(prefix: string): string|null`：只读当前村的精确 localStorage 键。
- 测试助手：
  - `withBrowserPage(relativeUrl, callback): Promise<void>`
  - `page.call(method, params): Promise<object>`
  - `page.evaluate(expression): Promise<any>`
  - `page.setFileInput(selector, absolutePath): Promise<void>`
  - `page.waitFor(expression, timeoutMs = 5000): Promise<void>`
  - `page.exceptions: Array<object>`

- [x] **Step 1: 建立临时 Edge 测试助手和固定样例**

合法样例必须使用非标准文件名并带两条道路：

```js
// 测试道路数据
const ROADS = [
  {"id":"TEST-1","name":"测试亮化路","type":"柏油路","width":5,
   "pts":[[28.4000,112.8900],[28.4010,112.8910]],"lamped":true,"lamps":7},
  {"id":"TEST-2","name":"测试零盏路","type":"水泥路","width":4,
   "pts":[[28.4020,112.8920],[28.4030,112.8930]],"lamped":true,"lamps":0}
];
```

恶意样例内容固定为：

```js
globalThis.__roadFileExecuted = true;
const ROADS = [];
```

`edge-cdp.cjs` 必须：

1. 用 `http.createServer` 只读提供 `04_网页程序`，解析路径后确认目标仍在该目录内。
2. 用 `fs.mkdtempSync(path.join(os.tmpdir(), "heqiao-edge-"))` 建临时配置。
3. 启动
   `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
   时传入 `--headless=new --remote-debugging-port=0 --user-data-dir=<临时目录> --no-first-run`。
4. 从临时目录的 `DevToolsActivePort` 取得端口，用 Node 24 全局 `WebSocket`
   连接页面调试地址。
5. `Runtime.evaluate` 一律使用 `awaitPromise:true`、`returnByValue:true`；
   有 `exceptionDetails` 时抛错。
6. `setFileInput` 使用 `DOM.getDocument`、`DOM.querySelector`、
   `DOM.setFileInputFiles`，然后由测试显式派发 `change`。
7. 监听 `Runtime.exceptionThrown` 写入 `page.exceptions`。
8. `finally` 中关闭 WebSocket、Edge、HTTP 服务并删除该助手自己创建的临时目录。

助手的核心实现固定如下；`contentType` 对 `.html`、`.js`、`.css`、`.png`、
`.jpg`、`.svg` 返回对应类型，其余返回 `application/octet-stream`：

```js
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const WEB_ROOT = path.resolve(__dirname, "..", "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
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
        if (message.error) pending.reject(new Error(message.error.message));
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
      this.pending.set(id, { resolve, reject });
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
    await waitUntil(
      () => this.evaluate(`Boolean(${expression})`),
      timeoutMs,
      expression
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
  return page;
}

async function withBrowserPage(relativeUrl, callback) {
  if (!fs.existsSync(EDGE)) throw new Error(`未找到 Edge：${EDGE}`);
  const server = await startServer();
  const address = server.address();
  const pageUrl = new URL(relativeUrl, `http://127.0.0.1:${address.port}/`).href;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "heqiao-edge-"));
  const child = spawn(EDGE, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    pageUrl,
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
      return targets.find(item =>
        item.type === "page" && item.url.startsWith(`http://127.0.0.1:${address.port}/`)
      );
    }, 10000, "网页调试目标");
    page = await connectPage(target.webSocketDebuggerUrl);
    await page.waitFor(`document.readyState === "complete"`, 10000);
    await callback(page);
  } finally {
    if (page) {
      await page.call("Browser.close").catch(() => {});
      page.socket.close();
    }
    if (!child.killed) child.kill();
    await sleep(250);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { withBrowserPage };
```

- [x] **Step 2: 写入网页 RED 测试**

测试真实文件输入、localStorage、统计和导出内容：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { withBrowserPage } = require("./helpers/edge-cdp.cjs");

const validFile = path.join(__dirname, "fixtures", "roads-with-lamps.js");
const codeFile = path.join(__dirname, "fixtures", "roads-with-code.js");

test("选择任意文件名的道路文件后原子写入当前村并刷新统计", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.clear();
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      return true;
    })()`);
    await page.setFileInput("#roadFileInput", validFile);
    await page.evaluate(`(() => {
      document.querySelector("#roadFileInput").dispatchEvent(new Event("change"));
      return true;
    })()`);
    await page.waitFor(`window.__alerts.some(x => x.includes("7 盏"))`);
    const actual = await page.evaluate(`(() => {
      const stored = JSON.parse(localStorage.getItem(ROAD_KEY));
      return {
        village: CONFIG.villageName,
        key: ROAD_KEY,
        summary: RoadData.summarizeRoads(stored),
        stats: document.querySelector("#stats").textContent,
      };
    })()`);
    assert.equal(actual.key, `roadData_${actual.village}`);
    assert.deepEqual(actual.summary, {
      roadCount: 2, lampedCount: 2, positiveLampCount: 1, lampTotal: 7,
    });
    assert.match(actual.stats, /沿路路灯\s*7\s*盏/);
    assert.equal(page.exceptions.length, 0);

    await page.evaluate(`(() => { setTimeout(() => location.reload(), 0); return true; })()`);
    await page.waitFor(`typeof RoadData !== "undefined" && roads.length === 2`);
    const afterReload = await page.evaluate(
      `RoadData.summarizeRoads(roads)`
    );
    assert.deepEqual(afterReload, {
      roadCount: 2, lampedCount: 2, positiveLampCount: 1, lampTotal: 7,
    });
  });
});

test("用户取消确认时不覆盖现有道路", async () => {
  await withBrowserPage("index.html", async page => {
    const before = await page.evaluate(`(() => {
      window.__confirmCalled = false;
      window.alert = () => {};
      window.confirm = () => { window.__confirmCalled = true; return false; };
      return JSON.stringify(roads);
    })()`);
    await page.setFileInput("#roadFileInput", validFile);
    await page.evaluate(`(() => {
      document.querySelector("#roadFileInput").dispatchEvent(new Event("change"));
      return true;
    })()`);
    await page.waitFor(`window.__confirmCalled`);
    const after = await page.evaluate(`JSON.stringify(roads)`);
    assert.equal(after, before);
  });
});

test("当前村没有存档时不会串读并复制其他村道路", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.clear();
      const currentKey = "roadData_" + (CONFIG.villageName || "village");
      localStorage.setItem("roadData_其他村", JSON.stringify([{
        id:"OTHER-1", name:"其他村道路", type:"水泥路", width:5,
        pts:[[28.4,112.89],[28.41,112.9]], lamped:true, lamps:999
      }]));
      localStorage.removeItem(currentKey);
      setTimeout(() => location.reload(), 0);
      return true;
    })()`);
    await page.waitFor(`typeof RoadData !== "undefined" && Array.isArray(roads)`);
    const actual = await page.evaluate(`(() => {
      const currentKey = "roadData_" + (CONFIG.villageName || "village");
      return {
        hasOtherRoad: roads.some(road => road.id === "OTHER-1"),
        currentKeyCreated: localStorage.getItem(currentKey) !== null,
        otherKeyStillPresent: localStorage.getItem("roadData_其他村") !== null,
      };
    })()`);
    assert.deepEqual(actual, {
      hasOtherRoad: false,
      currentKeyCreated: false,
      otherKeyStillPresent: true,
    });
  });
});

test("带代码的文件被拒绝且现有道路保持不变", async () => {
  await withBrowserPage("index.html", async page => {
    const before = await page.evaluate(`(() => {
      window.__roadFileExecuted = false;
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      return JSON.stringify(roads);
    })()`);
    await page.setFileInput("#roadFileInput", codeFile);
    await page.evaluate(`(() => {
      document.querySelector("#roadFileInput").dispatchEvent(new Event("change"));
      return true;
    })()`);
    await page.waitFor(`window.__alerts.length > 0`);
    const after = await page.evaluate(`(() => ({
      roads: JSON.stringify(roads),
      executed: window.__roadFileExecuted,
      alerts: window.__alerts
    }))()`);
    assert.equal(after.roads, before);
    assert.equal(after.executed, false);
    assert.match(after.alerts.join("\n"), /无法载入|道路文件/);
  });
});

test("导出文本显式携带亮化标记和盏数并可重新解析", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__downloadText = "";
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      URL.createObjectURL = blob => {
        blob.text().then(text => { window.__downloadText = text; });
        return "blob:test";
      };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () {};
      document.querySelector("#btnExportRoads").click();
      return true;
    })()`);
    await page.waitFor(`window.__downloadText.length > 0`);
    const actual = await page.evaluate(`(() => {
      const parsed = RoadData.parseRoadsFile(window.__downloadText);
      return {
        allExplicit: parsed.every(r =>
          typeof r.lamped === "boolean" &&
          Number.isInteger(r.lamps) && r.lamps >= 0),
        summary: RoadData.summarizeRoads(parsed),
        current: RoadData.summarizeRoads(roads),
        alerts: window.__alerts,
      };
    })()`);
    assert.equal(actual.allExplicit, true);
    assert.deepEqual(actual.summary, actual.current);
    assert.match(actual.alerts.join("\n"), /道路.*有路灯.*盏/);
  });
});
```

- [x] **Step 3: 运行浏览器测试并确认旧界面失败**

Run:

```powershell
node --test "04_网页程序/tests/browser-road-portability.test.cjs"
```

Expected: FAIL；合法导入测试因 `#roadFileInput` 不存在而失败。确认 Edge 临时进程和
临时目录在失败后也已清理。

- [x] **Step 4: 接入 `road-data.js` 和原生文件选择器**

在数据脚本之前载入模块：

```html
<script src="lib/leaflet.js"></script>
<script src="road-data.js"></script>
<script>
```

道路按钮区改为：

```html
<button id="btnExportRoads">💾 导出道路文件</button>
<button id="btnLoadRoads" title="选择任意目录中的道路文件，确认后覆盖当前村浏览器道路">📂 选择道路文件</button>
<input id="roadFileInput" type="file" accept=".js,application/javascript,text/javascript" hidden>
<span class="rb-tip">修改先存在当前村浏览器里；导出文件包含道路、路灯标记和盏数，换电脑时可直接选择载入</span>
```

把 `lsRead` 收紧为精确键读取，绝不扫描其他村：

```js
function lsRead(prefix) {
  const key = prefix + (CONFIG.villageName || "village");
  try { return localStorage.getItem(key); }
  catch (error) { return null; }
}
```

初始化道路时统一走数据边界；浏览器存档无效时回退同级 `ROADS`，两者都无效才用空数组：

```js
const ROAD_KEY = "roadData_" + (CONFIG.villageName || "village");
let roads = null;
try {
  const saved = lsRead("roadData_");
  if (saved !== null) roads = RoadData.normalizeRoads(JSON.parse(saved));
} catch (error) {
  console.warn("本机道路存档无效，将尝试 roads.js：", error);
}
if (!Array.isArray(roads)) {
  try {
    roads = RoadData.normalizeRoads(
      typeof ROADS !== "undefined" && Array.isArray(ROADS) ? ROADS : []
    );
  } catch (error) {
    roads = [];
    alert("roads.js 内容有误，已暂时使用空道路。\n" + error.message);
  }
}
function saveRoads() {
  try { localStorage.setItem(ROAD_KEY, JSON.stringify(roads)); }
  catch (error) { alert("浏览器无法保存道路，请先导出道路文件备份。"); }
}
```

删除原先只针对 `type === "路灯线"` 的补字段代码，因为
`RoadData.normalizeRoads` 已统一处理。

- [x] **Step 5: 用安全序列化替换导出流程**

导出事件只通过 Task 1 API 产生文本，并在成功提示中给出三项摘要：

```js
document.getElementById("btnExportRoads").addEventListener("click", () => {
  if (!roads.length) {
    alert("还没有画任何道路，先点【开始画路】画几条吧");
    return;
  }
  roads = RoadData.normalizeRoads(roads);
  saveRoads();
  const summary = RoadData.summarizeRoads(roads);
  const txt = RoadData.serializeRoadsFile(roads, CONFIG.villageName || "");
  const a = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([txt], { type: "application/javascript;charset=utf-8" })
  );
  a.href = url;
  a.download = "roads.js";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  alert(
    `已导出 ${summary.roadCount} 条道路，其中有路灯 ${summary.lampedCount} 条，` +
    `共 ${summary.lampTotal} 盏。\n\n` +
    "浏览器可能把同名文件改成 roads (1).js；可直接点【选择道路文件】载入它。" +
    "如需作为项目默认文件，请备份后改名为 roads.js 并放到 index.html 旁边。"
  );
});
```

- [x] **Step 6: 用 `FileReader` 实现原子导入**

```js
function readRoadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsText(file, "UTF-8");
  });
}

function replaceRoads(nextRoads) {
  Object.keys(roadLayers).forEach(id => {
    roadLayer.removeLayer(roadLayers[id].group);
    delete roadLayers[id];
  });
  roads = RoadData.normalizeRoads(nextRoads);
  saveRoads();
  roads.forEach(renderRoad);
  refreshStats();
  refreshList();
}

const roadFileInput = document.getElementById("roadFileInput");
document.getElementById("btnLoadRoads").addEventListener("click", () => {
  if (editing) {
    alert("正在修改道路形状，请先点【保存修改】或【取消】");
    return;
  }
  roadFileInput.value = "";
  roadFileInput.click();
});

roadFileInput.addEventListener("change", async () => {
  const file = roadFileInput.files && roadFileInput.files[0];
  if (!file) return;
  if (editing) {
    alert("正在修改道路形状，请先点【保存修改】或【取消】");
    return;
  }
  try {
    const incoming = RoadData.parseRoadsFile(await readRoadFile(file));
    const summary = RoadData.summarizeRoads(incoming);
    const ok = confirm(
      `文件“${file.name}”包含 ${summary.roadCount} 条道路，` +
      `其中有路灯 ${summary.lampedCount} 条，共 ${summary.lampTotal} 盏。\n\n` +
      `确认覆盖 ${CONFIG.villageName || "当前村"} 浏览器里现有的 ${roads.length} 条道路？\n` +
      "覆盖前建议点【取消】，先【导出道路文件】备份。"
    );
    if (!ok) return;
    replaceRoads(incoming);
    alert(
      `已载入 ${summary.roadCount} 条道路，其中有路灯 ` +
      `${summary.lampedCount} 条，共 ${summary.lampTotal} 盏。`
    );
  } catch (error) {
    alert("无法载入道路文件，现有道路没有改变。\n" + error.message);
  } finally {
    roadFileInput.value = "";
  }
});
```

- [x] **Step 7: 运行单元和浏览器测试并提交**

Run:

```powershell
node --test "04_网页程序/tests/road-data.test.cjs"
node --test "04_网页程序/tests/browser-road-portability.test.cjs"
git diff --check
```

Expected: 全部 PASS，`page.exceptions` 为空。随后：

```powershell
git add -- "04_网页程序/index.html" "04_网页程序/tests"
git commit -m "fix: import and export road streetlight data"
```

Expected: 提交包含真实浏览器回归工具、样例和网页接入，不含用户 PDF。

---

### Task 3: 激活 51 条标准道路并修复村名生成与村际存档串读

**Files:**

- Create: `04_网页程序/tests/data-tool.test.cjs`
- Create: `04_网页程序/tests/project-regression.test.cjs`
- Modify: `04_网页程序/data.js:3`
- Modify: `04_网页程序/数据更新工具.html:78-147`
- Modify: `04_网页程序/roads.js`
- Modify: `04_网页程序/tests/browser-road-portability.test.cjs`

**Interfaces:**

- Consumes: Task 1 的解析、序列化和汇总 API；Task 2 的临时 Edge 助手。
- Produces:
  - 当前 `CONFIG.villageName === "何桥村"`。
  - 空村名调用 `gen()` 后输出为空、下载按钮禁用、错误消息为“请填写村名”。
  - 同级 `roads.js` 为规范化 51 条标准道路。
  - 其他村 localStorage 键不会被复制到何桥村键。

- [x] **Step 1: 写标准数据和页面启动 RED 测试**

`project-regression.test.cjs` 用 `vm.runInContext` 实际执行 `data.js` 和 `roads.js`，
不用源代码文本匹配：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const RoadData = require("../road-data.js");

const root = path.join(__dirname, "..");
function executeDataFile(name) {
  const context = {};
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, name), "utf8");
  const names = name === "data.js" ? "{CONFIG,HOUSES,LAMPS}" : "{ROADS}";
  vm.runInContext(
    `${source}\nglobalThis.__executedData = ${names};`,
    context,
    { filename: name }
  );
  return context.__executedData;
}

test("项目当前数据属于何桥村且保持 82 处房屋", () => {
  const data = executeDataFile("data.js");
  assert.equal(data.CONFIG.villageName, "何桥村");
  assert.equal(data.HOUSES.length, 82);
});

test("默认道路是已规范化的 51 条路灯标注标准版", () => {
  const data = executeDataFile("roads.js");
  const roads = RoadData.normalizeRoads(data.ROADS);
  assert.deepEqual(RoadData.summarizeRoads(roads), {
    roadCount: 51, lampedCount: 51, positiveLampCount: 48, lampTotal: 597,
  });
  assert.equal(roads.every(r =>
    typeof r.lamped === "boolean" &&
    Number.isInteger(r.lamps) && r.lamps >= 0
  ), true);
  const zeros = roads.filter(r => r.lamps === 0).map(r => r.name).sort();
  assert.deepEqual(zeros, ["路灯21补充", "路灯25补充", "路灯4"].sort());
});

test("index 内联脚本语法有效且 DOM id 不重复", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(Boolean);
  inline.forEach((source, index) =>
    new vm.Script(source, { filename: `index-inline-${index + 1}.js` })
  );
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});
```

在 `browser-road-portability.test.cjs` 增加真实启动和存档隔离测试：

```js
test("全新何桥村页面显示标准路灯道路", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.clear();
      setTimeout(() => location.reload(), 0);
      return true;
    })()`);
    await page.waitFor(`typeof RoadData !== "undefined" && roads.length > 0`);
    const actual = await page.evaluate(`(() => ({
      village: CONFIG.villageName,
      key: ROAD_KEY,
      summary: RoadData.summarizeRoads(roads)
    }))()`);
    assert.equal(actual.village, "何桥村");
    assert.equal(actual.key, "roadData_何桥村");
    assert.deepEqual(actual.summary, {
      roadCount: 51, lampedCount: 51, positiveLampCount: 48, lampTotal: 597,
    });
  });
});
```

- [x] **Step 2: 写数据更新工具 RED 测试**

测试通过真实 DOM 调用 `gen()`；固定最小 Excel 粘贴内容，期望值不复用生成器逻辑：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { withBrowserPage } = require("./helpers/edge-cdp.cjs");

const houseTable = "测点编号\t经度\t纬度\n26001\t112.89\t28.40";

test("空村名阻止生成并清除旧输出", async () => {
  await withBrowserPage("数据更新工具.html", async page => {
    const actual = await page.evaluate(`(() => {
      document.querySelector("#village").value = "";
      document.querySelector("#tHouse").value = ${JSON.stringify(houseTable)};
      document.querySelector("#out").value = "旧输出";
      document.querySelector("#btnDl").disabled = false;
      gen();
      return {
        message: document.querySelector("#msg").textContent,
        className: document.querySelector("#msg").className,
        output: document.querySelector("#out").value,
        disabled: document.querySelector("#btnDl").disabled,
      };
    })()`);
    assert.equal(actual.message, "请填写村名，不能留空。");
    assert.equal(actual.className, "err");
    assert.equal(actual.output, "");
    assert.equal(actual.disabled, true);
  });
});

test("填写何桥村时生成正确 CONFIG", async () => {
  await withBrowserPage("数据更新工具.html", async page => {
    const actual = await page.evaluate(`(() => {
      document.querySelector("#village").value = "何桥村";
      document.querySelector("#tHouse").value = ${JSON.stringify(houseTable)};
      gen();
      return {
        message: document.querySelector("#msg").textContent,
        output: document.querySelector("#out").value,
        disabled: document.querySelector("#btnDl").disabled,
      };
    })()`);
    assert.match(actual.message, /生成成功：闲置房屋 1 处/);
    assert.match(actual.output, /villageName: "何桥村"/);
    assert.equal(actual.disabled, false);
  });
});
```

- [x] **Step 3: 运行 RED 并确认三个旧问题均可复现**

Run:

```powershell
node --test "04_网页程序/tests/project-regression.test.cjs"
node --test "04_网页程序/tests/data-tool.test.cjs"
node --test "04_网页程序/tests/browser-road-portability.test.cjs"
```

Expected:

- `data.js` 村名实际为“示例村”，村名断言失败。
- 同级旧 `roads.js` 只有 50 条且无标准路灯字段，道路断言失败。
- 空村名仍生成“示例村”，工具断言失败。
- 存档隔离已经在 Task 2 的 RED→GREEN 周期中覆盖，本阶段保持通过。

- [x] **Step 4: 修正当前村名和生成工具源头**

`data.js` 只改当前生成结果：

```js
const CONFIG = {
  villageName: "何桥村",
```

在 `gen()` 清空消息之后、解析房屋表之前加入：

```js
const village = str(document.getElementById("village").value);
if (!village) {
  result = "";
  document.getElementById("out").value = "";
  document.getElementById("btnDl").disabled = true;
  msg.className = "err";
  msg.textContent = "请填写村名，不能留空。";
  return;
}
```

删除函数后部的：

```js
const village = str(document.getElementById("village").value) || "示例村";
```

其余 Excel→`data.js` 生成逻辑不改变。

- [x] **Step 5: 覆盖前再次核对标准源并机械生成同级 `roads.js`**

先向用户说明即将覆盖同级道路文件，并指出可恢复基线
`af7a598` 及源文件 `04_网页程序/road/roads-路灯标注版.js`。运行只读核对：

```powershell
node -e "const fs=require('fs');const rd=require('./04_网页程序/road-data.js');const p='./04_网页程序/road/roads-路灯标注版.js';const r=rd.parseRoadsFile(fs.readFileSync(p,'utf8'));console.log(rd.summarizeRoads(r));"
```

Expected:

```text
{ roadCount: 51, lampedCount: 51, positiveLampCount: 48, lampTotal: 597 }
```

确认后使用同一个已经测试的生产序列化器进行机械规范化；该操作只覆盖明确目标
`04_网页程序/roads.js`：

```powershell
node -e "const fs=require('fs');const rd=require('./04_网页程序/road-data.js');const src='./04_网页程序/road/roads-路灯标注版.js';const dst='./04_网页程序/roads.js';const roads=rd.parseRoadsFile(fs.readFileSync(src,'utf8'));fs.writeFileSync(dst,rd.serializeRoadsFile(roads,'何桥村'),'utf8');"
```

- [x] **Step 6: 运行 GREEN、数据差异检查并提交**

Run:

```powershell
node --test "04_网页程序/tests/road-data.test.cjs"
node --test "04_网页程序/tests/project-regression.test.cjs"
node --test "04_网页程序/tests/data-tool.test.cjs"
node --test "04_网页程序/tests/browser-road-portability.test.cjs"
git diff --check
```

Expected: 全部 PASS；标准摘要严格为 51/51/48/597，82 处房屋不变，无浏览器异常。

提交：

```powershell
git add -- "04_网页程序/data.js" "04_网页程序/roads.js" "04_网页程序/数据更新工具.html" "04_网页程序/tests"
git commit -m "fix: activate canonical streetlight roads"
```

Expected: 提交不包含 `04_网页程序/road/` 备份改动，也不包含用户 PDF。

---

### Task 4: 更新使用说明并完成打印和全量回归

**Files:**

- Modify: `README.md`
- Modify: `04_网页程序/使用说明.txt`
- Modify: `04_网页程序/换电脑迁移说明.txt`
- Modify: `项目说明.md`
- Modify: `docs/superpowers/specs/2026-07-27-road-streetlight-portability-design.md`
- Modify: `项目日志.md`
- Modify: `对话交接记录.md`
- Modify: `04_网页程序/tests/browser-road-portability.test.cjs`

**Interfaces:**

- Consumes: Tasks 1–3 的全部测试和生产行为。
- Produces: 可由现场同学执行的导出/载入/迁移说明，以及 035 最终版本记录。

- [x] **Step 1: 先增加打印回归测试并观察现有实现通过**

这是受影响旧功能的特征测试，不要求先失败，因为它保护的是已有打印行为。加入：

```js
test("道路数据修复后快速打印和高清幅面仍可建立", async () => {
  await withBrowserPage("index.html", async page => {
    const highResolution = await page.evaluate(`(() => {
      window.print = () => { window.__printCalled = true; };
      bigPrint("A0", {z:17, sc:0.7942, fit:true});
      const root = document.querySelector("#bigPrint");
      return {
        exists: Boolean(root),
        pages: root ? root.querySelectorAll(".big-sheet").length : 0,
        title: root ? root.textContent : "",
        roadPaths: root ? root.querySelectorAll("path").length : 0,
      };
    })()`);
    assert.equal(highResolution.exists, true);
    assert.equal(highResolution.pages, 1);
    assert.match(highResolution.title, /何桥村/);
    assert.equal(highResolution.roadPaths > 0, true);
    assert.equal(page.exceptions.length, 0);
  });
});

test("何桥村 A3 四页拼图仍生成四页", async () => {
  await withBrowserPage("index.html", async page => {
    const actual = await page.evaluate(`(() => {
      window.print = () => {};
      bigPrint("A3", {z:18, fit:true, cols:2, rows:2, autoScale:true});
      const root = document.querySelector("#bigPrint");
      return {
        pages: root ? root.querySelectorAll(".big-sheet").length : 0,
        maps: root ? root.querySelectorAll(".big-page-map").length : 0,
      };
    })()`);
    assert.deepEqual(actual, { pages: 4, maps: 4 });
    assert.equal(page.exceptions.length, 0);
  });
});
```

Run:

```powershell
node --test "04_网页程序/tests/browser-road-portability.test.cjs"
```

Expected: PASS；如果失败，先判断是测试选择器与现有打印 DOM 不一致还是 Tasks 1–3
引起回归。只有真实回归才修改生产代码，且先把测试修到能在变更前准确描述旧行为。

- [x] **Step 2: 更新现场使用说明**

文档必须明确写出：

1. 路灯标记和盏数既保存在当前村浏览器工作副本中，也会进入导出的道路文件。
2. 浏览器下载可能得到 `roads (1).js`，不需要先改名即可点“选择道路文件”载入。
3. 选择文件会显示道路数、有路灯路段数、总盏数，并在确认后覆盖当前村道路。
4. 覆盖前先导出备份；取消或错误不会改现有数据。
5. 作为项目默认文件时，维护人员才需要把文件改名为 `roads.js` 放到
   `index.html` 同级。
6. 当前一次性迁移：打开网页，先导出浏览器现有道路，再选择项目同级
   `roads.js`；确认摘要为 51 条、有路灯 51 条、597 盏。
7. 数据更新工具的村名必须填写“何桥村”，空值现在会阻止生成。

`README.md` 当前数据改为：82 处房屋、0 个独立路灯点位、51 条道路、
51 条亮化、597 盏沿路路灯。

- [x] **Step 3: 更新技术说明、设计状态和版本记录**

`项目说明.md` 增加：

- `road-data.js` 是道路文件的数据边界。
- `roads.js` 与 localStorage 都含 `lamped`/`lamps`。
- 页面只精确读取当前村键，不自动串读其他村。
- 文件选择导入安全解析 JSON，不执行脚本。

设计文档状态改为：

```text
状态：已通过；按 035 实施并完成验证
```

`项目日志.md` 增加“035 —— 2026-07-27 道路路灯数据随文件保存修复”，记录：

- 根因、修复方式、标准数据摘要。
- 村名和精确存档键修复。
- 单元/浏览器/打印验证命令与结果。
- 4 份用户 PDF 未提交。

`对话交接记录.md` 顶部增加同主题记录，写明最终提交哈希、测试结果、一次性载入
操作和仍不在本次范围内的已租/面积统一导出。

- [x] **Step 4: 运行完整验证**

先执行自动测试：

```powershell
node --test "04_网页程序/tests/road-data.test.cjs"
node --test "04_网页程序/tests/project-regression.test.cjs"
node --test "04_网页程序/tests/data-tool.test.cjs"
node --test "04_网页程序/tests/browser-road-portability.test.cjs"
git diff --check
```

Expected:

- 所有测试 PASS，退出码均为 0。
- 页面 JavaScript 语法有效、DOM ID 无重复。
- 82 处房屋、51 条道路、51 条亮化、48 条正数、597 盏。
- 文件选择导入、恶意文件拒绝、导出往返、刷新 localStorage 均通过。
- A0 单页和 A3×4 四页打印 DOM 均生成，道路矢量存在。
- Edge 运行异常为 0。

再检查 Git 范围：

```powershell
git status --short
git diff --stat
git diff --name-only
```

Expected: 只出现本计划列出的程序、测试和文档；`05_成品图/` 4 份 PDF 仍为未跟踪，
没有被暂存。

- [x] **Step 5: 提交 035 文档和最终回归**

```powershell
git add -- "README.md" "04_网页程序/使用说明.txt" "04_网页程序/换电脑迁移说明.txt" "项目说明.md" "项目日志.md" "对话交接记录.md" "docs/superpowers/specs/2026-07-27-road-streetlight-portability-design.md" "04_网页程序/tests/browser-road-portability.test.cjs"
git commit -m "035 完成道路路灯数据文件迁移修复"
git status --short
git log -n 5 --oneline
```

Expected:

- 最终提交成功。
- 工作区只剩 `05_成品图/` 下 4 份未跟踪用户 PDF。
- 最后报告实际提交哈希和每条验证命令的真实结果，不以计划中的 Expected 代替证据。

## 036 Final Review Hardening

终审基于 035 固定点补充 RED→GREEN 回归并完成以下加固：

- 拒绝 `__proto__`、`constructor`、`toString` 道路 ID；道路图层索引改为无原型对象，
  未知路面类型只允许回退到泥路样式。
- 导入先预构建候选图层，以 localStorage 写入作为提交门槛；持久化失败不切换界面，
  写入后的可见更新失败则恢复旧内存、图层、列表、统计与存档。
- 导出仅规范化局部副本，保留页面道路对象身份和 Leaflet 点击闭包的一致性。
- Edge helper 以旧文档哨兵等待刷新，覆盖直接 `file://` 双击打开；打印回归实际调用
  快速打印、A0 和 A3×4 入口并等待 `window.print`。
- 项目回归逐项比较标准源与默认 `roads.js` 的规范化序列化结果，守护坐标、顺序和字段
  完全一致，不只比较 51/51/48/597 摘要。

# 面积地块独立文件迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为面积地块增加独立 JSON 导出和手动载入，确认后整体覆盖当前村地块。

**Architecture:** 新增无依赖 `area-data.js` 处理纯 JSON 校验、序列化和面积摘要；`index.html` 只增加两个按钮、文件选择和一个可回滚的整体替换函数。保持现有 `areaData_<村名>` 自动保存，不自动读取同级面积文件。

**Tech Stack:** 原生 HTML/JavaScript、Leaflet、localStorage、Blob/File API、Node 24 `node:test`、Edge CDP。

## Global Constraints

- 只迁移面积地块；不改道路文件、已租标记、房屋数据、照片和客户 PDF。
- 文件为版本 1 纯 JSON；坐标沿用 GCJ-02，不做自动纠偏。
- 载入只做整体覆盖，不做合并；取消或失败时旧地块不变。
- 保持双击 `index.html`、离线优先、手机文件选择和零安装运行。
- 不新增 npm、构建工具、服务器或第三方依赖。
- 执行前用独立 Git 工作树，保护主目录未跟踪 PDF、`数据/roads.js` 和现有 stash。

---

### Task 1: 面积 JSON 数据边界

**Files:**
- Create: `04_网页程序/area-data.js`
- Create: `04_网页程序/tests/area-data.test.cjs`

**Interfaces:**
- Produces: `AreaData.normalizeAreas(value)`
- Produces: `AreaData.parseAreaBackup(text, expectedVillageName)`
- Produces: `AreaData.polygonArea(points)`
- Produces: `AreaData.summarizeAreas(value)`
- Produces: `AreaData.serializeAreaBackup(value, villageName)`

- [ ] **Step 1: 写失败的往返和拒绝测试**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const AreaData = require("../area-data.js");

const validAreas = [{
  id: "A1001",
  name: "村部东侧农田",
  color: "#16a085",
  pts: [[28.4, 112.89], [28.401, 112.9], [28.39, 112.91]],
}];

test("面积备份导出后可逐项恢复", () => {
  const text = AreaData.serializeAreaBackup(validAreas, "何桥村");
  const backup = AreaData.parseAreaBackup(text, "何桥村");
  assert.deepEqual(backup.areas, validAreas);
  assert.equal(backup.villageName, "何桥村");
});

test("拒绝错误村名和附带代码", () => {
  const text = AreaData.serializeAreaBackup(validAreas, "其他村");
  assert.throws(() => AreaData.parseAreaBackup(text, "何桥村"), /村名/);
  assert.throws(() => AreaData.parseAreaBackup(text + "\nalert(1)", "其他村"));
});

test("拒绝重复编号、少于三个点和越界坐标", () => {
  assert.throws(() => AreaData.normalizeAreas([validAreas[0], validAreas[0]]), /重复/);
  assert.throws(() => AreaData.normalizeAreas([{ ...validAreas[0], pts: [[1, 2], [3, 4]] }]));
  assert.throws(() => AreaData.normalizeAreas([{ ...validAreas[0], pts: [[91, 2], [3, 4], [5, 6]] }]));
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test "04_网页程序/tests/area-data.test.cjs"`

Expected: FAIL，提示 `area-data.js` 不存在。

- [ ] **Step 3: 实现最小纯数据模块**

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AreaData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FORMAT = "village-area-backup";
  const VERSION = 1;
  const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  function normalizeAreas(value) {
    if (!Array.isArray(value)) throw new Error("地块数据必须是数组");
    const ids = new Set();
    return value.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 个地块无效`);
      const id = String(item.id || "");
      if (!ID_RE.test(id) || ids.has(id)) throw new Error(`地块编号无效或重复：${id}`);
      ids.add(id);
      const name = String(item.name || "").trim();
      if (name.length > 40) throw new Error(`地块名称过长：${id}`);
      const color = String(item.color || "#16a085");
      if (!COLOR_RE.test(color)) throw new Error(`地块颜色无效：${id}`);
      if (!Array.isArray(item.pts) || item.pts.length < 3) throw new Error(`地块边界点不足：${id}`);
      const pts = item.pts.map(point => {
        if (!Array.isArray(point) || point.length !== 2 ||
            !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
            point[0] < -90 || point[0] > 90 || point[1] < -180 || point[1] > 180) {
          throw new Error(`地块坐标无效：${id}`);
        }
        return [point[0], point[1]];
      });
      return { id, name, color, pts };
    });
  }

  function parseAreaBackup(text, expectedVillageName) {
    const data = JSON.parse(text);
    if (!data || data.format !== FORMAT || data.version !== VERSION) throw new Error("面积文件格式或版本不支持");
    if (data.villageName !== expectedVillageName) throw new Error("面积文件村名与当前页面不一致");
    return { villageName: data.villageName, areas: normalizeAreas(data.areas) };
  }
```

把 `index.html` 中现有算法原样迁入模块：

```js
function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  const radius = 6378137;
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const lat1 = current[0] * Math.PI / 180;
    const lat2 = next[0] * Math.PI / 180;
    let deltaLng = (next[1] - current[1]) * Math.PI / 180;
    if (deltaLng > Math.PI) deltaLng -= Math.PI * 2;
    if (deltaLng < -Math.PI) deltaLng += Math.PI * 2;
    sum += deltaLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(sum * radius * radius / 2);
}

function summarizeAreas(value) {
  const areas = normalizeAreas(value);
  return {
    areaCount: areas.length,
    squareMeters: areas.reduce((sum, area) => sum + polygonArea(area.pts), 0),
  };
}

function serializeAreaBackup(value, villageName) {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    villageName: String(villageName || "").trim(),
    areas: normalizeAreas(value),
  }, null, 2) + "\n";
}

return { normalizeAreas, parseAreaBackup, polygonArea, summarizeAreas, serializeAreaBackup };
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node --test "04_网页程序/tests/area-data.test.cjs"`

Expected: PASS，0 failures。

- [ ] **Step 5: 提交纯数据边界**

```bash
git add 04_网页程序/area-data.js 04_网页程序/tests/area-data.test.cjs
git commit -m "test: add safe area backup data boundary"
```

---

### Task 2: 面积工具栏导出、选择载入和整体回滚

**Files:**
- Modify: `04_网页程序/index.html`
- Create: `04_网页程序/tests/browser-area-portability.test.cjs`
- Create: `04_网页程序/tests/fixtures/areas-valid.json`
- Create: `04_网页程序/tests/fixtures/areas-with-code.json`
- Create: `04_网页程序/tests/fixtures/areas-wrong-village.json`
- Modify: `04_网页程序/tests/helpers/edge-cdp.cjs`

**Interfaces:**
- Consumes: Task 1 的 `window.AreaData`
- Produces: `replaceAreas(nextAreas)`，成功返回 `true`，失败回滚并返回 `false`
- Produces: `rebuildAreaLayers()`，按当前 `areas` 重建地块图层

- [ ] **Step 1: 写浏览器失败测试**

先定义文件和页面状态：

```js
const path = require("node:path");
const validFile = path.join(__dirname, "fixtures", "areas-valid.json");
const codeFile = path.join(__dirname, "fixtures", "areas-with-code.json");
const wrongVillageFile = path.join(__dirname, "fixtures", "areas-wrong-village.json");

const areaStateExpression = `(() => ({
  areas: JSON.stringify(areas),
  storage: localStorage.getItem(AREA_KEY),
  layerCount: areaLayer.getLayers().length,
  stats: document.querySelector("#stats").textContent
}))()`;
```

`areas-valid.json`：

```json
{
  "format": "village-area-backup",
  "version": 1,
  "villageName": "何桥村",
  "areas": [
    {
      "id": "A2001",
      "name": "测试地块一",
      "color": "#16a085",
      "pts": [[28.4, 112.89], [28.401, 112.9], [28.39, 112.91]]
    },
    {
      "id": "A2002",
      "name": "测试地块二",
      "color": "#8e44ad",
      "pts": [[28.41, 112.88], [28.412, 112.89], [28.405, 112.895]]
    }
  ]
}
```

`areas-wrong-village.json`：

```json
{
  "format": "village-area-backup",
  "version": 1,
  "villageName": "其他村",
  "areas": []
}
```

`areas-with-code.json`：

```text
{"format":"village-area-backup","version":1,"villageName":"何桥村","areas":[]}
alert("不应执行")
```

写出真实导出断言：

```js
test("file 页面导出纯 JSON 并可重新解析", async () => {
  await withFileBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      areas = [{
        id: "A1001", name: "测试地块", color: "#16a085",
        pts: [[28.4, 112.89], [28.401, 112.9], [28.39, 112.91]]
      }];
      localStorage.setItem(AREA_KEY, JSON.stringify(areas));
      rebuildAreaLayers();
      window.__downloadText = "";
      URL.createObjectURL = blob => {
        blob.text().then(text => { window.__downloadText = text; });
        return "blob:test";
      };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () {};
      document.querySelector("#btnExportAreas").click();
      return true;
    })()`);
    await page.waitFor(`window.__downloadText.length > 0`);
    const actual = await page.evaluate(`(() => ({
      backup: AreaData.parseAreaBackup(window.__downloadText, CONFIG.villageName),
      current: areas
    }))()`);
    assert.equal(actual.backup.villageName, "何桥村");
    assert.deepEqual(actual.backup.areas, actual.current);
  });
});
```

写出真实导入和刷新断言：

```js
test("选择面积文件确认后整体覆盖且刷新保留", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      return true;
    })()`);
    await page.setFileInput("#areaFileInput", validFile);
    await page.waitFor(`window.__alerts.some(x => x.includes("已载入"))`);
    const imported = await page.evaluate(`(() => ({
      summary: AreaData.summarizeAreas(areas),
      stored: AreaData.summarizeAreas(JSON.parse(localStorage.getItem(AREA_KEY)))
    }))()`);
    assert.deepEqual(imported.summary, imported.stored);
    assert.equal(imported.summary.areaCount, 2);
    await page.reload(`typeof AreaData !== "undefined" && areas.length === 2`);
    assert.equal(await page.evaluate(`areas.length`), 2);
  });
});
```

再用 `areaStateExpression` 分别断言：`window.confirm = () => false` 后选择
`validFile`、选择 `codeFile`、选择 `wrongVillageFile`、以及把
`Storage.prototype.setItem` 改为对 `AREA_KEY` 抛出 `QuotaExceededError` 后选择
`validFile`；四次操作前后状态必须 `deepEqual`，成功提示不得出现。

- [ ] **Step 2: 运行浏览器测试确认 RED**

Run: `node --test "04_网页程序/tests/browser-area-portability.test.cjs"`

Expected: FAIL，页面没有 `btnExportAreas`、`btnLoadAreas` 或 `AreaData`。

- [ ] **Step 3: 增加最小页面入口**

在 `road-data.js` 后加载：

```html
<script src="area-data.js"></script>
```

在 `areaBar` 空闲区增加：

```html
<button id="btnExportAreas">💾 导出地块文件</button>
<button id="btnLoadAreas">📂 选择地块文件</button>
<input id="areaFileInput" type="file" accept=".json,application/json" hidden>
```

把原内联面积算法替换为：

```js
const polygonArea = AreaData.polygonArea;
```

同时把 `edge-cdp.cjs` 两处 `index.html` 就绪条件补为：

```js
`typeof RoadData !== "undefined" &&
 typeof AreaData !== "undefined" &&
 typeof bigPrint === "function"`
```

- [ ] **Step 4: 实现导出和可回滚覆盖**

```js
function rebuildAreaLayers() {
  areaLayer.clearLayers();
  Object.keys(areaLayers).forEach(id => delete areaLayers[id]);
  areas.forEach(renderArea);
}

function replaceAreas(nextAreas) {
  const candidate = AreaData.normalizeAreas(nextAreas);
  const oldAreas = areas;
  const oldRaw = localStorage.getItem(AREA_KEY);
  try {
    localStorage.setItem(AREA_KEY, JSON.stringify(candidate));
    areas = candidate;
    rebuildAreaLayers();
    refreshStats();
    return true;
  } catch (error) {
    try {
      if (oldRaw === null) localStorage.removeItem(AREA_KEY);
      else localStorage.setItem(AREA_KEY, oldRaw);
      areas = oldAreas;
      rebuildAreaLayers();
      refreshStats();
    } catch (rollbackError) {
      console.error("恢复旧地块失败", rollbackError);
    }
    console.error("载入面积文件失败", error);
    return false;
  }
}
```

增加按钮事件：

```js
document.getElementById("btnExportAreas").addEventListener("click", () => {
  const text = AreaData.serializeAreaBackup(areas, CONFIG.villageName);
  const summary = AreaData.summarizeAreas(areas);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${CONFIG.villageName || "村庄"}-面积地块.json`;
  link.click();
  URL.revokeObjectURL(url);
  alert(`已导出 ${summary.areaCount} 个面积地块`);
});

document.getElementById("btnLoadAreas").addEventListener("click", () => {
  document.getElementById("areaFileInput").click();
});

document.getElementById("areaFileInput").addEventListener("change", async event => {
  const input = event.currentTarget;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const backup = AreaData.parseAreaBackup(await file.text(), CONFIG.villageName);
    const summary = AreaData.summarizeAreas(backup.areas);
    const emptyWarning = summary.areaCount === 0
      ? "\n警告：该文件没有地块，确认后会清空当前全部地块。"
      : "";
    const approved = confirm(
      `文件村名：${backup.villageName}\n` +
      `地块数量：${summary.areaCount} 个\n` +
      `总面积：约 ${Math.round(summary.squareMeters)} 平方米 / ` +
      `${(summary.squareMeters / 666.6667).toFixed(2)} 亩\n` +
      `当前已有：${areas.length} 个\n\n确认后将整体覆盖当前地块。${emptyWarning}`
    );
    if (!approved) return;
    if (!replaceAreas(backup.areas)) throw new Error("浏览器无法保存或显示地块");
    alert(`已载入 ${summary.areaCount} 个面积地块`);
  } catch (error) {
    console.error(error);
    alert(`无法载入面积文件，现有地块没有改变。\n${error.message}`);
  } finally {
    input.value = "";
  }
});
```

- [ ] **Step 5: 运行面积浏览器测试确认 GREEN**

Run: `node --test "04_网页程序/tests/browser-area-portability.test.cjs"`

Expected: 3/3 PASS。

- [ ] **Step 6: 提交页面功能**

```bash
git add 04_网页程序/index.html 04_网页程序/tests/browser-area-portability.test.cjs 04_网页程序/tests/fixtures/areas-valid.json 04_网页程序/tests/fixtures/areas-with-code.json 04_网页程序/tests/fixtures/areas-wrong-village.json 04_网页程序/tests/helpers/edge-cdp.cjs
git commit -m "feat: add area backup import and export"
```

---

### Task 3: 使用说明、全量回归和交付记录

**Files:**
- Modify: `README.md`
- Modify: `04_网页程序/使用说明.txt`
- Modify: `04_网页程序/换电脑迁移说明.txt`
- Modify: `项目说明.md`
- Modify: `项目日志.md`
- Modify: `对话交接记录.md`
- Modify: `04_网页程序/tests/project-regression.test.cjs`

**Interfaces:**
- Documents: `area-data.js` 必须与 `index.html` 同级
- Documents: 换电脑前导出 JSON，新电脑手动选择并整体覆盖

- [ ] **Step 1: 更新说明和固定文件清单**

明确写出：

```text
面积地块仍自动保存在当前浏览器。
换电脑前点击【导出地块文件】得到“何桥村-面积地块.json”。
新电脑点击【选择地块文件】，核对村名、地块数和总面积后确认覆盖。
仅复制网页文件夹不会携带浏览器里的面积地块。
area-data.js 与 index.html 必须在同一目录。
```

- [ ] **Step 2: 运行全部测试**

```bash
node --test "04_网页程序/tests/area-data.test.cjs"
node --test "04_网页程序/tests/road-data.test.cjs"
node --test "04_网页程序/tests/project-regression.test.cjs"
node --test "04_网页程序/tests/data-tool.test.cjs"
node --test "04_网页程序/tests/browser-area-portability.test.cjs"
node --test "04_网页程序/tests/browser-road-portability.test.cjs"
git diff --check
```

Expected: 所有测试 0 failures；道路 51/51/48/597 不变；快速/A0/A3×4 打印回归通过。

- [ ] **Step 3: 核对范围**

Run: `git status --short`

Expected: 仅出现计划内代码、测试和文档；客户 PDF、照片、`data.js`、`roads.js`
及 `数据/roads.js` 未被暂存或修改。

- [ ] **Step 4: 提交文档与最终记录**

```bash
git add README.md 04_网页程序/使用说明.txt 04_网页程序/换电脑迁移说明.txt 项目说明.md 项目日志.md 对话交接记录.md 04_网页程序/tests/project-regression.test.cjs
git commit -m "039 完成面积地块独立文件迁移"
```

- [ ] **Step 5: 最终复核**

Run: `git status --short --branch`

Expected: 功能工作树无计划内未提交改动；只保留明确受保护的用户文件。

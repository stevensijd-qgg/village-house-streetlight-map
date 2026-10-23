const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { withBrowserPage, withFileBrowserPage } = require("./helpers/edge-cdp.cjs");

const validFile = path.join(__dirname, "fixtures", "areas-valid.json");
const emptyFile = path.join(__dirname, "fixtures", "areas-empty.json");
const codeFile = path.join(__dirname, "fixtures", "areas-with-code.json");
const wrongVillageFile = path.join(__dirname, "fixtures", "areas-wrong-village.json");

const oldArea = {
  id: "A1001",
  name: "原有地块",
  color: "#1677c8",
  pts: [[28.4, 112.89], [28.401, 112.9], [28.39, 112.91]],
};

const seedOldAreaExpression = `(() => {
  areas = [${JSON.stringify(oldArea)}];
  localStorage.setItem(AREA_KEY, JSON.stringify(areas));
  areaLayer.clearLayers();
  Object.keys(areaLayers).forEach(id => delete areaLayers[id]);
  areas.forEach(renderArea);
  refreshStats();
  return true;
})()`;

const areaStateExpression = `(() => ({
  areas: JSON.stringify(areas),
  storage: localStorage.getItem(AREA_KEY),
  layerIds: Object.keys(areaLayers).sort(),
  layerCount: areaLayer.getLayers().length,
  stats: document.querySelector("#stats").textContent
}))()`;

test("file 页面导出纯 JSON 面积备份", async () => {
  await withFileBrowserPage("index.html", async page => {
    await page.evaluate(seedOldAreaExpression);
    await page.evaluate(`(() => {
      window.__downloadText = "";
      window.__downloadName = "";
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      URL.createObjectURL = blob => {
        blob.text().then(text => { window.__downloadText = text; });
        return "blob:test";
      };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () {
        window.__downloadName = this.download;
      };
      document.querySelector("#btnExportAreas").click();
      return true;
    })()`);
    await page.waitFor(`window.__downloadText.length > 0`);
    const actual = await page.evaluate(`(() => ({
      backup: JSON.parse(window.__downloadText),
      name: window.__downloadName
    }))()`);

    assert.equal(actual.name, "何桥村-面积地块.json");
    assert.deepEqual(actual.backup, {
      format: "village-area-backup",
      version: 1,
      villageName: "何桥村",
      areas: [oldArea],
    });
    assert.match(
      (await page.evaluate(`window.__alerts.slice()`)).join("\n"),
      /已导出 1 个面积地块/
    );
    assert.equal(page.exceptions.length, 0);
  });
});

test("确认载入后整体覆盖并在刷新后保留", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(seedOldAreaExpression);
    await page.evaluate(`(() => {
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      return true;
    })()`);

    await page.setFileInput("#areaFileInput", validFile);
    await page.waitFor(`window.__alerts.some(message => message.includes("已载入"))`);
    const actual = await page.evaluate(`(() => ({
      areas,
      stored: JSON.parse(localStorage.getItem(AREA_KEY)),
      layerIds: Object.keys(areaLayers).sort(),
      layerCount: areaLayer.getLayers().length,
      stats: document.querySelector("#stats").textContent,
      inputValue: document.querySelector("#areaFileInput").value
    }))()`);

    assert.equal(actual.areas.length, 2);
    assert.deepEqual(actual.stored, actual.areas);
    assert.deepEqual(actual.layerIds, ["A2001", "A2002"]);
    assert.equal(actual.layerCount, 2);
    assert.match(actual.stats, /圈地\s*2\s*块/);
    assert.equal(actual.inputValue, "");

    await page.evaluate(`window.__alerts = []`);
    await page.setFileInput("#areaFileInput", validFile);
    await page.waitFor(`window.__alerts.some(message => message.includes("已载入"))`);
    assert.equal(await page.evaluate(`areas.length`), 2);

    await page.reload(`typeof AreaData !== "undefined" && areas.length === 2`);
    assert.equal(await page.evaluate(`areas.length`), 2);
    assert.equal(page.exceptions.length, 0);
  });
});

test("取消载入时现有地块保持不变", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(seedOldAreaExpression);
    const before = await page.evaluate(areaStateExpression);
    await page.evaluate(`(() => {
      window.__confirmMessages = [];
      window.alert = () => {};
      window.confirm = message => {
        window.__confirmMessages.push(String(message));
        return false;
      };
      return true;
    })()`);

    await page.setFileInput("#areaFileInput", validFile);
    await page.waitFor(`window.__confirmMessages.length === 1`);
    await page.waitFor(`document.querySelector("#areaFileInput").value === ""`);
    assert.deepEqual(await page.evaluate(areaStateExpression), before);

    await page.setFileInput("#areaFileInput", emptyFile);
    await page.waitFor(`window.__confirmMessages.length === 2`);
    assert.match(
      await page.evaluate(`window.__confirmMessages[1]`),
      /没有地块|清空/
    );
    assert.deepEqual(await page.evaluate(areaStateExpression), before);
  });
});

test("附带代码或村名不符的面积文件不会改变现有地块", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(seedOldAreaExpression);
    const before = await page.evaluate(areaStateExpression);
    await page.evaluate(`(() => {
      window.__areaFileExecuted = false;
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      return true;
    })()`);

    await page.setFileInput("#areaFileInput", codeFile);
    await page.waitFor(`window.__alerts.length > 0`);
    assert.deepEqual(await page.evaluate(areaStateExpression), before);
    assert.equal(await page.evaluate(`window.__areaFileExecuted`), false);

    await page.evaluate(`window.__alerts = []`);
    await page.setFileInput("#areaFileInput", wrongVillageFile);
    await page.waitFor(`window.__alerts.length > 0`);
    assert.deepEqual(await page.evaluate(areaStateExpression), before);
    assert.match(
      (await page.evaluate(`window.__alerts.slice()`)).join("\n"),
      /村名|无法载入/
    );
  });
});

test("浏览器存储失败时现有地块保持不变", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(seedOldAreaExpression);
    const before = await page.evaluate(areaStateExpression);
    await page.evaluate(`(() => {
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      window.__nativeAreaStorageSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === AREA_KEY) {
          throw new DOMException("测试写入失败", "QuotaExceededError");
        }
        return window.__nativeAreaStorageSetItem.call(this, key, value);
      };
      return true;
    })()`);

    await page.setFileInput("#areaFileInput", validFile);
    await page.waitFor(`window.__alerts.length > 0`);
    const after = await page.evaluate(areaStateExpression);
    const alerts = await page.evaluate(`window.__alerts.slice()`);
    await page.evaluate(
      `Storage.prototype.setItem = window.__nativeAreaStorageSetItem`
    );

    assert.deepEqual(after, before);
    assert.match(alerts.join("\n"), /无法载入|无法保存/);
    assert.doesNotMatch(alerts.join("\n"), /已载入/);
    assert.equal(page.exceptions.length, 0);
  });
});

test("候选地块渲染持续失败时旧存档和旧地图保持不变", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(seedOldAreaExpression);
    const before = await page.evaluate(areaStateExpression);
    await page.evaluate(`(() => {
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      window.__nativeAreaLayerGroup = L.layerGroup;
      L.layerGroup = function () {
        throw new Error("测试候选图层构建失败");
      };
      return true;
    })()`);

    await page.setFileInput("#areaFileInput", validFile);
    await page.waitFor(`window.__alerts.length > 0`);
    await page.evaluate(`L.layerGroup = window.__nativeAreaLayerGroup`);
    const after = await page.evaluate(areaStateExpression);
    const alerts = await page.evaluate(`window.__alerts.slice()`);

    assert.deepEqual(after, before);
    assert.match(alerts.join("\n"), /无法载入/);
    assert.doesNotMatch(alerts.join("\n"), /已载入/);
  });
});

test("原有圈地新增、删除和清空仍可使用", async () => {
  await withBrowserPage("index.html", async page => {
    const actual = await page.evaluate(`(() => {
      areas = [];
      localStorage.setItem(AREA_KEY, "[]");
      rebuildAreaLayers();
      window.confirm = () => true;
      window.alert = () => {};

      startAreaDraw();
      addAreaPoint(L.latLng(28.4, 112.89));
      addAreaPoint(L.latLng(28.401, 112.9));
      addAreaPoint(L.latLng(28.39, 112.91));
      finishAreaDraw();
      const createdId = areas[0].id;
      const afterCreate = {
        count: areas.length,
        stored: JSON.parse(localStorage.getItem(AREA_KEY)).length,
        layers: areaLayer.getLayers().length
      };

      deleteArea(createdId);
      const afterDelete = {
        count: areas.length,
        stored: JSON.parse(localStorage.getItem(AREA_KEY)).length,
        layers: areaLayer.getLayers().length
      };

      areas = [${JSON.stringify(oldArea)}, {
        ...${JSON.stringify(oldArea)},
        id: "A1002",
        name: "第二块地"
      }];
      saveAreas();
      rebuildAreaLayers();
      document.querySelector("#btnClearAreas").click();
      const afterClear = {
        count: areas.length,
        stored: JSON.parse(localStorage.getItem(AREA_KEY)).length,
        layers: areaLayer.getLayers().length
      };
      return { afterCreate, afterDelete, afterClear };
    })()`);

    assert.deepEqual(actual.afterCreate, { count: 1, stored: 1, layers: 1 });
    assert.deepEqual(actual.afterDelete, { count: 0, stored: 0, layers: 0 });
    assert.deepEqual(actual.afterClear, { count: 0, stored: 0, layers: 0 });
    assert.equal(page.exceptions.length, 0);
  });
});

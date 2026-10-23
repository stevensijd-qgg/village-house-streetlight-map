const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { withBrowserPage, withFileBrowserPage } = require("./helpers/edge-cdp.cjs");

const validFile = path.join(__dirname, "fixtures", "roads-with-lamps.js");
const codeFile = path.join(__dirname, "fixtures", "roads-with-code.js");
const reservedFiles = [
  ["__proto__", path.join(__dirname, "fixtures", "roads-reserved-proto.js")],
  ["constructor", path.join(__dirname, "fixtures", "roads-reserved-constructor.js")],
  ["toString", path.join(__dirname, "fixtures", "roads-reserved-tostring.js")],
];
const prototypeTypeFile = path.join(__dirname, "fixtures", "roads-prototype-type.js");

const roadStateExpression = `(() => {
  const fingerprint = value => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return text.length + ":" + (hash >>> 0);
  };
  const stored = localStorage.getItem(ROAD_KEY);
  return {
    roads: fingerprint(roads),
    layerIds: fingerprint(Object.keys(roadLayers).sort()),
    layerCount: roadLayer.getLayers().length,
    storage: stored === null ? null : fingerprint(stored),
    stats: document.querySelector("#stats").textContent,
    roadListCount: document.querySelectorAll("#sidebar .lamp-btn").length
  };
})()`;

test("全新何桥村页面显示标准路灯道路", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`localStorage.clear(); true`);
    await page.reload(
      `typeof RoadData !== "undefined" && typeof roads !== "undefined" && roads.length > 0`
    );
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

test("file:// 双击语义可载入本地脚本、标准道路和地图图层", async () => {
  await withFileBrowserPage("index.html", async page => {
    const actual = await page.evaluate(`(() => ({
      protocol: location.protocol,
      village: CONFIG.villageName,
      summary: RoadData.summarizeRoads(roads),
      renderedRoads: Object.keys(roadLayers).length,
      leafletLoaded: typeof L === "object" && typeof L.map === "function"
    }))()`);
    assert.deepEqual(actual, {
      protocol: "file:",
      village: "何桥村",
      summary: {
        roadCount: 51, lampedCount: 51, positiveLampCount: 48, lampTotal: 597,
      },
      renderedRoads: 51,
      leafletLoaded: true,
    });
    assert.equal(page.exceptions.length, 0);
  });
});

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

    await page.reload(
      `typeof RoadData !== "undefined" && typeof roads !== "undefined" && roads.length === 2`
    );
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
    await page.waitFor(`window.__confirmCalled`);
    const after = await page.evaluate(`JSON.stringify(roads)`);
    assert.equal(after, before);
  });
});

test("每个对象原型保留编号都被拒绝且刷新前后道路状态保持原样", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      return true;
    })()`);
    const before = await page.evaluate(roadStateExpression);
    assert.equal(await page.evaluate(`Object.getPrototypeOf(roadLayers) === null`), true);

    for (const [id, file] of reservedFiles) {
      await page.evaluate(`window.__alerts = []`);
      await page.setFileInput("#roadFileInput", file);
      await page.waitFor(`window.__alerts.length > 0`);
      const after = await page.evaluate(roadStateExpression);
      const alerts = await page.evaluate(`window.__alerts.slice()`);
      assert.deepEqual(after, before, `${id} 导入失败后状态发生变化`);
      assert.match(alerts.join("\n"), /无法载入道路文件.*现有道路没有改变/s);
      assert.doesNotMatch(alerts.join("\n"), /已载入/);
    }

    await page.reload(`typeof RoadData !== "undefined" && typeof roads !== "undefined"`);
    assert.deepEqual(await page.evaluate(roadStateExpression), before);
    assert.equal(page.exceptions.length, 0);
  });
});

test("未知路面类型不命中 ROAD_TYPES 原型并按泥路样式渲染", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      return true;
    })()`);
    await page.setFileInput("#roadFileInput", prototypeTypeFile);
    await page.waitFor(`window.__alerts.some(message => message.includes("已载入"))`);
    const actual = await page.evaluate(`(() => ({
      color: roadLayers["SAFE-TYPE"].main.options.color,
      dashArray: roadLayers["SAFE-TYPE"].main.options.dashArray,
      layerIndexHasNullPrototype: Object.getPrototypeOf(roadLayers) === null
    }))()`);
    assert.deepEqual(actual, {
      color: "#e67e22",
      dashArray: "10 8",
      layerIndexHasNullPrototype: true,
    });
    assert.equal(page.exceptions.length, 0);
  });
});

test("localStorage 写入失败时导入不改变内存图层存储列表统计且不提示成功", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.setItem(ROAD_KEY, JSON.stringify(roads));
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      window.__nativeStorageSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === ROAD_KEY) throw new DOMException("测试写入失败", "QuotaExceededError");
        return window.__nativeStorageSetItem.call(this, key, value);
      };
      return true;
    })()`);
    const before = await page.evaluate(roadStateExpression);
    await page.setFileInput("#roadFileInput", validFile);
    await page.waitFor(`window.__alerts.length > 0`);
    const after = await page.evaluate(roadStateExpression);
    const alerts = await page.evaluate(`window.__alerts.slice()`);
    await page.evaluate(`Storage.prototype.setItem = window.__nativeStorageSetItem`);
    assert.deepEqual(after, before);
    assert.match(alerts.join("\n"), /无法保存|无法载入/);
    assert.doesNotMatch(alerts.join("\n"), /已载入/);
    assert.equal(page.exceptions.length, 0);
  });
});

test("持久化成功后若图层交换失败会回滚存储和全部可见状态", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.setItem(ROAD_KEY, JSON.stringify(roads));
      window.__alerts = [];
      window.alert = message => window.__alerts.push(String(message));
      window.confirm = () => true;
      const nativeGetElementById = document.getElementById.bind(document);
      let failed = false;
      document.getElementById = function (id) {
        if (id === "stats" && !failed) {
          failed = true;
          return null;
        }
        return nativeGetElementById(id);
      };
      window.__restoreRoadAddLayer = () => {
        document.getElementById = nativeGetElementById;
      };
      return true;
    })()`);
    const before = await page.evaluate(roadStateExpression);
    await page.setFileInput("#roadFileInput", validFile);
    await page.waitFor(`window.__alerts.length > 0`);
    await page.evaluate(`window.__restoreRoadAddLayer()`);
    const after = await page.evaluate(roadStateExpression);
    const alerts = await page.evaluate(`window.__alerts.slice()`);
    assert.deepEqual(after, before);
    assert.match(alerts.join("\n"), /无法载入/);
    assert.doesNotMatch(alerts.join("\n"), /已载入/);
    assert.equal(page.exceptions.length, 0);
  });
});

test("村名变更时迁移非道路状态但不串读其他村道路", async () => {
  await withBrowserPage("index.html", async page => {
    const actual = await page.evaluate(`(() => {
      localStorage.clear();
      const oldVillage = "示例村";
      const currentVillage = CONFIG.villageName || "village";
      localStorage.setItem("rentedMark_" + oldVillage, JSON.stringify({ BMZ001: true }));
      localStorage.setItem("houseIconSize_" + oldVillage, "31");
      localStorage.setItem("areaData_" + oldVillage, JSON.stringify([{
        id: "OLD-AREA", name: "旧村地块", color: "#16a085",
        pts: [[28.4, 112.89], [28.41, 112.9], [28.4, 112.9]]
      }]));
      const oldRoad = JSON.stringify([{ id: "OLD-ROAD", name: "旧村道路" }]);
      const otherRoad = JSON.stringify([{ id: "OTHER-ROAD", name: "其他村道路" }]);
      const currentRoad = JSON.stringify([{ id: "CURRENT-ROAD", name: "当前村道路" }]);
      localStorage.setItem("roadData_" + oldVillage, oldRoad);
      localStorage.setItem("roadData_其他村", otherRoad);
      const roadWhenCurrentAbsent = lsReadRoadData();
      const currentRoadKeyCreatedAfterAbsent =
        localStorage.getItem("roadData_" + currentVillage) !== null;
      localStorage.setItem("roadData_" + currentVillage, currentRoad);
      return {
        rented: lsRead("rentedMark_"),
        iconSize: lsRead("houseIconSize_"),
        areas: lsRead("areaData_"),
        currentRentedKeyCreated: localStorage.getItem("rentedMark_" + currentVillage) !== null,
        currentIconKeyCreated: localStorage.getItem("houseIconSize_" + currentVillage) !== null,
        currentAreaKeyCreated: localStorage.getItem("areaData_" + currentVillage) !== null,
        roadWhenCurrentAbsent,
        currentRoadKeyCreatedAfterAbsent,
        roadWhenCurrentPresent: lsReadRoadData(),
        oldRoadStillPresent: localStorage.getItem("roadData_" + oldVillage) === oldRoad,
        otherKeyStillPresent: localStorage.getItem("roadData_其他村") !== null,
      };
    })()`);
    assert.deepEqual(actual, {
      rented: JSON.stringify({ BMZ001: true }),
      iconSize: "31",
      areas: JSON.stringify([{
        id: "OLD-AREA", name: "旧村地块", color: "#16a085",
        pts: [[28.4, 112.89], [28.41, 112.9], [28.4, 112.9]]
      }]),
      currentRentedKeyCreated: true,
      currentIconKeyCreated: true,
      currentAreaKeyCreated: true,
      roadWhenCurrentAbsent: null,
      currentRoadKeyCreatedAfterAbsent: false,
      roadWhenCurrentPresent: JSON.stringify([{ id: "CURRENT-ROAD", name: "当前村道路" }]),
      oldRoadStillPresent: true,
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

test("导出后编辑道路名称再点击地图仍使用同一个新道路对象", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__downloadText = "";
      window.alert = () => {};
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
      const road = roads[0];
      const id = road.id;
      const nextName = "导出后新道路名称";
      setRoad(id, "name", nextName);
      map.closePopup();
      roadLayers[id].main.fire("click", { latlng: L.latLng(road.pts[0]) });
      const popupName = document.querySelector(".leaflet-popup-content h3").textContent;
      document.querySelector(".leaflet-popup-content .rent-btn").click();
      const result = {
        memoryName: roads.find(item => item.id === id).name,
        popupName,
        editingName: editing.r.name,
        editingTitle: document.querySelector("#edName").textContent,
      };
      edCancel();
      return result;
    })()`);
    assert.deepEqual(actual, {
      memoryName: "导出后新道路名称",
      popupName: "导出后新道路名称",
      editingName: "导出后新道路名称",
      editingTitle: "导出后新道路名称",
    });
    assert.equal(page.exceptions.length, 0);
  });
});

test("快速打印实际调用 printMap 并等待 window.print", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls++; };
      printMap();
      return true;
    })()`);
    await page.waitFor(`window.__printCalls === 1`, 3000);
    const actual = await page.evaluate(`(() => ({
      printCalls: window.__printCalls,
      printing: document.body.classList.contains("printing"),
      title: document.querySelector("#printTitle").textContent,
      roadLegendPresent: document.querySelector("#printLegend").textContent.includes("柏油路")
    }))()`);
    assert.deepEqual(actual, {
      printCalls: 1,
      printing: true,
      title: "何桥村出租房屋分布图",
      roadLegendPresent: true,
    });
    assert.equal(page.exceptions.length, 0);
    await page.evaluate(`window.dispatchEvent(new Event("afterprint")); true`);
  });
});

test("高清 A0 实际建立道路 DOM 并等待 window.print", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__nativeImage = window.Image;
      window.Image = function () {
        const image = document.createElement("img");
        Object.defineProperty(image, "src", {
          configurable: true,
          set(value) {
            image.dataset.testSrc = value;
            queueMicrotask(() => { if (typeof image.onload === "function") image.onload(); });
          }
        });
        return image;
      };
      window.__printCalls = 0;
      window.print = () => { window.__printCalls++; };
      bigPrint("A0", {z:17, sc:0.7942, fit:true});
      return true;
    })()`);
    await page.waitFor(`window.__printCalls === 1`, 5000);
    const highResolution = await page.evaluate(`(() => {
      const root = document.querySelector("#bigPrint");
      return {
        printCalls: window.__printCalls,
        exists: Boolean(root),
        pages: root ? root.querySelectorAll(".big-sheet").length : 0,
        title: root ? root.textContent : "",
        roadPaths: root ? root.querySelectorAll(
          '.big-page-map > svg > path[fill="none"]'
        ).length : 0,
      }
    })()`);
    assert.equal(highResolution.printCalls, 1);
    assert.equal(highResolution.exists, true);
    assert.equal(highResolution.pages, 1);
    assert.match(highResolution.title, /何桥村/);
    assert.equal(highResolution.roadPaths > 0, true);
    assert.equal(page.exceptions.length, 0);
    await page.evaluate(`(() => {
      window.Image = window.__nativeImage;
      window.dispatchEvent(new Event("afterprint"));
      return true;
    })()`);
  });
});

test("何桥村 A3 四页拼图生成四页并调用 window.print", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      window.__nativeImage = window.Image;
      window.Image = function () {
        const image = document.createElement("img");
        Object.defineProperty(image, "src", {
          configurable: true,
          set(value) {
            image.dataset.testSrc = value;
            queueMicrotask(() => { if (typeof image.onload === "function") image.onload(); });
          }
        });
        return image;
      };
      window.__printCalls = 0;
      window.print = () => { window.__printCalls++; };
      bigPrint("A3", {z:18, fit:true, cols:2, rows:2, autoScale:true});
      return true;
    })()`);
    await page.waitFor(`window.__printCalls === 1`, 5000);
    const actual = await page.evaluate(`(() => {
      const root = document.querySelector("#bigPrint");
      return {
        printCalls: window.__printCalls,
        pages: root ? root.querySelectorAll(".big-sheet").length : 0,
        maps: root ? root.querySelectorAll(".big-page-map").length : 0,
      }
    })()`);
    assert.deepEqual(actual, { printCalls: 1, pages: 4, maps: 4 });
    assert.equal(page.exceptions.length, 0);
    await page.evaluate(`(() => {
      window.Image = window.__nativeImage;
      window.dispatchEvent(new Event("afterprint"));
      return true;
    })()`);
  });
});

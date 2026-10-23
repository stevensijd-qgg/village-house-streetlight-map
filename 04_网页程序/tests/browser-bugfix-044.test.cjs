const test = require("node:test");
const assert = require("node:assert/strict");
const { withBrowserPage } = require("./helpers/edge-cdp.cjs");

const stubDialogs = `(() => {
  window.__alerts = [];
  window.alert = message => window.__alerts.push(String(message));
  window.confirm = () => true;
  return true;
})()`;

test("填盏数自动勾选有路灯，刷新后仍一致", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem(ROAD_KEY, JSON.stringify([{
        id: "R1", name: "测试路", type: "水泥路", width: 5, lamped: false, lamps: 0,
        pts: [[28.40, 112.89], [28.401, 112.891]],
      }]));
      return true;
    })()`);
    await page.reload("typeof setRoad === 'function'");
    const before = await page.evaluate(`(() => {
      setRoad("R1", "lamps", "6");
      const r = roads.find(x => x.id === "R1");
      return { lamped: r.lamped, lamps: r.lamps, hasLampLine: !!roadLayers.R1.lamp };
    })()`);
    assert.deepEqual(before, { lamped: true, lamps: 6, hasLampLine: true });
    await page.reload("typeof setRoad === 'function'");
    const after = await page.evaluate(`(() => {
      const r = roads.find(x => x.id === "R1");
      return { lamped: r.lamped, lamps: r.lamps };
    })()`);
    assert.deepEqual(after, { lamped: true, lamps: 6 });
  });
});

test("道路弹窗开着时填盏数，弹窗里的有路灯勾选框同步勾上", async () => {
  await withBrowserPage("index.html", async page => {
    const actual = await page.evaluate(`(() => {
      localStorage.clear();
      replaceRoads([{ id: "R3", name: "弹窗路", type: "泥路", width: 5, lamped: false, lamps: 0,
        pts: [[28.40, 112.89], [28.401, 112.891]] }]);
      locateRoad("R3");
      const box = document.querySelector('.leaflet-popup input[type=checkbox][data-road="R3"]');
      const before = box.checked;
      setRoad("R3", "lamps", "3");
      return { before, after: box.checked };
    })()`);
    assert.deepEqual(actual, { before: false, after: true });
  });
});

test("取消有路灯会把盏数清零，刷新后不再被改回有路灯", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem(ROAD_KEY, JSON.stringify([{
        id: "R2", name: "亮化路", type: "柏油路", width: 5, lamped: true, lamps: 4,
        pts: [[28.40, 112.89], [28.401, 112.891]],
      }]));
      return true;
    })()`);
    await page.reload("typeof toggleLamped === 'function'");
    await page.evaluate(stubDialogs);
    await page.evaluate(`toggleLamped("R2"); true`);
    await page.reload("typeof toggleLamped === 'function'");
    const actual = await page.evaluate(`(() => {
      const r = roads.find(x => x.id === "R2");
      return { lamped: r.lamped, lamps: r.lamps, label: !!roadLayers.R2.label };
    })()`);
    assert.deepEqual(actual, { lamped: false, lamps: 0, label: false });
  });
});

test("本机地块存档里有坏数据时页面照常初始化并保留有效地块", async () => {
  await withBrowserPage("index.html", async page => {
    await page.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem(AREA_KEY, JSON.stringify([
        { id: "A1", name: "好地块", color: "#16a085",
          pts: [[28.40, 112.89], [28.401, 112.89], [28.401, 112.891]] },
        { id: "A2", name: "坏地块", color: "#16a085", pts: null },
      ]));
      return true;
    })()`);
    await page.reload("typeof bigPrint === 'function'");
    const actual = await page.evaluate(`(() => ({
      ids: areas.map(a => a.id),
      layerIds: Object.keys(areaLayers),
      houses: Object.keys(markers).length === HOUSES.length && HOUSES.length > 0,
      listReady: document.querySelectorAll("#sidebar .item").length > 0,
    }))()`);
    assert.deepEqual(actual.ids, ["A1"]);
    assert.deepEqual(actual.layerIds, ["A1"]);
    assert.equal(actual.houses, true);
    assert.equal(actual.listReady, true);
  });
});

test("画路时点到房屋按加点处理且不弹房屋窗口", async () => {
  await withBrowserPage("index.html", async page => {
    const actual = await page.evaluate(`(() => {
      localStorage.clear();
      startDraw();
      const id = HOUSES[0].id;
      markers[id].fire("click", { latlng: markers[id].getLatLng(),
        originalEvent: new MouseEvent("click") });
      const result = { pts: drawing.pts.length, popupOpen: markers[id].isPopupOpen() };
      endDraw();
      return result;
    })()`);
    assert.deepEqual(actual, { pts: 1, popupOpen: false });
  });
});

test("缺经纬度的点不进地图、不拉偏全村取景", async () => {
  await withBrowserPage("index.html", async page => {
    const actual = await page.evaluate(`(() => ({
      valid: HOUSES.every(validLatLng),
      zero: validLatLng({ lat: 0, lng: 0 }),
      boundsWest: dataBounds().getWest() > 100,
    }))()`);
    assert.deepEqual(actual, { valid: true, zero: false, boundsWest: true });
  });
});

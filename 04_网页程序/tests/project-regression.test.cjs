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

test("项目当前数据属于何桥村且为 24 处虚构示例房屋", () => {
  const data = executeDataFile("data.js");
  assert.equal(data.CONFIG.villageName, "何桥村");
  assert.equal(data.HOUSES.length, 24);
});

test("默认道路是已规范化的 51 条路灯标注标准版", () => {
  const data = executeDataFile("roads.js");
  const roads = RoadData.normalizeRoads(data.ROADS);
  assert.deepEqual(RoadData.summarizeRoads(roads), {
    roadCount: 51, lampedCount: 51, positiveLampCount: 48, lampTotal: 597,
  });
  assert.equal(roads.every(road =>
    typeof road.lamped === "boolean" &&
    Number.isInteger(road.lamps) && road.lamps >= 0
  ), true);
  const zeros = Array.from(
    roads.filter(road => road.lamps === 0).map(road => road.name)
  ).sort();
  assert.deepEqual(zeros, ["路灯21补充", "路灯25补充", "路灯4"].sort());
});

test("默认 roads.js 与标准道路来源规范化后逐项完全一致", () => {
  const source = fs.readFileSync(
    path.join(root, "road", "roads-路灯标注版.js"),
    "utf8"
  );
  const canonicalRoads = RoadData.parseRoadsFile(source);
  const defaultRoads = RoadData.normalizeRoads(executeDataFile("roads.js").ROADS);
  assert.equal(JSON.stringify(defaultRoads), JSON.stringify(canonicalRoads));
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

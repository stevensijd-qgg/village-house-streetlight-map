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

for (const id of ["__proto__", "constructor", "toString"]) {
  test(`拒绝会命中对象原型的道路编号 ${id}`, () => {
    assert.throws(() => api.normalizeRoads([{
      id,
      name: "原型键道路",
      type: "水泥路",
      width: 5,
      pts: [[28.4, 112.89], [28.41, 112.9]],
      lamped: false,
      lamps: 0,
    }]), /道路第 1 条.*id.*保留|道路第 1 条.*原型/);
  });
}

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

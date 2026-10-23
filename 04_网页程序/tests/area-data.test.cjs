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

  assert.equal(backup.villageName, "何桥村");
  assert.deepEqual(backup.areas, validAreas);
  assert.deepEqual(JSON.parse(text), {
    format: "village-area-backup",
    version: 1,
    villageName: "何桥村",
    areas: validAreas,
  });
});

test("拒绝重复编号和危险编号", () => {
  assert.throws(
    () => AreaData.normalizeAreas([validAreas[0], validAreas[0]]),
    /重复/
  );
  for (const id of ["__proto__", "constructor", "toString"]) {
    assert.throws(
      () => AreaData.normalizeAreas([{ ...validAreas[0], id }]),
      /编号/
    );
  }
});

test("接受下划线或连字符开头的普通编号", () => {
  const normalized = AreaData.normalizeAreas([
    { ...validAreas[0], id: "_A1" },
    { ...validAreas[0], id: "-plot" },
  ]);
  assert.deepEqual(normalized.map(area => area.id), ["_A1", "-plot"]);
});

test("拒绝超长名称和错误颜色", () => {
  assert.throws(
    () => AreaData.normalizeAreas([{ ...validAreas[0], name: "地".repeat(41) }]),
    /名称/
  );
  assert.throws(
    () => AreaData.normalizeAreas([{ ...validAreas[0], color: "red" }]),
    /颜色/
  );
});

test("拒绝少于三个边界点和越界坐标", () => {
  assert.throws(
    () => AreaData.normalizeAreas([{ ...validAreas[0], pts: [[1, 2], [3, 4]] }]),
    /边界点/
  );
  assert.throws(
    () => AreaData.normalizeAreas([{
      ...validAreas[0],
      pts: [[91, 112.89], [28.401, 112.9], [28.39, 112.91]],
    }]),
    /坐标/
  );
});

test("拒绝错误村名和附带代码", () => {
  const otherVillage = AreaData.serializeAreaBackup(validAreas, "其他村");
  assert.throws(
    () => AreaData.parseAreaBackup(otherVillage, "何桥村"),
    /村名/
  );

  globalThis.__areaCodeExecuted = false;
  const withCode = AreaData.serializeAreaBackup(validAreas, "何桥村") +
    "\nglobalThis.__areaCodeExecuted = true";
  assert.throws(() => AreaData.parseAreaBackup(withCode, "何桥村"));
  assert.equal(globalThis.__areaCodeExecuted, false);
});

test("按边界坐标汇总地块数和总平方米", () => {
  const square = {
    id: "A2001",
    name: "约一万平方米地块",
    color: "#8e44ad",
    pts: [[28.4, 112.89], [28.4, 112.891], [28.401, 112.891], [28.401, 112.89]],
  };
  const second = { ...square, id: "A2002" };

  const oneArea = AreaData.polygonArea(square.pts);
  const summary = AreaData.summarizeAreas([square, second]);

  assert.ok(oneArea > 10000 && oneArea < 12000, `实际面积 ${oneArea}`);
  assert.equal(summary.areaCount, 2);
  assert.ok(summary.squareMeters > 20000 && summary.squareMeters < 24000);
});

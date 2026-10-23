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
    const id = road.id.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      roadError(index, "id 只能包含英文字母、数字、下划线和连字符");
    }
    if (Object.prototype.hasOwnProperty.call(Object.prototype, id)) {
      roadError(index, "id 不能使用对象原型保留名称");
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
      id,
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

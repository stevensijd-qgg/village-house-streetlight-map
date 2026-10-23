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
    return value.map((area, index) => {
      if (!area || typeof area !== "object" || Array.isArray(area)) {
        throw new Error(`第 ${index + 1} 个地块无效`);
      }
      const id = typeof area.id === "string" ? area.id : "";
      if (!ID_RE.test(id) ||
          Object.prototype.hasOwnProperty.call(Object.prototype, id)) {
        throw new Error(`地块编号无效：${id || "空"}`);
      }
      if (ids.has(id)) throw new Error(`地块编号重复：${id}`);
      ids.add(id);

      const name = typeof area.name === "string" ? area.name.trim() : "";
      if (name.length > 40) throw new Error(`地块名称过长：${id}`);

      const color = typeof area.color === "string" ? area.color : "";
      if (!COLOR_RE.test(color)) throw new Error(`地块颜色无效：${id}`);

      if (!Array.isArray(area.pts) || area.pts.length < 3) {
        throw new Error(`地块边界点不足：${id}`);
      }
      const pts = area.pts.map(point => {
        if (!Array.isArray(point) || point.length !== 2 ||
            !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
            point[0] < -90 || point[0] > 90 ||
            point[1] < -180 || point[1] > 180) {
          throw new Error(`地块坐标无效：${id}`);
        }
        return [point[0], point[1]];
      });

      return { id, name, color, pts };
    });
  }

  function parseAreaBackup(text, expectedVillageName) {
    const data = JSON.parse(text);
    if (!data || data.format !== FORMAT || data.version !== VERSION) {
      throw new Error("面积文件格式或版本不支持");
    }
    if (data.villageName !== expectedVillageName) {
      throw new Error("面积文件村名与当前页面不一致");
    }
    return {
      villageName: data.villageName,
      areas: normalizeAreas(data.areas),
    };
  }

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
      squareMeters: areas.reduce(
        (total, area) => total + polygonArea(area.pts),
        0
      ),
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

  return {
    normalizeAreas,
    parseAreaBackup,
    polygonArea,
    summarizeAreas,
    serializeAreaBackup,
  };
});

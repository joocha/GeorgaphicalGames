// Map coordinates. The game map is an equirectangular projection 1000 units
// wide: x = (lon + 180) × 1000/360, y = (90 − lat) × 1000/360. The same
// formula is used by tools/build-map.js and tools/build-layers.js.
export const MAP_SCALE = 1000 / 360;

const r1 = (v) => Math.round(v * 10) / 10;

export function project(lat, lon) {
  return [r1((Number(lon) + 180) * MAP_SCALE), r1((90 - Number(lat)) * MAP_SCALE)];
}

// [minLat, minLon, maxLat, maxLon] → [minX, minY, maxX, maxY]
export function areaToBox([minLat, minLon, maxLat, maxLon]) {
  const [x1, y1] = project(maxLat, minLon);
  const [x2, y2] = project(minLat, maxLon);
  return [x1, y1, x2, y2];
}

export function isArea(a) {
  return Array.isArray(a) && a.length === 4 && a.every((v) => typeof v === 'number' && Number.isFinite(v))
    && a[0] >= -90 && a[2] <= 90 && a[0] < a[2] && a[1] >= -180 && a[3] <= 180 && a[1] < a[3];
}

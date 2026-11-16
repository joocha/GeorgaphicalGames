// Builds the lazy-loaded map layers (rivers, lakes) from Natural Earth.
//
//   npm run fetch-layers     # downloads the Natural Earth GeoJSON into tools/.cache/
//   npm run build-layers     # writes ../layers/*.json and ../backend/content/layers-index.json
//
// Natural Earth is public domain (https://www.naturalearthdata.com/about/terms-of-use/).
//
// Output
//   layers/<layer>.json    [{i, d, b}]  i: numeric feature id, d: SVG path in map
//                          coordinates (same projection as the country map: x =
//                          (lon+180)*1000/360, y = (90-lat)*1000/360), b: bbox.
//                          Names are deliberately NOT included: a question that
//                          highlights a river must not ship the river's name.
//   backend/content/layers-index.json
//                          {<layer>: {<key>: {id, bbox, sources:[NE names]}}}
//                          maps the stable content keys used by geo objects
//                          (e.g. "danube") to the numeric feature ids. The
//                          backend resolves keys to ids when it imports content.
//
// Feature ids are assigned in a deterministic order (curated keys first, in the
// order below, then background features sorted by name), so rebuilding from the
// same Natural Earth version gives the same ids.
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '.cache');
const ROOT = path.join(__dirname, '..');
const S = 1000 / 360;
const P = (v) => Math.round(v * 10) / 10;

// Curated features: content key -> Natural Earth feature names (property `name`).
// Several NE segments can make up one geographic object (the Nile).
const LAYERS = {
  rivers: {
    file: 'ne_50m_rivers_lake_centerlines.geojson',
    keep: (p) => p.featurecla === 'River' && p.scalerank <= 4,
    curated: {
      danube: ['Danube'],
      // White Nile system to Lake Victoria (NE uses the local names), not the Blue Nile.
      nile: ['Nile', 'El Bahr el Abyad', 'Bahr el Jebel', 'Albert Nile', 'Victoria Nile'],
      amazon: ['Amazonas'],
      mekong: ['Mekong'],
      rhine: ['Rhine'],
      volga: ['Volga'],
      mississippi: ['Mississippi'],
      yangtze: ['Yangtze'],
      ganges: ['Ganges'],
      congo: ['Congo'],
      niger: ['Niger'],
      zambezi: ['Zambezi'],
      colorado: ['Colorado'],
    },
  },
  lakes: {
    file: 'ne_50m_lakes.geojson',
    keep: (p) => p.scalerank <= 0 && p.featurecla !== 'Reservoir',
    curated: {
      lake_baikal: ['Lake Baikal'],
      lake_victoria: ['Lake Victoria'],
      lake_titicaca: ['Lago Titicaca'],
      lake_superior: ['Lake Superior'],
      lake_tanganyika: ['Lake Tanganyika'],
      lake_malawi: ['Lake Malawi'],
      lake_chad: ['Lake Chad'],
      lake_ladoga: ['Lake Ladoga'],
      lake_balkhash: ['Lake Balkhash'],
      dead_sea: ['Dead Sea'],
    },
  },
};

// Drops points closer than `tol` map units to the previous kept point.
function simplify(points, tol) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [px, py] = out[out.length - 1];
    if (Math.hypot(x - px, y - py) >= tol) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function toPath(geometry, closed, bbox) {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates
      : geometry.type === 'Polygon' ? geometry.coordinates
        : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
          : [];
  let d = '';
  for (const line of lines) {
    const pts = simplify(line.map(([lon, lat]) => [P((lon + 180) * S), P((90 - lat) * S)]), closed ? 0.25 : 0.35);
    if (pts.length < 2) continue;
    pts.forEach(([x, y], i) => {
      d += (i ? 'L' : 'M') + x + ' ' + y;
      bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
    });
    if (closed) d += 'Z';
  }
  return d;
}

const index = {};
for (const [layer, cfg] of Object.entries(LAYERS)) {
  const src = path.join(CACHE, cfg.file);
  if (!fs.existsSync(src)) {
    console.error(`Missing ${src}. Run \`npm run fetch-layers\` first.`);
    process.exit(1);
  }
  const features = JSON.parse(fs.readFileSync(src, 'utf8')).features;
  const closed = layer === 'lakes';
  const out = [];
  index[layer] = {};
  const used = new Set();

  for (const [key, names] of Object.entries(cfg.curated)) {
    const parts = features.filter((f) => names.includes(f.properties.name));
    const missing = names.filter((n) => !parts.some((f) => f.properties.name === n));
    if (missing.length) throw new Error(`${layer}.${key}: Natural Earth has no feature named ${missing.join(', ')}`);
    const bbox = [1e9, 1e9, -1e9, -1e9];
    const d = parts.map((f) => toPath(f.geometry, closed, bbox)).join('');
    parts.forEach((f) => used.add(f));
    const id = out.length + 1;
    out.push({ i: id, d, b: bbox.map(P) });
    index[layer][key] = { id, bbox: bbox.map(P), sources: names };
  }

  // Unnamed background features, shown when the player turns the layer on.
  const background = features
    .filter((f) => !used.has(f) && cfg.keep(f.properties))
    .sort((a, b) => String(a.properties.name).localeCompare(String(b.properties.name))
      || a.properties.scalerank - b.properties.scalerank);
  for (const f of background) {
    const bbox = [1e9, 1e9, -1e9, -1e9];
    const d = toPath(f.geometry, closed, bbox);
    if (d) out.push({ i: out.length + 1, d, b: bbox.map(P) });
  }

  const dest = path.join(ROOT, 'layers', `${layer}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`${layer}: ${out.length} features (${Object.keys(cfg.curated).length} curated), ${fs.statSync(dest).size} bytes`);
}

const meta = {
  _source: 'Natural Earth 1:50m (public domain), built by tools/build-layers.js. Do not edit by hand.',
  ...index,
};
fs.writeFileSync(path.join(ROOT, 'backend', 'content', 'layers-index.json'), JSON.stringify(meta, null, 1) + '\n');
console.log('wrote backend/content/layers-index.json');

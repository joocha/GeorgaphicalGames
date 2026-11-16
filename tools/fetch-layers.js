// Downloads the Natural Earth GeoJSON files used by build-layers.js into
// tools/.cache/ (gitignored). Natural Earth is public domain.
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const FILES = ['ne_50m_rivers_lake_centerlines.geojson', 'ne_50m_lakes.geojson'];
const CACHE = path.join(__dirname, '.cache');

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const name of FILES) {
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    JSON.parse(body.toString('utf8')); // must be valid JSON
    fs.writeFileSync(path.join(CACHE, name), body);
    console.log(`${name}: ${body.length} bytes`);
  }
})().catch((err) => { console.error(err.message); process.exit(1); });

# Geographic data sources

The game's facts come from reliable, licensed, attributed sources. They are stored with their provenance and imported through one reusable process. Nothing reaches players without being verified.

## Providers

| Code | Provider | Licence | Used for | Evaluated / used |
|---|---|---|---|---|
| `natural_earth` | [Natural Earth](https://www.naturalearthdata.com/) | Public domain | Country shapes (1:110m via `world-atlas`), rivers and lakes (1:50m) | ✅ used |
| `wikidata` | [Wikidata](https://www.wikidata.org/) | CC0 | Coordinates (P625), countries (P17), mouths (P403), ranges (P4552), elevations (P2044) via `wbgetentities` | ✅ used |
| `wikipedia` | [Wikipedia](https://en.wikipedia.org/) | CC BY-SA 4.0 | Confirming descriptive facts; resolving cases where Wikidata is incomplete. Facts only, no text copied | ✅ used |
| `usgs_mcs_2026` | [USGS Mineral Commodity Summaries 2026](https://pubs.usgs.gov/periodicals/mcs2026/) | Public domain (US Gov.) | Mine production, reserves, identified resources | ✅ used |
| `nile_basin_initiative` | [Nile Basin Initiative](https://nilebasin.org/nile-basin) | facts only | Nile basin countries | ✅ used |
| `world_bank_wdi` | [World Bank WDI](https://data.worldbank.org/) | CC BY 4.0 | Population, density, merchandise exports (API v2) | ✅ used |
| OpenStreetMap | [OSM](https://www.openstreetmap.org/) | ODbL (share-alike) | Roads, tunnels, cities | ⏳ evaluated, not used: share-alike obligations for derived databases need a legal decision first; not needed for the v2 sample |

Attribution shown to players: every answer shows its source name and data year. Natural Earth needs no attribution, but it is credited in `README.md`. When adding CC BY or CC BY-SA facts, keep `data_sources.attribution` filled in.

## Data formats

| File | Format | Built by |
|---|---|---|
| `index.html` → `const MAP` | country SVG paths in map coordinates + neighbours | `tools/build-map.js` (world-atlas TopoJSON) |
| `layers/rivers.json`, `layers/lakes.json` | `[{i, d, b}]`: id, SVG path, bbox; no names | `tools/build-layers.js` (Natural Earth GeoJSON) |
| `backend/content/layers-index.json` | content key → feature id + bbox | `tools/build-layers.js` |
| `backend/content/map-countries.json` | country names on the map + neighbours | `tools/build-app.js` |
| `backend/content/sources.json` | data sources + countries not on the map | hand-edited, reviewed |
| `backend/content/geo-objects.json` | objects, country relations, object links | hand-edited, reviewed |
| `backend/content/resource-stats.json` | country × resource × metric × year | hand-edited, reviewed |
| `backend/content/questions/*.json` | questions per level | hand-edited, reviewed |

## Import procedure

```bash
cd backend
npm run content:check     # validate everything, derive answers (no DB needed)
npm run content:import    # validate, then upsert into DATABASE_URL in one transaction
```
The import is idempotent and non-destructive: upserts by stable code; removed facts are marked `rejected` instead of being deleted; changed questions get `version + 1`; AI drafts in the database are left alone. It prints a summary such as `{"objects":91,...,"questions":{"inserted":80,"updated":0,"unchanged":0}}`.

## Update procedure

1. **Geometry:** `cd tools && npm run fetch-layers && npm run build-layers`. Check the diff of `layers-index.json`: curated keys must keep pointing at the same features. If feature ids change, re-import content so `geo_objects.geometry_feature_id` follows.
2. **Facts:** edit `geo-objects.json` with the source and a `note` when sources disagree. Re-check against the source (see "Verification").
3. **Statistics** (yearly, when USGS publishes in February): add new rows with the new `year` and the new edition as source (add e.g. `usgs_mcs_2027` to `sources.json`). Keep old rows. Update `fact.stat.year` in questions that should move to the new year; the validator re-derives the answers. Also update the year mentioned in the question text and explanation.
4. `npm run content:check && npm test`, review the diff, then import (development first, then production).

## Verification

How the v2.0.0 sample set was verified (2026-11-17):
- Coordinates, countries and mouths: Wikidata `wbgetentities` for every QID (QIDs resolved from Wikipedia titles).
- Relationship sets checked against a second source where possible. **Disagreements and how they were resolved:**
  - Danube: Wikidata P17 omits Ukraine; Wikipedia lists Germany plus 9 countries "through or bordering", including Ukraine (delta). Used 10, noted in the object.
  - Alps: Wikidata also lists Hungary; Wikipedia's eight Alpine countries were used.
  - Nile basin: Wikidata P205 lists 7; the Nile Basin Initiative names 10 members plus Eritrea. Used 11.
  - Himalayas, Caucasus, Zambezi, Malacca: sources disagree on country lists, so **no country-set questions** were created for them.
- USGS tables were read from the official PDFs. Ranks are stored only where the table makes them unambiguous (the US lithium figure is withheld, which is noted).
- World Bank values were fetched from the API (2024).
- Explanations were checked so they don't claim more than the sources say.
- The validator enforces: known sources, known countries, verified objects only, answers equal to derived facts, map answers on the map, off-map countries mentioned in the explanation, reviewer for verified questions.

The questions were written with AI assistance from these verified facts. **A human spot-check of the 80 seed questions is recommended** (`npm run questions -- list --status verified`).

How Hydro batch 2 (v2.2.0, 88 questions, `questions/level-2-hydro-2.json`) was verified (2026-11-18):
- Every claim in a question or explanation was matched against the current plain text of the English Wikipedia article on its subject (fetched through the MediaWiki API), quoting the supporting sentence. Claims without a matching sentence were dropped or reworded (e.g. "longest river in Asia" for the Yangtze was replaced by "longest river of China, third-longest in the world").
- Questions about objects already in `geo-objects.json` derive their answers from it (`fact`), so they can't contradict it.
- New objects: `congo_river`, `ganges`, `niger_river`, `lake_ladoga` (Wikidata QIDs from `wbgetentities`, geometry from the Natural Earth layer index). New relations: `lake_chad.shared_by`, `lake_malawi.shared_by`, `ganges.flows_through`.
- Disagreements: Ganges, Wikidata P17 lists only India, Wikipedia India and Bangladesh (used 2, noted). Congo, sources disagree on countries, so no country-set question. Lake Malawi, the Malawi–Tanzania boundary on the lake is disputed, but all three countries border it (noted).
- Depth figures are given as ranges or rounded ("about 11,000 m", "about 440 m below sea level") because measurements differ by source and year.
- AI-assisted like the seed set: **spot-check before importing to production.**

## Data freshness

| Data | As of | Refresh |
|---|---|---|
| USGS statistics | production 2024, reserves/resources as published Feb 2026 | yearly (February) |
| World Bank | 2024 | yearly |
| Wikidata/Wikipedia facts | retrieved 2026-11-17 | when content is touched |
| Natural Earth | master branch, retrieved 2026-11-17 | rarely |

`data_sources.retrieved_at` and per-row `data_year` record this in the database.

## Known limitations

- The country map is 1:110m: Monaco, Liechtenstein, Singapore, Bahrain and other micro-states can't be tapped. Questions list them in `offMapAnswers` and in the explanation.
- In 1:110m data, French Guiana is part of France's shape, so the Amazon rainforest country set isn't asked as a map question.
- Mountain ranges, deserts and routes have no area or line geometry yet (they are markers or focus boxes). Natural Earth's `geography_regions_polys` could add ranges later.
- Rivers cross the antimeridian nowhere in the curated set; the layer builder doesn't handle wrap-around.
- No energy statistics (oil, gas, coal production) yet: choose and document a source (EIA International or Energy Institute Statistical Review) first.

-- GeoAIGames v2.0.0: the five levels (reference data).
--
-- - Inserts the five game_levels with their multipliers and configurable
--   unlock / completion / session rules.
-- - Attaches the existing Telegram modes (telegram_country_quiz: easy, hard)
--   to Level 1, so Atlas Quest *is* Level 1 and every existing result and
--   best score counts towards it. Only the catalog column game_modes.level_id
--   is set, and only where it is still NULL; no player data is touched.
-- - Adds one question-engine mode per new level (game explorer_levels).
--
-- Inserts use ON CONFLICT DO NOTHING, so re-running never overwrites rows an
-- administrator may have tuned since. Questions and geographic knowledge are
-- NOT seeded here; they are imported from backend/content/ by
-- `npm run content:import` (docs/GEOGRAPHIC_DATA_SOURCES.md).

INSERT INTO "game_levels"
    ("number", "code", "name", "short_description", "description", "icon", "score_multiplier",
     "categories", "unlock_rule", "completion_rule", "session_config", "sort_order")
VALUES
    (1, 'atlas', 'Atlas Explorer',
     'Find countries on the map and name them by their shape.',
     'The original Atlas Quest. Ten rounds alternate between finding a country on a zoomed map and naming a highlighted country from four look-alike neighbours. Easy uses the 75 biggest countries, Hard uses them all.',
     '🗺️', 1,
     $j$[{"code":"country_identification","name":"Country identification"},
         {"code":"country_shapes","name":"Country shapes"},
         {"code":"geographic_position","name":"Geographic position"},
         {"code":"neighbours_borders","name":"Neighbours & borders"}]$j$,
     '{"type":"always"}',
     '{"minCompletedSessions":1,"minScore":0,"minAccuracy":0}',
     '{"defaultRounds":10,"allowedRounds":[10]}', 1),
    (2, 'hydro', 'Hydro Explorer',
     'Rivers, lakes, waterfalls, seas, straits and canals.',
     'Follow the water. Spot rivers and lakes on the map, pick every country a river flows through, match rivers with their sources and mouths, and find the straits and canals that connect the seas.',
     '💧', 2,
     $j$[{"code":"rivers","name":"Rivers"},{"code":"river_basins","name":"River basins"},
         {"code":"lakes","name":"Lakes"},{"code":"waterfalls","name":"Waterfalls"},
         {"code":"seas","name":"Seas"},{"code":"oceans","name":"Oceans"},
         {"code":"straits","name":"Straits"},{"code":"canals","name":"Canals"}]$j$,
     '{"type":"level_completed","level":1}',
     '{"minCompletedSessions":1,"minScore":0,"minAccuracy":0}',
     '{"defaultRounds":10,"allowedRounds":[10]}', 2),
    (3, 'earth', 'Earth Explorer',
     'Mountain ranges, peaks, passes, volcanoes and canyons.',
     'Climb higher. Find the countries a mountain range crosses, locate famous peaks and volcanoes, and discover the passes and tunnels that cut through the mountains.',
     '⛰️', 3,
     $j$[{"code":"mountain_ranges","name":"Mountain ranges"},{"code":"peaks","name":"Mountain peaks"},
         {"code":"passes","name":"Mountain passes"},{"code":"valleys","name":"Valleys"},
         {"code":"volcanoes","name":"Volcanoes"},{"code":"canyons","name":"Canyons"},
         {"code":"mountain_roads","name":"Mountain roads"},{"code":"tunnels","name":"Tunnels"}]$j$,
     '{"type":"level_completed","level":2}',
     '{"minCompletedSessions":1,"minScore":0,"minAccuracy":0}',
     '{"defaultRounds":10,"allowedRounds":[10]}', 3),
    (4, 'resources', 'Resource Explorer',
     'Gold, copper, lithium, cobalt and the countries that mine them.',
     'Dig deeper. Match countries with the minerals they produce, find famous mines and deposits on the map, and learn the difference between what a country mines each year and what it holds in reserve. Every statistic comes with its year and source.',
     '⛏️', 4,
     $j$[{"code":"gold","name":"Gold"},{"code":"copper","name":"Copper"},
         {"code":"iron_ore","name":"Iron ore"},{"code":"oil","name":"Oil"},
         {"code":"natural_gas","name":"Natural gas"},{"code":"coal","name":"Coal"},
         {"code":"lithium","name":"Lithium"},{"code":"cobalt","name":"Cobalt"},
         {"code":"diamonds","name":"Diamonds"},{"code":"other_minerals","name":"Other minerals"}]$j$,
     '{"type":"level_completed","level":3}',
     '{"minCompletedSessions":1,"minScore":0,"minAccuracy":0}',
     '{"defaultRounds":10,"allowedRounds":[10]}', 4),
    (5, 'master', 'Master Explorer',
     'Mixed challenges that combine everything you have learned.',
     'The final expedition. Questions combine several facts at once: climate and natural regions, population, trade and shipping routes, strategic straits and canals, and the relationships between rivers, mountains and countries.',
     '🧭', 5,
     $j$[{"code":"climate_zones","name":"Climate zones"},{"code":"natural_regions","name":"Natural regions"},
         {"code":"deserts_forests","name":"Deserts & forests"},{"code":"population","name":"Population density"},
         {"code":"megacities","name":"Megacities"},{"code":"economic_geography","name":"Economic geography"},
         {"code":"trade_routes","name":"Trade routes"},{"code":"shipping_routes","name":"Shipping routes"},
         {"code":"strategic_straits","name":"Strategic straits & canals"},
         {"code":"complex_relationships","name":"Complex relationships"}]$j$,
     '{"type":"level_completed","level":4}',
     '{"minCompletedSessions":1,"minScore":0,"minAccuracy":0}',
     '{"defaultRounds":10,"allowedRounds":[10]}', 5)
ON CONFLICT ("code") DO NOTHING;

-- Level 1 = the existing Telegram Atlas Quest modes (catalog rows only).
UPDATE "game_modes" gm
   SET "level_id" = l."id", "updated_at" = now()
  FROM "games" g, "game_levels" l
 WHERE gm."game_id" = g."id"
   AND g."code" = 'telegram_country_quiz'
   AND gm."code" IN ('easy', 'hard')
   AND l."code" = 'atlas'
   AND gm."level_id" IS NULL;

-- Levels 2-5: one game whose modes are served by the question engine.
INSERT INTO "games" ("code", "name", "description", "platform", "sort_order") VALUES
    ('explorer_levels',
     'GeoAIGames Levels 2–5',
     'Hydro, Earth, Resource and Master Explorer. Questions are served and scored by the backend question engine.',
     'telegram', 3)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "game_modes"
    ("game_id", "code", "name", "description", "difficulty", "rounds_per_session", "best_metric", "config", "sort_order", "level_id")
SELECT g."id", l."code", l."name", l."short_description", NULL, 10, 'score',
       $json${
         "engine": "question_engine",
         "difficulty": {"min": 1, "max": 3},
         "recentQuestionWindow": 30,
         "scoring": {"basePointsDefault": 100, "streakBonusPerStep": 10, "streakBonusCap": 50,
                     "partial": "hits_minus_false_picks", "streakNeedsFullyCorrect": true,
                     "timeBonus": null}
       }$json$::jsonb,
       l."number", l."id"
  FROM "games" g
 CROSS JOIN "game_levels" l
 WHERE g."code" = 'explorer_levels' AND l."code" IN ('hydro', 'earth', 'resources', 'master')
ON CONFLICT ("game_id", "code") DO NOTHING;

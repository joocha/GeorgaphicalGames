-- Atlas Quest: game catalog reference data.
--
-- Maps the games that exist in the repository today. Nothing is invented:
--   - Telegram Mini App (index.html, template tools/telegram-template.html)
--   - Web Game          (web/index.html)
-- They have different rules, scoring and "best" metrics, so they are two games.
--
-- Mode codes match the identifiers the frontends already use: Telegram's
-- `level` ("easy" / "hard") and the Web Game's MODES[].id ("countries",
-- "capitals", "water", "peaks", "chain"). `config` documents the rules as
-- implemented in the frontend; the frontend still enforces them.
--
-- Only inserts. ON CONFLICT DO NOTHING never overwrites existing rows.

INSERT INTO "games" ("code", "name", "description", "platform", "sort_order") VALUES
    ('telegram_country_quiz',
     'Atlas Quest (Telegram)',
     'Telegram Mini App. Find countries on the map and name them by their shape. 10 rounds, Easy and Hard.',
     'telegram', 1),
    ('web_expeditions',
     'Atlas Quest (Web)',
     'Full web game with five expeditions: Countries, Capitals & big cities, Rivers/lakes/seas, Mountains & relief, Border journey.',
     'web', 2)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Telegram Mini App: two difficulty levels, ranked by points.
-- Rounds alternate "find" (tap the country on a zoomed map) and "name" (pick
-- the highlighted country from 4 options), starting with "find".
-- Points per correct answer: 100 + min(50, (streak - 1) * 10); wrong = 0 and
-- resets the streak. Max 1350. The app stores the best score per level
-- (Telegram CloudStorage keys best_easy / best_hard, else localStorage).
-- ---------------------------------------------------------------------------
INSERT INTO "game_modes"
    ("game_id", "code", "name", "description", "difficulty", "rounds_per_session", "best_metric", "config", "sort_order")
SELECT g."id", m."code", m."name", m."description", m."difficulty", 10, 'score', m."config"::jsonb, m."sort_order"
FROM "games" g
CROSS JOIN (VALUES
    ('easy', 'Easy', 'The 75 largest countries.', 'easy', 1, $json${
        "frontendLevel": "easy",
        "roundTypes": ["find", "name"],
        "roundOrder": "alternating, starting with find",
        "countryPool": "75 largest quiz countries by map bounding-box area",
        "nameOptions": 4,
        "nearbyCountriesConsidered": 4,
        "scoring": {"correctBase": 100, "streakBonusPerStep": 10, "streakBonusCap": 50, "wrong": 0, "maxScore": 1350},
        "resultMessages": {"9": "Map master!", "7": "Great explorer!", "5": "Good trip!", "0": "The world is big. Try again!"},
        "legacyBestStorageKey": "best_easy"
    }$json$),
    ('hard', 'Hard', 'All quiz countries, tighter zoom and more look-alike neighbours.', 'hard', 2, $json${
        "frontendLevel": "hard",
        "roundTypes": ["find", "name"],
        "roundOrder": "alternating, starting with find",
        "countryPool": "all quiz countries (excludes disputed/territories list and very small shapes)",
        "nameOptions": 4,
        "nearbyCountriesConsidered": 6,
        "scoring": {"correctBase": 100, "streakBonusPerStep": 10, "streakBonusCap": 50, "wrong": 0, "maxScore": 1350},
        "resultMessages": {"9": "Map master!", "7": "Great explorer!", "5": "Good trip!", "0": "The world is big. Try again!"},
        "legacyBestStorageKey": "best_hard"
    }$json$)
) AS m("code", "name", "description", "difficulty", "sort_order", "config")
WHERE g."code" = 'telegram_country_quiz'
ON CONFLICT ("game_id", "code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Web Game: five expeditions, no difficulty levels.
-- Quiz expeditions: 10 multiple-choice questions (4 options).
--   Points per correct answer: 100 + min(100, (streak - 1) * 20). Max 1700.
--   "Best" shown in the app is correct answers out of 10.
--   Passport stamp at >= 8 correct.
-- Border journey: 3 journeys between countries via land borders.
--   Stars per journey, 150 points per star. "Best" is stars out of 9.
--   Passport stamp at >= 7 stars.
-- All expeditions: XP = round(points / 10), feeding the web rank ladder.
-- The app stores profile {xp, best, stamps} in localStorage key "atlasQuest".
-- ---------------------------------------------------------------------------
INSERT INTO "game_modes"
    ("game_id", "code", "name", "description", "difficulty", "rounds_per_session", "best_metric", "config", "sort_order")
SELECT g."id", m."code", m."name", m."description", NULL, m."rounds", m."best_metric", m."config"::jsonb, m."sort_order"
FROM "games" g
CROSS JOIN (VALUES
    ('countries', 'Countries',
     'Name the country from its shape on the map, its flag, or a surprising clue.',
     10, 'correct_count', 1, $json${
        "frontendModeId": "countries",
        "expeditionNumber": "I",
        "questionMix": {"shape": 5, "flag": 3, "clue": 2},
        "options": 4,
        "scoring": {"correctBase": 100, "streakBonusPerStep": 20, "streakBonusCap": 100, "wrong": 0, "maxScore": 1700},
        "stampThreshold": {"metric": "correct_count", "min": 8},
        "xp": "round(score / 10)"
    }$json$),
    ('capitals', 'Capitals & big cities',
     'Find capitals, and learn why the biggest city is often not the capital.',
     10, 'correct_count', 2, $json${
        "frontendModeId": "capitals",
        "expeditionNumber": "II",
        "questionMix": {"capital": 7, "bigCity": 3},
        "options": 4,
        "scoring": {"correctBase": 100, "streakBonusPerStep": 20, "streakBonusCap": 100, "wrong": 0, "maxScore": 1700},
        "stampThreshold": {"metric": "correct_count", "min": 8},
        "xp": "round(score / 10)"
    }$json$),
    ('water', 'Rivers, lakes & seas',
     'Follow the water: the longest rivers, the deepest lakes, the saltiest seas.',
     10, 'correct_count', 3, $json${
        "frontendModeId": "water",
        "expeditionNumber": "III",
        "questionMix": {"water": 10},
        "options": 4,
        "scoring": {"correctBase": 100, "streakBonusPerStep": 20, "streakBonusCap": 100, "wrong": 0, "maxScore": 1700},
        "stampThreshold": {"metric": "correct_count", "min": 8},
        "xp": "round(score / 10)"
    }$json$),
    ('peaks', 'Mountains & relief',
     'Climb the highest peaks, cross deserts and drop into the lowest valleys.',
     10, 'correct_count', 4, $json${
        "frontendModeId": "peaks",
        "expeditionNumber": "IV",
        "questionMix": {"relief": 10},
        "options": 4,
        "scoring": {"correctBase": 100, "streakBonusPerStep": 20, "streakBonusCap": 100, "wrong": 0, "maxScore": 1700},
        "stampThreshold": {"metric": "correct_count", "min": 8},
        "xp": "round(score / 10)"
    }$json$),
    ('chain', 'Border journey',
     'Travel from one country to another, crossing only land borders, in as few steps as you can.',
     3, 'stars', 5, $json${
        "frontendModeId": "chain",
        "expeditionNumber": "V",
        "journeyDistances": [[3, 4], [4, 5], [5, 7]],
        "moveLimit": "2 * shortest + 3 (step back counts as a move)",
        "stars": {"3": "moves <= shortest", "2": "moves <= shortest + 2", "1": "reached destination", "0": "out of moves", "hintPenalty": "-1 star if more than 1 hint"},
        "scoring": {"pointsPerStar": 150, "maxScore": 1350},
        "correctCountMeaning": "journeys finished with >= 2 stars",
        "stampThreshold": {"metric": "stars", "min": 7},
        "xp": "round(score / 10)"
    }$json$)
) AS m("code", "name", "description", "rounds", "best_metric", "sort_order", "config")
WHERE g."code" = 'web_expeditions'
ON CONFLICT ("game_id", "code") DO NOTHING;

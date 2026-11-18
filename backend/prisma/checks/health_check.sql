-- Production health check: READ-ONLY report of everything the current
-- release needs in the database. Safe on production; changes nothing.
--
--   psql "$DATABASE_URL" -f prisma/checks/health_check.sql
--
-- Prints one row per check: OK / FAIL / INFO. A FAIL names its fix:
--   migrations / columns / triggers / rules  ->  npm run db:migrate:deploy
--   questions / objects                      ->  npm run content:import
-- scripts/repair.sh runs those fixes in the right order and then this check.
--
-- Works on a partly migrated database: checks whose tables or columns are
-- missing report FAIL instead of aborting. Docs: docs/DEVELOPMENT_GUIDE.md.

BEGIN READ ONLY;

-- The checks collect their rows in memory and hand them to the final SELECT
-- through a transaction-local setting (set_config), so nothing is written.
DO $$
DECLARE
    expected text[] := ARRAY[
        '20261111000000_init', '20261111000100_seed_game_catalog',
        '20261117000000_v2_levels_question_engine', '20261117000100_seed_levels',
        '20261118000000_v2_1_score_progression'];
    m text; ok boolean; v text; r record; missing text[] := '{}';
    rep text[] := '{}';   -- rows: status|check|detail
BEGIN
    -- 1. Migrations applied (and not failed/rolled back).
    IF to_regclass('_prisma_migrations') IS NULL AND to_regclass('game_results') IS NOT NULL THEN
        -- Tables exist but Prisma never recorded them: migrations were run by
        -- hand (psql). migrate deploy refuses such a database (P3005).
        rep := rep || concat_ws('|', 'FAIL', 'migrations', 'schema exists but Prisma''s history (_prisma_migrations) is missing: migrations were applied by hand -> bash scripts/repair.sh --baseline');
    ELSIF to_regclass('_prisma_migrations') IS NULL THEN
        rep := rep || concat_ws('|', 'FAIL', 'migrations', '_prisma_migrations missing: database never migrated -> npm run db:migrate:deploy');
    ELSE
        FOREACH m IN ARRAY expected LOOP
            EXECUTE 'SELECT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL)'
               INTO ok USING m;
            IF NOT ok THEN missing := missing || m; END IF;
        END LOOP;
        IF cardinality(missing) = 0 THEN
            rep := rep || concat_ws('|', 'OK', 'migrations', cardinality(expected) || ' of ' || cardinality(expected) || ' applied');
        ELSE
            rep := rep || concat_ws('|', 'FAIL', 'migrations', 'not applied: ' || array_to_string(missing, ', ') || ' -> npm run db:migrate:deploy');
        END IF;
        EXECUTE 'SELECT string_agg(migration_name, '', '') FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL' INTO v;
        IF v IS NOT NULL THEN
            rep := rep || concat_ws('|', 'FAIL', 'migrations', 'started but unfinished (failed): ' || v || ' -> see prisma migrate resolve');
        END IF;
    END IF;

    -- 2. Columns the v2.1 code queries.
    FOR r IN SELECT * FROM (VALUES ('user_profiles', 'level'), ('game_results', 'scoring_version'),
                                   ('game_results', 'base_score'), ('game_sessions', 'scoring_rules')) AS c(t, col) LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = current_schema() AND table_name = r.t AND column_name = r.col) INTO ok;
        rep := rep || concat_ws('|', CASE WHEN ok THEN 'OK' ELSE 'FAIL' END, 'column ' || r.t || '.' || r.col,
                CASE WHEN ok THEN 'present' ELSE 'missing -> npm run db:migrate:deploy' END);
    END LOOP;

    -- 3. Protective triggers.
    FOR r IN SELECT * FROM (VALUES ('game_results', 'game_results_immutable'),
                                   ('game_sessions', 'game_sessions_scoring_is_final'),
                                   ('game_answers', 'game_answers_answer_once'),
                                   ('user_profiles', 'user_profiles_level_never_decreases')) AS t(tbl, trg) LOOP
        SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = r.trg AND NOT tgisinternal AND tgenabled <> 'D') INTO ok;
        rep := rep || concat_ws('|', CASE WHEN ok THEN 'OK' ELSE 'FAIL' END, 'trigger ' || r.trg,
                CASE WHEN ok THEN 'enabled on ' || r.tbl ELSE 'missing or disabled -> npm run db:migrate:deploy' END);
    END LOOP;

    -- 4. Levels: five active, multipliers x1..x5, score-threshold unlock rules.
    IF to_regclass('game_levels') IS NULL THEN
        rep := rep || concat_ws('|', 'FAIL', 'levels', 'game_levels missing -> npm run db:migrate:deploy');
    ELSE
        EXECUTE $q$SELECT string_agg(number || ':x' || score_multiplier::int || ' ' || coalesce(unlock_rule->>'type', '?')
                                     || coalesce(' ' || (unlock_rule->>'min'), ''), '; ' ORDER BY number)
                     FROM game_levels WHERE is_active$q$ INTO v;
        EXECUTE $q$SELECT count(*) = 5
                          AND bool_and(score_multiplier = number)
                          AND bool_and(CASE number WHEN 1 THEN unlock_rule->>'type' = 'always'
                                                   ELSE unlock_rule->>'type' = 'total_score' END)
                     FROM game_levels WHERE is_active$q$ INTO ok;
        rep := rep || concat_ws('|', CASE WHEN ok THEN 'OK' ELSE 'FAIL' END, 'levels', coalesce(v, 'none')
                || CASE WHEN ok THEN '' ELSE ' -> expected 5 levels, xN, total_score rules (migration 20261118000000)' END);
    END IF;

    -- 5. Scoring rules of the level modes (v2.1 scale).
    IF to_regclass('game_modes') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_modes' AND column_name = 'level_id') THEN
        EXECUTE $q$SELECT string_agg(gm.code || '=' || coalesce(gm.config->'scoring'->>'correctBase', '')
                                     || coalesce('scale ' || (gm.config->'scoring'->>'pointScale'), ''), ', ' ORDER BY gm.sort_order)
                     FROM game_modes gm WHERE gm.level_id IS NOT NULL$q$ INTO v;
        EXECUTE $q$SELECT bool_and(CASE WHEN gm.config->>'engine' = 'question_engine'
                                        THEN (gm.config->'scoring'->>'pointScale')::numeric = 0.1
                                        ELSE (gm.config->'scoring'->>'correctBase')::int IN (10, 20) END)
                     FROM game_modes gm WHERE gm.level_id IS NOT NULL$q$ INTO ok;
        rep := rep || concat_ws('|', CASE WHEN ok THEN 'OK' ELSE 'FAIL' END, 'scoring rules', coalesce(v, 'no level modes')
                || CASE WHEN ok THEN '' ELSE ' -> expected easy=10, hard=20, engine scale 0.1 (migration 20261118000000)' END);
    END IF;

    -- 6. Content: verified questions per level, knowledge objects.
    IF to_regclass('question_bank') IS NULL THEN
        rep := rep || concat_ws('|', 'FAIL', 'questions', 'question_bank missing -> npm run db:migrate:deploy');
    ELSE
        FOR r IN EXECUTE $q$SELECT l.number, l.code, count(q.id) AS n,
                                   count(*) FILTER (WHERE q.verification_status = 'in_review') AS review
                              FROM game_levels l
                              LEFT JOIN question_bank q ON q.level_id = l.id AND q.is_active
                             WHERE l.number > 1 AND l.is_active
                             GROUP BY l.number, l.code ORDER BY l.number$q$ LOOP
            EXECUTE $q$SELECT count(*) FROM question_bank q JOIN game_levels l ON l.id = q.level_id
                         WHERE l.code = $1 AND q.is_active AND q.verification_status = 'verified'$q$ INTO v USING r.code;
            rep := rep || concat_ws('|', CASE WHEN v::int >= 10 THEN 'OK' ELSE 'FAIL' END, 'questions ' || r.code,
                    v || ' verified' || CASE WHEN r.review > 0 THEN ', ' || r.review || ' waiting for review' ELSE '' END
                    || CASE WHEN v::int >= 10 THEN '' ELSE ' -> npm run content:import (a game needs 10)' END);
        END LOOP;
        EXECUTE $q$SELECT count(*) FROM geo_objects WHERE verification_status = 'verified'$q$ INTO v;
        rep := rep || concat_ws('|', CASE WHEN v::int > 0 THEN 'OK' ELSE 'FAIL' END, 'knowledge objects', v || ' verified'
                || CASE WHEN v::int > 0 THEN '' ELSE ' -> npm run content:import' END);
    END IF;

    -- 7. Information (never FAIL).
    IF to_regclass('user_profiles') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM user_profiles' INTO v;
        rep := rep || concat_ws('|', 'INFO', 'players', v || ' profiles');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'level') THEN
        EXECUTE $q$SELECT string_agg('L' || level || ': ' || n, ', ' ORDER BY level)
                     FROM (SELECT level, count(*) AS n FROM user_profiles GROUP BY level) x$q$ INTO v;
        rep := rep || concat_ws('|', 'INFO', 'players by level', coalesce(v, 'none'));
    END IF;
    IF to_regclass('game_results') IS NOT NULL THEN
        EXECUTE $q$SELECT count(*) || ' results, last ' || coalesce(max(completed_at)::text, 'never') FROM game_results$q$ INTO v;
        rep := rep || concat_ws('|', 'INFO', 'results', v);
    END IF;
    IF to_regclass('game_sessions') IS NOT NULL THEN
        EXECUTE $q$SELECT count(*) FROM game_sessions WHERE status = 'in_progress' AND started_at < now() - interval '1 day'$q$ INTO v;
        rep := rep || concat_ws('|', 'INFO', 'stale sessions', v || ' in progress for over a day (harmless; closed on the player''s next game)');
    END IF;
    IF to_regclass('outbox_events') IS NOT NULL THEN
        EXECUTE $q$SELECT count(*) FROM outbox_events WHERE status = 'pending'$q$ INTO v;
        rep := rep || concat_ws('|', 'INFO', 'outbox', v || ' pending events (no dispatcher yet)');
    END IF;
    PERFORM set_config('geo.health', array_to_string(rep, E'\n'), true);
END $$;

WITH rows AS (
    SELECT n, split_part(line, '|', 1) AS status, split_part(line, '|', 2) AS check_name, split_part(line, '|', 3) AS detail
      FROM unnest(string_to_array(current_setting('geo.health'), E'\n')) WITH ORDINALITY AS t(line, n)
)
SELECT status, check_name AS "check", detail FROM rows
UNION ALL
SELECT CASE WHEN count(*) FILTER (WHERE status = 'FAIL') = 0 THEN '==' ELSE '!!' END, 'SUMMARY',
       CASE WHEN count(*) FILTER (WHERE status = 'FAIL') = 0 THEN 'HEALTHY'
            ELSE 'NEEDS REPAIR: ' || count(*) FILTER (WHERE status = 'FAIL') || ' failed check(s); run scripts/repair.sh' END
  FROM rows;

ROLLBACK;

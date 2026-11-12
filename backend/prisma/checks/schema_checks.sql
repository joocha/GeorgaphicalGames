-- Self-checking tests for the schema's constraints and triggers.
--
-- Runs in one transaction and ROLLS BACK at the end, so it leaves no data
-- behind. Intended for a local or staging database, never production:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/checks/schema_checks.sql
--
-- Each check raises an exception on failure, which aborts the script.

BEGIN;

-- Only NOTICEs and the final message are printed.
\o /dev/null

CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid) ON COMMIT DROP;

-- Expect `sql` to fail with SQLSTATE `state`.
CREATE FUNCTION pg_temp.expect_error(label text, state text, sql text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE sql;
    RAISE EXCEPTION 'FAIL %: statement succeeded but should have failed', label;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLSTATE = state THEN
            RAISE NOTICE 'ok   %', label;
        ELSIF SQLERRM LIKE 'FAIL %' THEN
            RAISE;
        ELSE
            RAISE EXCEPTION 'FAIL %: expected SQLSTATE %, got % (%)', label, state, SQLSTATE, SQLERRM;
        END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect(label text, ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF;
    RAISE NOTICE 'ok   %', label;
END;
$$;

-- Catalog -------------------------------------------------------------------
SELECT pg_temp.expect('catalog: 2 games, 7 modes',
    (SELECT count(*) FROM games) = 2 AND (SELECT count(*) FROM game_modes) = 7);

INSERT INTO t SELECT 'easy', m.id FROM game_modes m JOIN games g ON g.id = m.game_id
    WHERE g.code = 'telegram_country_quiz' AND m.code = 'easy';
INSERT INTO t SELECT 'chain', m.id FROM game_modes m JOIN games g ON g.id = m.game_id
    WHERE g.code = 'web_expeditions' AND m.code = 'chain';

SELECT pg_temp.expect_error('catalog: duplicate mode code within a game', '23505',
    $q$INSERT INTO game_modes (game_id, code, name, rounds_per_session, best_metric)
       SELECT game_id, 'easy', 'dup', 10, 'score' FROM game_modes WHERE id = (SELECT v FROM t WHERE k = 'easy')$q$);
SELECT pg_temp.expect_error('catalog: unknown best_metric', '23514',
    $q$INSERT INTO game_modes (game_id, code, name, rounds_per_session, best_metric)
       SELECT game_id, 'new_mode', 'x', 10, 'time' FROM game_modes WHERE id = (SELECT v FROM t WHERE k = 'easy')$q$);
SELECT pg_temp.expect_error('catalog: a mode with sessions cannot be deleted', '23503',
    $q$DO $d$ BEGIN
         INSERT INTO users DEFAULT VALUES;
         INSERT INTO game_sessions (user_id, game_mode_id, client_platform)
           SELECT (SELECT id FROM users ORDER BY created_at DESC LIMIT 1), (SELECT v FROM t WHERE k = 'easy'), 'web';
         DELETE FROM game_modes WHERE id = (SELECT v FROM t WHERE k = 'easy');
       END $d$$q$);

-- Identities ----------------------------------------------------------------
INSERT INTO users DEFAULT VALUES RETURNING id \gset u1_
INSERT INTO t VALUES ('u1', :'u1_id');
INSERT INTO user_profiles (user_id, display_name, locale) VALUES (:'u1_id', 'Nino', 'ka');
INSERT INTO auth_identities (user_id, provider, provider_user_id, provider_data)
    VALUES (:'u1_id', 'telegram', '123456789', '{"username": "nino"}');

SELECT pg_temp.expect_error('identity: same Telegram account cannot belong to two users', '23505',
    $q$WITH u AS (INSERT INTO users DEFAULT VALUES RETURNING id)
       INSERT INTO auth_identities (user_id, provider, provider_user_id) SELECT id, 'telegram', '123456789' FROM u$q$);
-- One user, several providers: Telegram + a web login.
INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES (:'u1_id', 'email', 'nino@example.com');
SELECT pg_temp.expect('identity: one user can hold Telegram and web identities',
    (SELECT count(*) FROM auth_identities WHERE user_id = :'u1_id') = 2);
SELECT pg_temp.expect_error('identity: provider code must be lower-case', '23514',
    format($q$INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES (%L, 'Telegram', '1')$q$, :'u1_id'));
SELECT pg_temp.expect('identity: users table has no provider columns',
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'users' AND column_name ILIKE '%telegram%'));

-- Sessions and results ------------------------------------------------------
INSERT INTO game_sessions (user_id, game_mode_id, client_platform)
    VALUES (:'u1_id', (SELECT v FROM t WHERE k = 'easy'), 'telegram') RETURNING id \gset s1_

SELECT pg_temp.expect_error('result: rejected while session is in progress', '23514',
    format($q$INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds)
              VALUES (%L, %L, (SELECT v FROM t WHERE k = 'easy'), 800, 7, 10)$q$, :'s1_id', :'u1_id'));
SELECT pg_temp.expect_error('session: completed without ended_at', '23514',
    format($q$UPDATE game_sessions SET status = 'completed' WHERE id = %L$q$, :'s1_id'));

UPDATE game_sessions SET status = 'completed', ended_at = started_at + interval '3 minutes' WHERE id = :'s1_id';
INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds, best_streak, completed_at)
    VALUES (:'s1_id', :'u1_id', (SELECT v FROM t WHERE k = 'easy'), 800, 7, 10, 4, '2000-01-01Z')
    RETURNING id \gset r1_

SELECT pg_temp.expect('result: completed_at copied from session ended_at',
    (SELECT r.completed_at = s.ended_at FROM game_results r JOIN game_sessions s ON s.id = r.session_id
     WHERE r.id = :'r1_id'));
SELECT pg_temp.expect_error('result: second result for the same session', '23505',
    format($q$INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds)
              VALUES (%L, %L, (SELECT v FROM t WHERE k = 'easy'), 900, 8, 10)$q$, :'s1_id', :'u1_id'));
SELECT pg_temp.expect_error('result: user must match the session''s user', '23503',
    format($q$WITH u AS (INSERT INTO users DEFAULT VALUES RETURNING id),
                   s AS (INSERT INTO game_sessions (user_id, game_mode_id, client_platform, status, ended_at)
                         SELECT id, (SELECT v FROM t WHERE k = 'easy'), 'web', 'completed', now() FROM u RETURNING id)
              INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds)
              SELECT s.id, %L, (SELECT v FROM t WHERE k = 'easy'), 1, 1, 10 FROM s$q$, :'u1_id'));
SELECT pg_temp.expect_error('result: mode must match the session''s mode', '23503',
    $q$WITH s AS (INSERT INTO game_sessions (user_id, game_mode_id, client_platform, status, ended_at)
                  SELECT v, (SELECT v FROM t WHERE k = 'easy'), 'web', 'completed', now() FROM t WHERE k = 'u1' RETURNING id, user_id)
       INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds)
       SELECT id, user_id, (SELECT v FROM t WHERE k = 'chain'), 150, 1, 3 FROM s$q$);
SELECT pg_temp.expect_error('result: score cannot be edited', '23514',
    format($q$UPDATE game_results SET score = 1350 WHERE id = %L$q$, :'r1_id'));
SELECT pg_temp.expect_error('session: completed session cannot be reopened', '23514',
    format($q$UPDATE game_sessions SET status = 'abandoned' WHERE id = %L$q$, :'s1_id'));
SELECT pg_temp.expect_error('result: correct_count cannot exceed total_rounds', '23514',
    $q$WITH s AS (INSERT INTO game_sessions (user_id, game_mode_id, client_platform, status, ended_at)
                  SELECT v, (SELECT v FROM t WHERE k = 'easy'), 'web', 'completed', now() FROM t WHERE k = 'u1' RETURNING id, user_id, game_mode_id)
       INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds)
       SELECT id, user_id, game_mode_id, 100, 11, 10 FROM s$q$);

-- A new best adds a row; the old result stays.
INSERT INTO game_sessions (user_id, game_mode_id, client_platform, status, ended_at)
    VALUES (:'u1_id', (SELECT v FROM t WHERE k = 'easy'), 'web', 'completed', now() + interval '1 day')
    RETURNING id \gset s2_
INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds, best_streak)
    VALUES (:'s2_id', :'u1_id', (SELECT v FROM t WHERE k = 'easy'), 1350, 10, 10, 10);
SELECT pg_temp.expect('history: both results kept, best = 1350',
    (SELECT count(*) = 2 AND max(score) = 1350 FROM game_results
     WHERE user_id = :'u1_id' AND game_mode_id = (SELECT v FROM t WHERE k = 'easy')));

-- Account merge: moving sessions moves their results (ON UPDATE CASCADE).
INSERT INTO users DEFAULT VALUES RETURNING id \gset u2_
UPDATE game_sessions SET user_id = :'u2_id' WHERE user_id = :'u1_id';
SELECT pg_temp.expect('merge: results follow their sessions to the surviving user',
    (SELECT count(*) FROM game_results WHERE user_id = :'u2_id') = 2);

-- Deleting a user removes their data.
DELETE FROM users WHERE id = :'u2_id';
SELECT pg_temp.expect('delete: user deletion cascades to sessions and results',
    NOT EXISTS (SELECT 1 FROM game_results WHERE user_id = :'u2_id')
    AND NOT EXISTS (SELECT 1 FROM game_sessions WHERE user_id = :'u2_id'));

-- Outbox --------------------------------------------------------------------
INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES ('game_result', :'r1_id', 'game_result.recorded', '{"score": 800}');
SELECT pg_temp.expect_error('outbox: event_type must be dotted lower-case', '23514',
    format($q$INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
              VALUES ('game_result', %L, 'GameResultRecorded', '{}')$q$, :'r1_id'));
SELECT pg_temp.expect_error('outbox: published requires published_at', '23514',
    $q$UPDATE outbox_events SET status = 'published'$q$);

-- UTC -----------------------------------------------------------------------
SELECT pg_temp.expect('timestamps: every timestamp column is timestamptz',
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'));

\echo 'All schema checks passed. Rolling back.'
ROLLBACK;

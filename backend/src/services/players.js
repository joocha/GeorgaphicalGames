import { withTransaction } from '../db.js';

const TELEGRAM = 'telegram';

// Truncate by Unicode code points, matching PostgreSQL's varchar(n).
function clip(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, max).join('').trim() || null;
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

// Telegram login (docs/database.md, section 7). Finds the player by their
// Telegram ID or registers them (users + user_profiles + auth_identities) in
// one transaction, then refreshes the profile, provider_data and timestamps.
//
// `launch` is the verified result of verifyTelegramInitData(); `client` holds
// unsigned hints from the Mini App (platform, version) kept for analytics.
export async function loginTelegramPlayer(pool, launch, client = {}) {
  const tgUser = launch.user;
  const providerUserId = String(tgUser.id);

  const displayName = clip([tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '), 64)
    || clip(tgUser.username, 64);
  const avatarUrl = httpsUrl(tgUser.photo_url);
  const locale = clip(tgUser.language_code, 35);

  const providerData = compact({
    username: tgUser.username,
    first_name: tgUser.first_name,
    last_name: tgUser.last_name,
    language_code: tgUser.language_code,
    is_premium: tgUser.is_premium,
    is_bot: tgUser.is_bot,
    allows_write_to_pm: tgUser.allows_write_to_pm,
    added_to_attachment_menu: tgUser.added_to_attachment_menu,
    photo_url: avatarUrl,
    last_launch: compact({
      auth_date: launch.authDate.toISOString(),
      chat_type: launch.chatType,
      chat_instance: launch.chatInstance,
      start_param: launch.startParam,
      platform: clip(client.platform, 32),
      version: clip(client.version, 16),
    }),
  });

  return withTransaction(pool, async (db) => {
    let isNew = false;
    let { rows } = await db.query(
      `SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2`,
      [TELEGRAM, providerUserId],
    );
    let userId = rows[0]?.user_id;

    if (!userId) {
      const created = await db.query(`INSERT INTO users DEFAULT VALUES RETURNING id`);
      const newUserId = created.rows[0].id;
      // If a parallel first login of the same player won the race, ON
      // CONFLICT waits for it and returns nothing: drop our user and use theirs.
      const linked = await db.query(
        `INSERT INTO auth_identities (user_id, provider, provider_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, provider_user_id) DO NOTHING
         RETURNING user_id`,
        [newUserId, TELEGRAM, providerUserId],
      );
      if (linked.rows.length) {
        userId = newUserId;
        isNew = true;
      } else {
        await db.query(`DELETE FROM users WHERE id = $1`, [newUserId]);
        ({ rows } = await db.query(
          `SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2`,
          [TELEGRAM, providerUserId],
        ));
        userId = rows[0].user_id;
      }
    }

    await db.query(
      `UPDATE auth_identities
          SET provider_data = $3, last_used_at = now(), updated_at = now()
        WHERE provider = $1 AND provider_user_id = $2`,
      [TELEGRAM, providerUserId, providerData],
    );

    await db.query(`UPDATE users SET last_seen_at = now(), updated_at = now() WHERE id = $1`, [userId]);

    // Telegram is the only profile source for now, so it refreshes the
    // display name on every login; avatar and locale keep their last value
    // when Telegram stops sending them.
    const profile = await db.query(
      `INSERT INTO user_profiles (user_id, display_name, avatar_url, locale)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
          SET display_name = EXCLUDED.display_name,
              avatar_url   = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
              locale       = COALESCE(EXCLUDED.locale, user_profiles.locale),
              updated_at   = now()
       RETURNING display_name, avatar_url, locale`,
      [userId, displayName, avatarUrl, locale],
    );

    return {
      userId,
      isNew,
      profile: toProfile(profile.rows[0]),
      telegram: { id: providerUserId, username: tgUser.username || null },
    };
  });
}

function toProfile(row) {
  return row
    ? { displayName: row.display_name, avatarUrl: row.avatar_url, locale: row.locale }
    : { displayName: null, avatarUrl: null, locale: null };
}

export async function getProfile(db, userId) {
  const { rows } = await db.query(
    `SELECT display_name, avatar_url, locale FROM user_profiles WHERE user_id = $1`,
    [userId],
  );
  return toProfile(rows[0]);
}

// Personal bests per mode of one game, keyed by mode code. "best" follows
// the mode's best_metric, so it matches what the frontend shows
// (docs/database.md, section 8).
export async function getPersonalBests(db, userId, gameCode) {
  const { rows } = await db.query(
    `SELECT gm.code AS mode, gm.best_metric,
            CASE gm.best_metric WHEN 'score'         THEN max(r.score)
                                WHEN 'correct_count' THEN max(r.correct_count)
                                WHEN 'stars'         THEN max(r.stars) END AS best,
            count(r.id)::int AS plays,
            max(r.completed_at) AS last_played_at
       FROM game_modes gm
       JOIN games g ON g.id = gm.game_id
       LEFT JOIN game_results r ON r.game_mode_id = gm.id AND r.user_id = $1
      WHERE g.code = $2
      GROUP BY gm.code, gm.best_metric, gm.sort_order
      ORDER BY gm.sort_order`,
    [userId, gameCode],
  );

  return Object.fromEntries(rows.map((r) => [r.mode, {
    metric: r.best_metric,
    best: r.best,
    plays: r.plays,
    lastPlayedAt: r.last_played_at,
  }]));
}

// Administrator-controlled unlocking.
//
//   npm run admin:unlock -- --telegram-id 123456789 --level earth --by <admin> [--note "..."]
//
// Grants a level to one player (user_level_unlocks, source 'admin') and
// emits a level.unlocked outbox event. It never changes scores or history.
import './env.js';
import { createPool, withTransaction } from '../src/db.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const telegramId = flag('telegram-id');
const levelCode = flag('level');
const by = flag('by');
if (!telegramId || !levelCode || !by) {
  console.error('usage: --telegram-id <id> --level <code> --by <admin> [--note "..."]');
  process.exit(2);
}

const pool = createPool(process.env.DATABASE_URL);
if (!pool) { console.error('DATABASE_URL is not set'); process.exit(1); }
try {
  const out = await withTransaction(pool, async (db) => {
    const { rows: [user] } = await db.query(
      `SELECT user_id FROM auth_identities WHERE provider = 'telegram' AND provider_user_id = $1`, [String(telegramId)]);
    if (!user) throw new Error(`no player with Telegram ID ${telegramId}`);
    const { rows: [level] } = await db.query(`SELECT id, number, code FROM game_levels WHERE code = $1`, [levelCode]);
    if (!level) throw new Error(`no level ${levelCode}`);
    const { rowCount } = await db.query(
      `INSERT INTO user_level_unlocks (user_id, level_id, source, granted_by, note) VALUES ($1, $2, 'admin', $3, $4)
       ON CONFLICT (user_id, level_id) DO NOTHING`,
      [user.user_id, level.id, by, flag('note') ?? null]);
    if (rowCount) {
      await db.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('user', $1, 'level.unlocked', $2)`,
        [user.user_id, { userId: user.user_id, level: level.code, levelNumber: level.number, source: 'admin', grantedBy: by }]);
    }
    return rowCount ? 'unlocked' : 'was already unlocked';
  });
  console.log(`Level ${levelCode} ${out} for Telegram user ${telegramId}.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

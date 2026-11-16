// Question review workflow (the approval step for AI drafts).
//
//   npm run questions -- list [--status in_review|draft|verified|rejected] [--level hydro]
//   npm run questions -- show <code>
//   npm run questions -- approve <code> --by <reviewer> [--note "..."]
//   npm run questions -- reject  <code> --by <reviewer> --note "why"
//
// Only 'verified' questions are ever served to players. Approving records
// who reviewed the question and when (enforced by a CHECK constraint).
import './env.js';
import { createPool } from '../src/db.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.find((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));

const pool = createPool(process.env.DATABASE_URL);
if (!pool) { console.error('DATABASE_URL is not set'); process.exit(1); }

try {
  if (cmd === 'list') {
    const { rows } = await pool.query(
      `SELECT q.code, l.code AS level, q.question_type, q.verification_status, q.origin, q.fact_ref IS NOT NULL AS fact_checked, q.question_text
         FROM question_bank q JOIN game_levels l ON l.id = q.level_id
        WHERE ($1::text IS NULL OR q.verification_status = $1) AND ($2::text IS NULL OR l.code = $2)
        ORDER BY l.number, q.code`,
      [flag('status') ?? null, flag('level') ?? null],
    );
    for (const r of rows) console.log(`${r.verification_status.padEnd(9)} ${r.origin.padEnd(12)} ${r.fact_checked ? 'fact ' : '     '} ${r.level.padEnd(9)} ${r.code}  ${r.question_text}`);
    console.log(`${rows.length} question(s)`);
  } else if (cmd === 'show') {
    const { rows } = await pool.query(`SELECT * FROM question_bank WHERE code = $1`, [positional]);
    if (!rows.length) throw new Error(`no question ${positional}`);
    console.log(JSON.stringify(rows[0], null, 2));
  } else if (cmd === 'approve' || cmd === 'reject') {
    const by = flag('by');
    const note = flag('note');
    if (!positional || !by) throw new Error(`usage: ${cmd} <code> --by <reviewer>${cmd === 'reject' ? ' --note "why"' : ''}`);
    if (cmd === 'reject' && !note) throw new Error('a rejection needs --note');
    const { rowCount } = await pool.query(
      `UPDATE question_bank
          SET verification_status = $2, reviewed_by = $3, reviewed_at = now(),
              review_note = concat_ws(' | ', review_note, $4::text), updated_at = now()
        WHERE code = $1`,
      [positional, cmd === 'approve' ? 'verified' : 'rejected', by, note ?? null],
    );
    if (!rowCount) throw new Error(`no question ${positional}`);
    console.log(`${positional}: ${cmd === 'approve' ? 'verified' : 'rejected'} by ${by}`);
  } else {
    console.error('usage: list | show <code> | approve <code> --by <name> | reject <code> --by <name> --note "..."');
    process.exitCode = 2;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

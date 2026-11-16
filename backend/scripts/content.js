// Content pipeline CLI.
//
//   npm run content:check     validate backend/content/ (no database needed)
//   npm run content:import    validate, then upsert into DATABASE_URL in one transaction
//
// Import is idempotent and never deletes anything; see src/content/import.js.
import './env.js';
import { buildContent, loadContentFiles } from '../src/content/build.js';
import { importContent } from '../src/content/import.js';
import { createPool } from '../src/db.js';

const cmd = process.argv[2];
if (!['check', 'import'].includes(cmd)) {
  console.error('usage: node scripts/content.js check|import');
  process.exit(2);
}

const { content, errors, warnings } = buildContent(loadContentFiles());
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`${errors.length} error(s); nothing imported.`);
  process.exit(1);
}
const byLevel = {};
for (const q of content.questions) byLevel[q.levelCode] = (byLevel[q.levelCode] || 0) + 1;
console.log(`content OK: ${content.sources.length} sources, ${content.countries.length} countries, ${content.objects.length} objects, `
  + `${content.relations.length} relations, ${content.links.length} links, ${content.stats.length} statistics, `
  + `${content.questions.length} questions ${JSON.stringify(byLevel)}`);

if (cmd === 'import') {
  const pool = createPool(process.env.DATABASE_URL);
  if (!pool) { console.error('DATABASE_URL is not set'); process.exit(1); }
  try {
    const summary = await importContent(pool, content, { log: console.log });
    console.log('imported:', JSON.stringify(summary));
  } finally {
    await pool.end();
  }
}

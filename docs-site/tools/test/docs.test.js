// Tests for the documentation tools: rendering, validation gates, release
// builds, the generator on a real git history, freezing and atomic
// publication with rollback. Run: cd docs-site && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderMarkdown, slugify } from '../lib/markdown.js';
import { validateDist, validateSource, scanSensitive } from '../lib/validate.js';
import { buildSite } from '../lib/build.js';
import { generate, findReleaseCommit, classify } from '../lib/generate.js';
import { freeze, publish } from '../lib/release.js';
import { DOCS_DIR, checksumDir, readJson, writeJson } from '../lib/util.js';

const tmp = (p) => mkdtempSync(join(tmpdir(), `docs-${p}-`));

// A copy of docs-site/ (without build output) to mutate.
function copyDocs(root = tmp('src')) {
  const dst = join(root, 'docs-site');
  cpSync(DOCS_DIR, dst, { recursive: true, filter: (s) => !/[/\\](dist|node_modules)$/.test(s) });
  return dst;
}
const V = (d) => join(d, 'versions', 'v2.3.0');
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, 'utf8')));
const errorsOf = (d, opts = {}) => validateSource({ docsDir: d, ...opts }).errors.join('\n');

// ---- markdown ---------------------------------------------------------------

test('markdown: headings, anchors, tables, nested lists, links, escaping', () => {
  const md = '# Title\n\n## Partial answers (Levels 2–5)\n\n| A | B |\n|---|--:|\n| `x` | **y** |\n\n- one\n  - nested\n- two [link](scoring-system.md#a) <b>raw</b>\n\n<!-- hidden -->\n```\n<code>\n```\n';
  const { html, headings } = renderMarkdown(md);
  assert.equal(headings[1].id, 'partial-answers-levels-25');
  assert.match(html, /<table>.*<th>A<\/th><th style="text-align:right">B<\/th>/s);
  assert.match(html, /<li>one<ul><li>nested<\/li><\/ul><\/li>/);
  assert.match(html, /href="scoring-system\.html#a"/);
  assert.match(html, /&lt;b&gt;raw&lt;\/b&gt;/);
  assert.doesNotMatch(html, /hidden/);
  assert.match(html, /<pre><code>&lt;code&gt;<\/code><\/pre>/);
  assert.equal(slugify("What's New in This Version"), 'whats-new-in-this-version');
});

// ---- validation -----------------------------------------------------------------

test('the real documentation sources pass strict validation', () => {
  const r = validateSource({ docsDir: DOCS_DIR, strict: true });
  assert.deepEqual(r.errors, []);
});

test('validation catches missing sections, order, links, secrets, private data and false claims', () => {
  const cases = [
    ['missing required section', (d) => rmSync(join(V(d), 'faq.md')), /required section "FAQ" is missing/],
    ["What's New not last", (d) => edit(join(d, 'navigation.json'), (s) => { const n = JSON.parse(s); n.pages.push(n.pages.splice(-1, 1)[0], { id: 'x', title: 'X', file: 'x.md' }); return JSON.stringify(n); }), /"whats-new" must be the last page/],
    ['invalid version number', (d) => edit(join(d, 'versions.json'), (s) => s.replace('"version": "2.3.0"', '"version": "2.3"')), /must be MAJOR\.MINOR\.PATCH/],
    ['broken link', (d) => edit(join(V(d), 'faq.md'), (s) => `${s}\n[x](nope.md)\n`), /broken link nope\.md/],
    ['broken anchor', (d) => edit(join(V(d), 'faq.md'), (s) => `${s}\n[x](scoring-system.md#nope)\n`), /broken anchor #nope/],
    ['bot token', (d) => edit(join(V(d), 'faq.md'), (s) => `${s}\nToken 123456789:${'A'.repeat(35)}\n`), /secret: Telegram bot token/],
    ['server path', (d) => edit(join(V(d), 'faq.md'), (s) => `${s}\nFiles live in /home/projects/x.\n`), /secret: server path/],
    ['e-mail address', (d) => edit(join(V(d), 'faq.md'), (s) => `${s}\nWrite to someone@example.com.\n`), /private data: e-mail address/],
    ['Telegram user id', (d) => edit(join(V(d), 'faq.md'), (s) => `${s}\nPlayer 123456789 won.\n`), /private data: numeric identifier/],
    ['unsupported feature claim', (d) => edit(join(V(d), 'faq.md'), (s) => `${s}\nCheck the leaderboard after each game.\n`), /mentions "leaderboards"/],
    ['category order', (d) => edit(join(V(d), 'whats-new.md'), (s) => s.replace('## Improvements', '## Tmp').replace('## Bug Fixes', '## Improvements').replace('## Tmp', '## Bug Fixes')), /categories must appear in this order/],
    ['empty category', (d) => edit(join(V(d), 'whats-new.md'), (s) => s.replace('- No bug fixes in this release.', 'Nothing.')), /category "Bug Fixes" is empty/],
  ];
  for (const [name, mutate, expected] of cases) {
    const d = copyDocs();
    mutate(d);
    // A mutated final version also fails its checksum; the specific error must be there too.
    assert.match(errorsOf(d), expected, name);
  }
});

test('published versions are immutable: any edit fails the checksum', () => {
  const d = copyDocs();
  edit(join(V(d), 'game-rules.md'), (s) => s.replace('exactly **10 rounds**', 'exactly **12 rounds**'));
  assert.match(errorsOf(d), /published documentation was modified \(checksum mismatch\)/);
});

test('release validation: the deployed version needs final docs, and history must be preserved', () => {
  const d = copyDocs();
  assert.match(errorsOf(d, { release: { appVersion: '2.4.0' } }), /app version 2\.4\.0 has no documentation/);
  const previous = { versions: [{ version: '2.2.0', checksum: 'sha256-x' }, { version: '2.3.0', checksum: 'sha256-y' }] };
  const e = errorsOf(d, { release: { appVersion: '2.3.0', previousManifest: previous } });
  assert.match(e, /previously published version 2\.2\.0 is missing/);
  assert.match(e, /previously published version 2\.3\.0 has a different checksum/);
});

test('sensitive-data scanner ignores ordinary documentation text', () => {
  assert.deepEqual(scanSensitive('Level 2 at 1,000 points; version 2.3.0; t.me/geoaigames_bot/play; 10,000.'), []);
});

// ---- build ----------------------------------------------------------------------

test('release build: current version, /latest/ copy, What\'s New last, drafts excluded', () => {
  const d = copyDocs();
  // A draft 2.4.0 must not appear in a release build for 2.3.0.
  cpSync(V(d), join(d, 'versions', 'v2.4.0'), { recursive: true });
  edit(join(d, 'versions.json'), (s) => { const m = JSON.parse(s); m.versions.push({ version: '2.4.0', releaseDate: '2026-12-01', status: 'draft' }); return JSON.stringify(m); });
  const out = join(tmp('out'), 'site');
  const res = buildSite({ docsDir: d, out, release: true, appVersion: '2.3.0' });
  assert.deepEqual(res.versions, ['2.3.0']);
  assert.equal(existsSync(join(out, 'versions', 'v2.4.0')), false);
  const m = readJson(join(out, 'data', 'versions.json'));
  assert.equal(m.currentVersion, '2.3.0');
  assert.equal(readFileSync(join(out, 'latest', 'faq.md'), 'utf8'), readFileSync(join(V(d), 'faq.md'), 'utf8'));
  assert.match(readFileSync(join(out, 'latest', 'all.md'), 'utf8'), /# What's New in This Version[\s\S]*$/);
  assert.deepEqual(validateDist({ dist: out, expectVersion: '2.3.0', docsDir: d }).errors, []);
  assert.throws(() => buildSite({ docsDir: d, out, release: true, appVersion: '2.4.0' }), /is a draft/);
  assert.throws(() => buildSite({ docsDir: d, out, release: true, appVersion: '9.0.0' }), /no documentation for app version 9\.0\.0/);
});

// ---- generator on a real git history ------------------------------------------------

function gitRepo() {
  const root = tmp('repo');
  const d = copyDocs(root);
  rmSync(join(d, 'reviews'), { recursive: true, force: true });
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  const put = (p, text) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), text); };
  put('backend/package.json', JSON.stringify({ name: 'x', version: '2.3.0' }));
  put('backend/src/engine/scoring.js', 'export const SCORING_VERSION = 2;\nexport const DEFAULT_SCORING = Object.freeze({\n  pointScale: 0.1,\n  streakBonusCap: 5,\n});\n');
  put('backend/content/questions/level-2-hydro.json', JSON.stringify({ level: 'hydro', questions: [{ code: 'a' }, { code: 'b' }] }));
  put('backend/src/app.js', "api.get('/health', h);\n");
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '-m', 'release 2.3.0');
  put('backend/README.md', 'docs only, same version\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'docs after 2.3.0');
  return { root, d, g, put };
}

test('findReleaseCommit returns the last commit of a version', () => {
  const { root, g, put } = gitRepo();
  const last = g('rev-parse', 'HEAD').trim();
  put('backend/package.json', JSON.stringify({ name: 'x', version: '2.4.0' }));
  g('commit', '-qam', 'bump');
  assert.equal(findReleaseCommit(root, 'backend/package.json', '2.3.0'), last);
});

test('generate → review → freeze → release build: the complete documentation workflow', () => {
  const { root, d, g, put } = gitRepo();
  // Refuses while the app version has not been bumped.
  assert.throws(() => generate({ docsDir: d, repo: root, date: '2026-12-01' }), /not newer than the last documented version/);

  put('backend/package.json', JSON.stringify({ name: 'x', version: '2.4.0' }));
  put('backend/src/engine/scoring.js', 'export const SCORING_VERSION = 2;\nexport const DEFAULT_SCORING = Object.freeze({\n  pointScale: 0.1,\n  streakBonusCap: 8,\n});\n');
  put('backend/content/questions/level-2-hydro.json', JSON.stringify({ level: 'hydro', questions: [{ code: 'a' }, { code: 'b' }, { code: 'c' }] }));
  put('backend/src/app.js', "api.get('/health', h);\napi.get('/leaderboard', h);\n");
  put('misc/notes.txt', 'unclassified');
  g('add', '-A');
  g('commit', '-q', '-m', 'v2.4.0 work');
  put('backend/src/services/stats.js', '// uncommitted change\n');
  edit(join(d, 'release-notes', 'NEXT.md'), (s) => s.replace('## New Features\n', '## New Features\n\n- The streak bonus now goes up to 8 points.\n'));

  const res = generate({ docsDir: d, repo: root, date: '2026-12-01' });
  assert.equal(res.prevVersion, '2.3.0');
  const v4 = join(d, 'versions', 'v2.4.0');
  const scoring = readFileSync(join(v4, 'scoring-system.md'), 'utf8');
  assert.match(scoring, /<!-- REVIEW \(generated for 2\.4\.0\)[\s\S]*Scoring rules \(DEFAULT_SCORING, SCORING_VERSION\) changed/);
  assert.match(scoring, /^version: 2\.4\.0$/m);
  assert.match(readFileSync(join(v4, 'user-statistics.md'), 'utf8'), /Player statistics: backend\/src\/services\/stats\.js/);
  assert.match(readFileSync(join(v4, 'levels-guide.md'), 'utf8'), /Questions in level "hydro": 2 → 3/);
  assert.match(readFileSync(join(v4, 'index.md'), 'utf8'), /unclassified file changed: misc\/notes\.txt/);
  assert.doesNotMatch(readFileSync(join(v4, 'game-overview.md'), 'utf8'), /REVIEW/, 'pages without evidence are not flagged');
  const wn = readFileSync(join(v4, 'whats-new.md'), 'utf8');
  assert.match(wn, /- The streak bonus now goes up to 8 points\./);
  assert.match(wn, /- \*\*Version:\*\* 2\.4\.0/);
  const report = readFileSync(join(d, 'reviews', 'v2.4.0.md'), 'utf8');
  assert.match(report, /API routes[\s\S]*GET \/leaderboard/);
  assert.match(report, /v2\.4\.0 work/);
  assert.equal(readJson(join(d, 'versions.json')).versions[1].status, 'draft');

  // Open REVIEW items block strict validation, freezing and publication.
  assert.match(errorsOf(d, { strict: true }), /open REVIEW item/);
  assert.throws(() => freeze({ docsDir: d, version: '2.4.0', now: '2026-12-01' }), /cannot be frozen/);
  assert.throws(() => generate({ docsDir: d, repo: root, date: '2026-12-01' }), /already exists/);

  // The reviewer updates the pages and removes the markers.
  for (const f of readdirSync(v4)) edit(join(v4, f), (s) => s.replace(/<!-- REVIEW[\s\S]*?-->\n?/g, ''));
  edit(join(v4, 'scoring-system.md'), (s) => s.replace('| Easy and Levels 2–5 | 10 |', '| Easy and Levels 2–5 (updated) | 10 |'));
  const before = checksumDir(V(d));
  const fr = freeze({ docsDir: d, version: '2.4.0', date: '2026-12-02', now: '2026-12-02' });
  assert.match(fr.checksum, /^sha256-/);
  const m = readJson(join(d, 'versions.json'));
  assert.deepEqual(m.versions.map((v) => [v.version, v.status]), [['2.3.0', 'final'], ['2.4.0', 'final']]);
  assert.equal(m.versions[1].releaseDate, '2026-12-02');
  assert.match(readFileSync(join(v4, 'scoring-system.md'), 'utf8'), /^lastUpdated: 2026-12-02$/m, 'changed page gets a new date');
  assert.match(readFileSync(join(v4, 'faq.md'), 'utf8'), /^lastUpdated: 2026-11-19$/m, 'unchanged page keeps its date');
  assert.equal(checksumDir(V(d)), before, '2.3.0 untouched');
  assert.ok(existsSync(join(d, 'release-notes', 'archive', 'v2.4.0.md')));
  assert.doesNotMatch(readFileSync(join(d, 'release-notes', 'NEXT.md'), 'utf8'), /streak bonus now/);

  const out = join(tmp('out'), 'site');
  buildSite({ docsDir: d, out, release: true, appVersion: '2.4.0' });
  const pub = readJson(join(out, 'data', 'versions.json'));
  assert.equal(pub.currentVersion, '2.4.0');
  assert.deepEqual(pub.versions.map((v) => v.version), ['2.4.0', '2.3.0']);
  assert.match(readFileSync(join(out, 'versions', 'v2.3.0', 'faq.html'), 'utf8'), /The current version is <a href="..\/..\/latest\/faq.html">2\.4\.0/);
  const changelog = readFileSync(join(out, 'changelog', 'index.md'), 'utf8');
  assert.ok(changelog.indexOf('## Version 2.4.0') < changelog.indexOf('## Version 2.3.0'));
  assert.deepEqual(validateDist({ dist: out, expectVersion: '2.4.0', docsDir: d }).errors, []);
});

test('classify maps source files to documentation pages', () => {
  assert.deepEqual(classify('backend/src/engine/scoring.js').pages, ['scoring-system', 'game-rules', 'faq']);
  assert.deepEqual(classify('backend/test/levels.test.js').pages, []);
  assert.equal(classify('something/else.bin').pages, null);
});

// ---- publication -------------------------------------------------------------------

test('publish: skipped when not set up, atomic switch, failed release keeps the previous docs', async () => {
  const { root, d } = gitRepo();
  const quiet = () => {};
  const docsRoot = join(tmp('pub'), 'geoaigames-docs');
  assert.equal((await publish({ docsDir: d, repo: root, docsRoot, log: quiet })).status, 'skipped');

  mkdirSync(docsRoot);
  const first = await publish({ docsDir: d, repo: root, docsRoot, log: quiet, now: new Date('2026-11-19T10:00:00Z') });
  assert.equal(first.status, 'published');
  const live = () => readlinkSync(join(docsRoot, 'current'));
  const firstTarget = live();
  assert.equal(readJson(join(docsRoot, 'current', 'data', 'versions.json')).currentVersion, '2.3.0');
  assert.equal(readJson(join(docsRoot, 'state', 'published.json')).current.version, '2.3.0');

  // A broken source (edited published version) must not replace the site.
  edit(join(V(d), 'faq.md'), (s) => `${s}\nchanged\n`);
  await assert.rejects(publish({ docsDir: d, repo: root, docsRoot, log: quiet, now: new Date('2026-11-19T11:00:00Z') }), /source validation failed/);
  assert.equal(live(), firstTarget);
  assert.deepEqual(readdirSync(join(docsRoot, 'releases')).filter((x) => x.startsWith('.staging')), []);
  assert.match(readFileSync(join(docsRoot, 'logs', 'publish.log'), 'utf8'), /FAILED/);
  assert.equal(existsSync(join(docsRoot, '.publish.lock')), false);

  // A failing public health check rolls back to the previous build.
  execFileSync('git', ['checkout', '--', '.'], { cwd: root });
  await assert.rejects(
    publish({ docsDir: d, repo: root, docsRoot, healthUrl: 'http://127.0.0.1:9', log: quiet, now: new Date('2026-11-19T12:00:00Z') }),
    /health check failed[\s\S]*rolled back/,
  );
  assert.equal(live(), firstTarget);
});

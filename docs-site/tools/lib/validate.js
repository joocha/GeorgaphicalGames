// Documentation validation. Every rule here is a publication gate: the
// deploy publishes nothing unless validateSource() and validateDist() pass.
// Rules and their reasons: docs/DOCUMENTATION_GUIDELINES.md.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { extractLinks, headingIds } from './markdown.js';
import {
  checksumDir, compareSemver, isIsoDate, isSemver, listFiles, loadProject, parseFrontMatter, readJson, versionDirName,
} from './util.js';

const WHATS_NEW_TITLE = "What's New in This Version";
const REVIEW_MARKER = /<!--\s*REVIEW\b/;
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b|lorem ipsum/i;

// Secrets and infrastructure details that must never be published. Each
// entry: [name, pattern]. Patterns are deliberately broad; a false positive
// is fixed by rewording the page, a false negative leaks a secret.
export const SECRET_PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['connection string with credentials', /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/i],
  ['secret assignment', /\b(DATABASE_URL|SESSION_SECRET|TELEGRAM_BOT_TOKEN|INTERNAL_API_TOKEN|API_KEY|SECRET_KEY|PASSWORD|PRIVATE_KEY)\s*[=:]\s*\S+/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['API key', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/],
  ['long hex secret', /\b(secret|token|key|password)\b[^\n]{0,20}\b[0-9a-f]{32,}\b/i],
  ['IP address', /\b(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/],
  ['local host name', /\blocalhost\b/i],
  ['server path', /(^|[\s(`'"])\/(home|etc|var|root|srv|opt|usr)\//],
  ['environment file', /(^|[\s(`'"/])\.env\b/],
];

// Personal data that must never appear in public documentation.
export const PRIVATE_DATA_PATTERNS = [
  ['e-mail address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['phone number', /\+\d[\d\s().-]{8,}\d/],
  ['numeric identifier (possible Telegram user ID)', /\b\d{7,}\b/],
  ['Telegram @username', /(^|[^\w/.])@[A-Za-z][A-Za-z0-9_]{4,}\b/],
];

// Scans text line by line. Returns [{line, kind, name}].
export function scanSensitive(text) {
  const hits = [];
  text.split('\n').forEach((line, idx) => {
    for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) hits.push({ line: idx + 1, kind: 'secret', name });
    for (const [name, re] of PRIVATE_DATA_PATTERNS) if (re.test(line)) hits.push({ line: idx + 1, kind: 'private data', name });
  });
  return hits;
}

// Lines that mention a feature that doesn't exist must say so: the line, or
// the heading it sits under, needs a negation ("no", "not available", ...).
// Headings themselves are topics, not claims, and are skipped.
export function findUnsupportedClaims(body, config) {
  const features = (config.unavailableFeatures || []).map((f) => ({ ...f, re: new RegExp(f.pattern, 'i') }));
  const neg = new RegExp(`(${(config.negationMarkers || []).map((m) => `\\b${m.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).join('|')})`, 'i');
  const hits = [];
  let heading = '';
  let inFence = false;
  body.split('\n').forEach((line, idx) => {
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) return;
    if (/^#{1,6}\s/.test(line)) { heading = line; return; }
    for (const f of features) {
      if (f.re.test(line) && !neg.test(line) && !neg.test(heading)) hits.push({ line: idx + 1, feature: f.feature });
    }
  });
  return hits;
}

class Report {
  constructor() { this.errors = []; this.warnings = []; }
  error(where, msg) { this.errors.push(`${where}: ${msg}`); }
  warn(where, msg) { this.warnings.push(`${where}: ${msg}`); }
  get ok() { return this.errors.length === 0; }
}

function checkManifest(project, r) {
  const { manifest, docsDir } = project;
  if (!manifest || !Array.isArray(manifest.versions)) { r.error('versions.json', '"versions" must be an array'); return []; }
  const seen = new Set();
  let prev = null;
  for (const v of manifest.versions) {
    const at = `versions.json ${v.version ?? '?'}`;
    if (!isSemver(v.version)) { r.error(at, 'version must be MAJOR.MINOR.PATCH'); continue; }
    if (seen.has(v.version)) r.error(at, 'duplicate version');
    seen.add(v.version);
    if (prev && compareSemver(v.version, prev) <= 0) r.error(at, `versions must be listed in ascending order (after ${prev})`);
    prev = v.version;
    if (!isIsoDate(v.releaseDate)) r.error(at, 'releaseDate must be YYYY-MM-DD');
    if (!['draft', 'final'].includes(v.status)) r.error(at, 'status must be "draft" or "final"');
    if (v.status === 'final' && !/^sha256-[0-9a-f]{64}$/.test(v.checksum || '')) r.error(at, 'a final version needs its checksum (run: docs freeze)');
    if (!existsSync(join(docsDir, 'versions', versionDirName(v.version)))) r.error(at, `directory versions/${versionDirName(v.version)} is missing`);
  }
  const dirs = existsSync(join(docsDir, 'versions')) ? readdirSync(join(docsDir, 'versions')).filter((d) => statSync(join(docsDir, 'versions', d)).isDirectory()) : [];
  for (const d of dirs) if (!manifest.versions.some((v) => versionDirName(v.version) === d)) r.error(`versions/${d}`, 'directory is not listed in versions.json');
  return manifest.versions.filter((v) => isSemver(v.version));
}

function checkNavigation(project, r) {
  const pages = project.navigation?.pages;
  if (!Array.isArray(pages) || !pages.length) { r.error('navigation.json', '"pages" must be a non-empty array'); return []; }
  const ids = new Set();
  for (const p of pages) {
    if (!p.id || !p.file || !p.title) r.error('navigation.json', 'every page needs id, title and file');
    if (ids.has(p.id)) r.error('navigation.json', `duplicate page id "${p.id}"`);
    ids.add(p.id);
  }
  if (pages[pages.length - 1].id !== 'whats-new') r.error('navigation.json', '"whats-new" must be the last page');
  if (!pages.some((p) => p.id === 'whats-new' && p.required)) r.error('navigation.json', '"whats-new" must be required');
  return pages;
}

// Resolves a relative Markdown link from `fromFile` (relative to docsDir).
// Returns the target path relative to docsDir and the anchor.
function resolveLink(fromFile, href) {
  const [path, anchor] = href.split('#');
  const target = path ? posix.normalize(posix.join(posix.dirname(fromFile), path)) : fromFile;
  return { target, anchor: anchor ? decodeURIComponent(anchor) : null };
}

function checkLinks(project, file, text, r, generated) {
  for (const l of extractLinks(text)) {
    const at = `${file}:${l.line}`;
    if (/^mailto:|^tel:/i.test(l.href)) { r.error(at, `contact links are not allowed (${l.href})`); continue; }
    if (/^http:\/\//i.test(l.href)) { r.warn(at, `insecure link ${l.href}`); continue; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(l.href)) continue;
    const { target, anchor } = resolveLink(file, l.href);
    if (target.startsWith('..')) { r.error(at, `link leaves the documentation (${l.href})`); continue; }
    if (generated.has(target)) continue;
    const abs = join(project.docsDir, target);
    if (!existsSync(abs)) { r.error(at, `broken link ${l.href}`); continue; }
    if (anchor && target.endsWith('.md')) {
      const ids = headingIds(readFileSync(abs, 'utf8')).map((h) => h.id);
      if (!ids.includes(anchor)) r.error(at, `broken anchor #${anchor} in ${target}`);
    }
  }
}

function readUtf8(abs, at, r) {
  const buf = readFileSync(abs);
  const text = buf.toString('utf8');
  if (text.includes('�')) r.error(at, 'file is not valid UTF-8');
  if (!text.trim()) r.error(at, 'file is empty');
  return text;
}

function checkPage(project, v, page, r, { strict }) {
  const file = `versions/${versionDirName(v.version)}/${page.file}`;
  const abs = join(project.docsDir, file);
  if (!existsSync(abs)) { if (page.required) r.error(file, `required section "${page.title}" is missing`); return null; }
  const text = readUtf8(abs, file, r);
  const { data, body } = parseFrontMatter(text);
  if (!data) { r.error(file, 'front matter (---) is missing'); return null; }
  for (const key of ['title', 'description', 'version', 'lastUpdated']) if (!data[key]) r.error(file, `front matter "${key}" is missing`);
  if (data.version && data.version !== v.version) r.error(file, `front matter version ${data.version} does not match ${v.version}`);
  if (data.lastUpdated && !isIsoDate(data.lastUpdated)) r.error(file, 'lastUpdated must be YYYY-MM-DD');
  const heads = headingIds(body);
  const h1 = heads.filter((h) => h.level === 1);
  if (h1.length !== 1) r.error(file, `needs exactly one "# " heading (found ${h1.length})`);
  else if (heads[0].level !== 1) r.error(file, 'the first heading must be the "# " title');
  else if (data.title && h1[0].text !== data.title) r.error(file, `heading "${h1[0].text}" does not match title "${data.title}"`);
  if ((body.match(/^```/gm) || []).length % 2) r.error(file, 'unclosed code fence');
  // Line numbers in messages refer to the file, front matter included.
  const off = text.split('\n').length - body.split('\n').length;
  body.split('\n').forEach((line, idx) => {
    if (REVIEW_MARKER.test(line)) (strict ? r.error : r.warn).call(r, `${file}:${idx + 1 + off}`, 'open REVIEW item (update the page, then delete the marker)');
    if (PLACEHOLDER.test(line.replace(/<!--.*?-->/g, ''))) r.error(`${file}:${idx + 1 + off}`, 'placeholder text');
  });
  for (const h of scanSensitive(text)) r.error(`${file}:${h.line}`, `${h.kind}: ${h.name}`);
  for (const h of findUnsupportedClaims(body, project.config)) r.error(`${file}:${h.line + off}`, `mentions "${h.feature}", which does not exist, without saying so`);
  return { file, data, body, text };
}

function checkWhatsNew(project, v, page, r) {
  const { file, data, body } = page;
  const heads = headingIds(body);
  if (heads[0]?.text !== WHATS_NEW_TITLE) r.error(file, `title must be "${WHATS_NEW_TITLE}"`);
  if (!body.includes(`**Version:** ${v.version}`)) r.error(file, `must state "**Version:** ${v.version}"`);
  if (!body.includes(`**Release date:** ${v.releaseDate}`)) r.error(file, `must state "**Release date:** ${v.releaseDate}" (from versions.json)`);
  if (data.releaseDate && data.releaseDate !== v.releaseDate) r.error(file, 'front matter releaseDate differs from versions.json');
  const cats = project.config.whatsNewCategories;
  const h2 = heads.filter((h) => h.level === 2).map((h) => h.text);
  const order = cats.map((c) => h2.indexOf(c));
  cats.forEach((c, k) => { if (order[k] < 0) r.error(file, `category "## ${c}" is missing`); });
  if (order.every((x) => x >= 0) && order.some((x, k) => k && x < order[k - 1])) r.error(file, `categories must appear in this order: ${cats.join(', ')}`);
  // Every category needs content: at least one list item before the next heading.
  const lines = body.split('\n');
  for (const c of cats) {
    const start = lines.findIndex((l) => l.trim() === `## ${c}`);
    if (start < 0) continue;
    let k = start + 1;
    let items = 0;
    while (k < lines.length && !/^#{1,2}\s/.test(lines[k])) if (/^\s*[-*]\s+\S/.test(lines[k++])) items++;
    if (!items) r.error(file, `category "${c}" is empty (write "- None." if nothing changed)`);
  }
}

// Validates the documentation sources.
//   strict:     treat open REVIEW items as errors (always for final versions)
//   release:    {appVersion, previousManifest?}: a deploy is about to publish
export function validateSource({ docsDir, release = null, strict = false } = {}) {
  const r = new Report();
  let project;
  try { project = loadProject(docsDir); } catch (e) { r.error('config', e.message); return r; }
  const versions = checkManifest(project, r);
  const pages = checkNavigation(project, r);
  const generated = new Set(['changelog/index.md']);

  for (const v of versions) {
    const dir = join(project.docsDir, 'versions', versionDirName(v.version));
    if (!existsSync(dir)) continue;
    const isStrict = strict || v.status === 'final' || (release && v.version === release.appVersion);
    const known = new Set(pages.map((p) => p.file));
    for (const f of listFiles(dir)) if (!known.has(f)) r.error(`versions/${versionDirName(v.version)}/${f}`, 'file is not in navigation.json');
    for (const p of pages) {
      const page = checkPage(project, v, p, r, { strict: isStrict });
      if (!page) continue;
      checkLinks(project, page.file, page.text, r, generated);
      if (p.id === 'whats-new') checkWhatsNew(project, v, page, r);
    }
    if (v.status === 'final' && v.checksum) {
      const now = checksumDir(dir);
      if (now !== v.checksum) r.error(`versions/${versionDirName(v.version)}`, 'published documentation was modified (checksum mismatch). Published versions are immutable: put corrections into the next version.');
    }
  }

  for (const f of ['changelog/history.md', 'release-notes/NEXT.md']) {
    const abs = join(project.docsDir, f);
    if (!existsSync(abs)) continue;
    const text = readUtf8(abs, f, r);
    for (const h of scanSensitive(text)) r.error(`${f}:${h.line}`, `${h.kind}: ${h.name}`);
  }
  for (const h of scanSensitive(JSON.stringify(project.config, null, 1))) r.error('site.config.json', `${h.kind}: ${h.name}`);

  if (release) {
    const v = versions.find((x) => x.version === release.appVersion);
    if (!v) r.error('release', `the deployed app version ${release.appVersion} has no documentation (run: docs generate)`);
    else if (v.status !== 'final') r.error('release', `documentation for ${release.appVersion} is still a draft (run: docs freeze ${release.appVersion})`);
    // Historical versions are preserved: everything published before must
    // still be there, unchanged.
    for (const old of release.previousManifest?.versions || []) {
      const now = versions.find((x) => x.version === old.version);
      if (!now) r.error('release', `previously published version ${old.version} is missing`);
      else if (old.checksum && now.checksum !== old.checksum) r.error('release', `previously published version ${old.version} has a different checksum`);
    }
  }
  return r;
}

// Validates a built site (the directory that is about to go live).
export function validateDist({ dist, expectVersion, docsDir }) {
  const r = new Report();
  const project = loadProject(docsDir);
  let manifest;
  try { manifest = readJson(join(dist, 'data', 'versions.json')); } catch (e) { r.error('data/versions.json', e.message); return r; }
  if (expectVersion && manifest.currentVersion !== expectVersion) r.error('data/versions.json', `currentVersion is ${manifest.currentVersion}, expected ${expectVersion}`);
  if (!manifest.versions?.some((v) => v.version === manifest.currentVersion && v.latest)) r.error('data/versions.json', 'the current version must be listed and marked latest');
  const pages = project.navigation.pages;
  for (const v of manifest.versions || []) {
    const base = join(dist, 'versions', versionDirName(v.version));
    for (const p of pages.filter((x) => x.required)) {
      for (const ext of ['.md', '.html']) if (!existsSync(join(base, p.file.replace(/\.md$/, ext)))) r.error(`versions/${versionDirName(v.version)}`, `${p.file.replace(/\.md$/, ext)} is missing`);
    }
    for (const f of ['all.md', 'search-index.json', 'docs-index.json']) if (!existsSync(join(base, f))) r.error(`versions/${versionDirName(v.version)}`, `${f} is missing`);
    const all = existsSync(join(base, 'all.md')) ? readFileSync(join(base, 'all.md'), 'utf8') : '';
    const h1s = [...all.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
    if (all && h1s[h1s.length - 1] !== WHATS_NEW_TITLE) r.error(`versions/${versionDirName(v.version)}/all.md`, `"${WHATS_NEW_TITLE}" must be the last section`);
  }
  // /latest/ must be exactly the current version.
  const cur = join(dist, 'versions', versionDirName(manifest.currentVersion));
  for (const f of listFiles(cur).filter((x) => x.endsWith('.md'))) {
    const a = join(dist, 'latest', f);
    if (!existsSync(a) || readFileSync(a, 'utf8') !== readFileSync(join(cur, f), 'utf8')) r.error(`latest/${f}`, `differs from versions/${versionDirName(manifest.currentVersion)}/${f}`);
  }
  for (const f of ['index.html', '404.html', 'changelog/index.html', 'changelog/index.md', 'data/docs-index.json', 'llms.txt', 'sitemap.xml', 'robots.txt', 'assets/css/style.css', 'assets/js/app.js']) {
    if (!existsSync(join(dist, f))) r.error(f, 'missing from the build');
  }
  try {
    const idx = readJson(join(dist, 'data', 'docs-index.json'));
    if (idx.currentVersion !== manifest.currentVersion) r.error('data/docs-index.json', 'currentVersion differs from versions.json');
    for (const s of idx.sections || []) if (!existsSync(join(dist, s.path.replace(/^\//, '')))) r.error('data/docs-index.json', `section path ${s.path} does not exist`);
  } catch (e) { r.error('data/docs-index.json', e.message); }
  // Nothing sensitive in anything that will be served. The site URL in the
  // build is allowed; the scanner patterns don't match it.
  for (const f of listFiles(dist).filter((x) => /\.(html|md|json|txt|xml)$/.test(x))) {
    for (const h of scanSensitive(readFileSync(join(dist, f), 'utf8'))) r.error(`${f}:${h.line}`, `${h.kind}: ${h.name}`);
  }
  return r;
}

export function printReport(r, label) {
  for (const w of r.warnings) console.warn(`  warning  ${w}`);
  for (const e of r.errors) console.error(`  error    ${e}`);
  console.log(`${label}: ${r.ok ? 'OK' : 'FAILED'} (${r.errors.length} errors, ${r.warnings.length} warnings)`);
}


// Freezing a documentation version, and publishing a build atomically.
//
// Publication layout on the server (DOCS_ROOT, outside the game checkout):
//   DOCS_ROOT/releases/v2.3.0-<commit>-<timestamp>/   complete builds
//   DOCS_ROOT/current -> releases/...                 what Nginx serves
//   DOCS_ROOT/state/published.json                    publication record
//   DOCS_ROOT/logs/publish.log                        one line per attempt
// `current` is switched with rename(2) over a symlink, which is atomic: a
// visitor sees either the old or the new build, never a mix. A build that
// fails validation never becomes `current`.
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, resolve } from 'node:path';
import { buildSite } from './build.js';
import { validateDist, validateSource } from './validate.js';
import {
  DocsError, REPO_DIR, checksumDir, isIsoDate, loadProject, parseFrontMatter, readAppVersion, readJson, setFrontMatterField, today, versionDirName, writeJson,
} from './util.js';

// ---- freeze ------------------------------------------------------------------

export function freeze({ docsDir, version, date = null, now = today() }) {
  const project = loadProject(docsDir);
  const { manifest, navigation } = project;
  const k = manifest.versions.findIndex((v) => v.version === version);
  if (k < 0) throw new DocsError(`version ${version} is not in versions.json`);
  const v = manifest.versions[k];
  if (v.status === 'final') throw new DocsError(`version ${version} is already final; published versions are immutable`);
  const dir = join(project.docsDir, 'versions', versionDirName(version));

  // Validate before touching anything: a refused freeze changes no file.
  const check = () => {
    const report = validateSource({ docsDir: project.docsDir, strict: true });
    if (!report.ok) {
      const err = new DocsError(`version ${version} cannot be frozen; fix the validation errors first`);
      err.report = report;
      throw err;
    }
  };
  check();

  if (date) {
    if (!isIsoDate(date)) throw new DocsError(`invalid date ${date}`);
    const wnFile = join(dir, 'whats-new.md');
    let wn = readFileSync(wnFile, 'utf8');
    wn = setFrontMatterField(wn, 'releaseDate', date).replace(/^- \*\*Release date:\*\* .*$/m, `- **Release date:** ${date}`);
    writeFileSync(wnFile, wn);
    v.releaseDate = date;
  }

  // Pages whose text changed since the previous version get today's date as
  // lastUpdated, unless it was already moved forward by hand.
  const prev = manifest.versions[k - 1];
  if (prev) {
    const prevDir = join(project.docsDir, 'versions', versionDirName(prev.version));
    // Comments and whitespace are not content (removing a REVIEW marker leaves a blank line).
    const norm = (body, ver) => body.replace(/<!--[\s\S]*?-->/g, '').replaceAll(ver, '<v>').replace(/\s+/g, ' ').trim();
    for (const p of navigation.pages) {
      const f = join(dir, p.file);
      const pf = join(prevDir, p.file);
      if (!existsSync(f)) continue;
      const cur = parseFrontMatter(readFileSync(f, 'utf8'));
      const old = existsSync(pf) ? parseFrontMatter(readFileSync(pf, 'utf8')) : null;
      const changed = !old || norm(cur.body, version) !== norm(old.body, prev.version);
      if (changed && (!old || cur.data.lastUpdated <= old.data.lastUpdated)) {
        writeFileSync(f, setFrontMatterField(readFileSync(f, 'utf8'), 'lastUpdated', now));
      }
    }
  }
  writeJson(join(project.docsDir, 'versions.json'), manifest);
  check(); // the date updates must not break anything either
  v.checksum = checksumDir(dir);
  v.status = 'final';
  writeJson(join(project.docsDir, 'versions.json'), manifest);

  // The release notes of this version are archived; NEXT.md starts empty.
  const notes = join(project.docsDir, 'release-notes', 'NEXT.md');
  const template = join(project.docsDir, 'release-notes', 'TEMPLATE.md');
  if (existsSync(notes)) {
    mkdirSync(join(project.docsDir, 'release-notes', 'archive'), { recursive: true });
    writeFileSync(join(project.docsDir, 'release-notes', 'archive', `v${version}.md`), readFileSync(notes));
    if (existsSync(template)) writeFileSync(notes, readFileSync(template));
  }
  return { version, checksum: v.checksum };
}

// ---- atomic activation ------------------------------------------------------------

export function currentTarget(docsRoot) {
  const link = join(docsRoot, 'current');
  try {
    if (!lstatSync(link).isSymbolicLink()) throw new DocsError(`${link} exists but is not a symlink; move it away first`);
    return resolve(docsRoot, readlinkSync(link));
  } catch (e) {
    if (e instanceof DocsError) throw e;
    return null;
  }
}

export function activate(docsRoot, releaseDir) {
  const link = join(docsRoot, 'current');
  const tmp = join(docsRoot, `.current-${process.pid}-${Date.now()}`);
  currentTarget(docsRoot); // refuses a non-symlink `current`
  symlinkSync(join('releases', basename(releaseDir)), tmp);
  renameSync(tmp, link);
}

function prune(docsRoot, keep, protect) {
  const dir = join(docsRoot, 'releases');
  const builds = readdirSync(dir)
    .filter((d) => d.startsWith('v') && statSync(join(dir, d)).isDirectory())
    .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  const removed = [];
  builds.forEach((d, i) => {
    if (i >= keep && !protect.includes(join(dir, d))) {
      rmSync(join(dir, d), { recursive: true, force: true });
      removed.push(d);
    }
  });
  return removed;
}

async function httpCheck(url, expect) {
  const base = url.replace(/\/$/, '');
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(`${base}/data/versions.json`, { headers: { 'Cache-Control': 'no-cache' } });
      if (r.ok) {
        const m = await r.json();
        if (m.currentVersion === expect.version && (!expect.generatedAt || m.generatedAt === expect.generatedAt)) return null;
        if (attempt === 5) return `serves version ${m.currentVersion} (generated ${m.generatedAt}), expected ${expect.version} (generated ${expect.generatedAt})`;
      } else if (attempt === 5) return `HTTP ${r.status}`;
    } catch (e) {
      if (attempt === 5) return e.message;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return 'no answer';
}

// Builds, validates and activates the documentation for the deployed app.
// Returns {status: 'published'|'skipped', ...}; throws DocsError on failure,
// leaving the previously published documentation in place.
export async function publish({ docsDir, repo = REPO_DIR, docsRoot, healthUrl = null, keep = 5, log = console.log, now = new Date() }) {
  if (!docsRoot) throw new DocsError('publish needs --docs-root');
  if (!existsSync(docsRoot)) {
    return { status: 'skipped', reason: `${docsRoot} does not exist; documentation publishing is not set up on this server (docs/RELEASE_PROCESS.md, "First deployment")` };
  }
  const project = loadProject(docsDir);
  const appVersion = readAppVersion(repo, project.config);
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '-');
  const logFile = join(docsRoot, 'logs', 'publish.log');
  mkdirSync(join(docsRoot, 'logs'), { recursive: true });
  mkdirSync(join(docsRoot, 'releases'), { recursive: true });
  mkdirSync(join(docsRoot, 'state'), { recursive: true });
  const record = (status, detail) => appendFileSync(logFile, `${now.toISOString()} ${status} version=${appVersion} commit=${commit || '-'} ${detail}\n`);

  const lock = join(docsRoot, '.publish.lock');
  try { mkdirSync(lock); } catch {
    const age = Date.now() - statSync(lock).mtimeMs;
    if (age < 30 * 60 * 1000) throw new DocsError(`another publication is running (${lock}); remove it if that is not true`);
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
  }
  const stage = join(docsRoot, 'releases', `.staging-${stamp}`);
  const previous = currentTarget(docsRoot);
  try {
    log(`Documentation: app version ${appVersion}, commit ${commit || 'unknown'}`);
    const previousManifestFile = previous && join(previous, 'data', 'versions.json');
    const previousManifest = previousManifestFile && existsSync(previousManifestFile) ? readJson(previousManifestFile) : null;

    const src = validateSource({ docsDir: project.docsDir, release: { appVersion, previousManifest } });
    if (!src.ok) throw Object.assign(new DocsError('source validation failed'), { report: src });
    log('Documentation: source validation passed');

    const built = buildSite({ docsDir: project.docsDir, out: stage, release: true, appVersion, commit, now });
    const dist = validateDist({ dist: stage, expectVersion: appVersion, docsDir: project.docsDir });
    if (!dist.ok) throw Object.assign(new DocsError('build validation failed'), { report: dist });
    log(`Documentation: built and validated (versions: ${built.versions.join(', ')})`);

    let finalDir = join(docsRoot, 'releases', `v${appVersion}-${commit || 'nocommit'}-${stamp}`);
    for (let n = 2; existsSync(finalDir); n++) finalDir = join(docsRoot, 'releases', `v${appVersion}-${commit || 'nocommit'}-${stamp}-${n}`);
    renameSync(stage, finalDir);
    activate(docsRoot, finalDir);
    log(`Documentation: activated ${basename(finalDir)}`);

    // Health check: the live directory, then (if configured) the public URL.
    const live = readJson(join(docsRoot, 'current', 'data', 'versions.json'));
    let problem = live.currentVersion === appVersion ? null : `current/ serves ${live.currentVersion}`;
    if (!problem && healthUrl) {
      problem = await httpCheck(healthUrl, { version: appVersion, generatedAt: live.generatedAt });
      if (problem) problem = `${healthUrl}: ${problem}`;
    }
    if (problem) {
      if (previous) activate(docsRoot, previous);
      throw new DocsError(`health check failed (${problem}); ${previous ? `rolled back to ${basename(previous)}` : 'nothing was published before'}`);
    }
    log(`Documentation: health check passed${healthUrl ? ` (${healthUrl})` : ' (filesystem only; set DOCS_HEALTH_URL to check the public URL)'}`);

    const stateFile = join(docsRoot, 'state', 'published.json');
    const state = existsSync(stateFile) ? readJson(stateFile) : { history: [] };
    const entry = { version: appVersion, commit, release: basename(finalDir), publishedAt: now.toISOString() };
    writeJson(stateFile, { current: entry, history: [entry, ...(state.history || [])].slice(0, 50) });
    const removed = prune(docsRoot, keep, [finalDir, previous].filter(Boolean));
    if (removed.length) log(`Documentation: removed old builds ${removed.join(', ')}`);
    record('PUBLISHED', `release=${basename(finalDir)}`);
    return { status: 'published', version: appVersion, release: finalDir };
  } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    record('FAILED', JSON.stringify(e.message));
    throw e;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// Checks a public documentation site from the outside.
export async function verify({ url, expect }) {
  const base = url.replace(/\/$/, '');
  const problems = [];
  const get = async (path) => {
    const r = await fetch(`${base}${path}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r;
  };
  let manifest = null;
  try { manifest = await (await get('/data/versions.json')).json(); } catch (e) { problems.push(e.message); }
  if (manifest && expect && manifest.currentVersion !== expect) problems.push(`currentVersion is ${manifest.currentVersion}, expected ${expect}`);
  for (const path of ['/', '/latest/', '/latest/whats-new.md', '/changelog/', '/data/docs-index.json', '/llms.txt']) {
    try { await get(path); } catch (e) { problems.push(e.message); }
  }
  if (manifest) {
    try {
      const wn = await (await get('/latest/whats-new.md')).text();
      if (!wn.includes(`**Version:** ${manifest.currentVersion}`)) problems.push('/latest/whats-new.md does not describe the current version');
    } catch { /* reported above */ }
  }
  return { ok: problems.length === 0, problems, currentVersion: manifest?.currentVersion ?? null };
}


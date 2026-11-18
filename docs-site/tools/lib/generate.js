// Documentation generator for a new release.
//
// It does the mechanical, verifiable part and refuses to guess the rest:
//   1. reads the new app version (backend/package.json) and the previous
//      documented version (versions.json);
//   2. finds the commit of the previous release and collects the evidence of
//      what changed since: commits, changed files, migrations, scoring
//      constants, API routes, question counts, the developer changelog entry;
//   3. creates versions/vNEW/ as a copy of the previous version, with the
//      version metadata updated, and a What's New page built from the
//      developer's release notes (release-notes/NEXT.md);
//   4. inserts a REVIEW marker into every page the evidence says may be
//      affected, and writes the evidence report reviews/vNEW.md.
// Validation blocks publication while any REVIEW marker remains, so nothing
// is published that a person (or an AI coding agent working from the
// evidence) hasn't checked against the code.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DocsError, REPO_DIR, compareSemver, isIsoDate, loadProject, readAppVersion, setFrontMatterField, today, versionDirName, writeJson, writeText,
} from './util.js';

// Which source areas can affect which documentation pages. `pages: []`
// means "no player-facing documentation impact" (listed in the report only).
export const IMPACT_RULES = [
  { re: /^docs-site\//, area: null },
  { re: /^tools\/telegram-template\.html$/, area: 'Mini App interface', pages: ['game-features', 'game-rules', 'faq'] },
  { re: /^index\.html$/, area: 'Mini App build (generated from the template)', pages: [] },
  { re: /^backend\/src\/engine\/(scoring|evaluate)\.js$/, area: 'Scoring and answer validation', pages: ['scoring-system', 'game-rules', 'faq'] },
  { re: /^backend\/src\/engine\//, area: 'Question engine', pages: ['levels-guide', 'game-rules'] },
  { re: /^backend\/src\/services\/(progression|levels)\.js$/, area: 'Progression and unlocking', pages: ['levels-guide', 'scoring-system', 'user-statistics', 'faq'] },
  { re: /^backend\/src\/services\/stats\.js$/, area: 'Player statistics', pages: ['user-statistics'] },
  { re: /^backend\/src\/services\/sessions\.js$/, area: 'Game sessions', pages: ['game-rules', 'scoring-system'] },
  { re: /^backend\/src\/(auth\/|services\/players\.js)/, area: 'Sign-in and player data', pages: ['privacy-and-security', 'game-features', 'faq'] },
  { re: /^backend\/src\/services\/internal\.js$/, area: 'Internal API (automation, AI drafts)', pages: ['privacy-and-security'] },
  { re: /^backend\/src\/app\.js$/, area: 'API routes', pages: ['game-features', 'privacy-and-security'] },
  { re: /^backend\/src\/(config\.js|server\.js|db\.js)$|^backend\/\.env\.example$/, area: 'Server configuration', pages: ['privacy-and-security'] },
  { re: /^backend\/prisma\/migrations\//, area: 'Database migration', pages: ['user-statistics', 'privacy-and-security', 'levels-guide', 'scoring-system'] },
  { re: /^backend\/prisma\/schema\.prisma$/, area: 'Database schema', pages: ['user-statistics', 'privacy-and-security'] },
  { re: /^backend\/content\/questions\//, area: 'Question content', pages: ['levels-guide'] },
  { re: /^backend\/content\//, area: 'Geographic knowledge base', pages: ['levels-guide'] },
  { re: /^backend\/src\/content\//, area: 'Content pipeline', pages: [] },
  { re: /^layers\//, area: 'Map layers', pages: ['game-features'] },
  { re: /^web\//, area: 'Web Game', pages: ['game-features'] },
  { re: /^tools\//, area: 'Build tools', pages: [] },
  { re: /^backend\/test\//, area: 'Tests', pages: [] },
  { re: /^(docs\/|CLAUDE\.md$|README\.md$|backend\/README\.md$|backend\/docs\/)/, area: 'Developer documentation', pages: [] },
  { re: /^(\.github\/|backend\/scripts\/|backend\/deployment\/|backend\/prisma\/checks\/|\.gitignore$)/, area: 'Tooling and deployment', pages: [] },
  { re: /^backend\/(package\.json|package-lock\.json|prisma\.config\.js)$/, area: 'Dependencies and version', pages: [] },
];

export function classify(file) {
  const rule = IMPACT_RULES.find((r) => r.re.test(file));
  if (!rule) return { area: 'Unclassified', pages: null };
  return { area: rule.area, pages: rule.pages ?? [] };
}

function git(repo, args, opts = {}) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (opts.allowFail) return null;
    throw new DocsError(`git ${args.join(' ')} failed: ${(e.stderr || e.message).trim()}`);
  }
}

const showFile = (repo, ref, path) => git(repo, ['show', `${ref}:${path}`], { allowFail: true });

// The newest commit in which the app version file holds `version`: the
// deployed state of that release.
export function findReleaseCommit(repo, versionFile, version) {
  const log = git(repo, ['log', '--format=%H', '--', versionFile]).trim().split('\n').filter(Boolean);
  for (const sha of log) {
    // A commit that changed the file may have changed it *away* from the
    // version; the version held after that commit is what counts.
    const text = showFile(repo, sha, versionFile);
    try {
      if (text && JSON.parse(text).version === version) {
        // The release state is the last commit before the next version
        // bump (later commits may touch the file without changing the
        // version, e.g. a dependency update).
        const newer = git(repo, ['log', '--reverse', '--format=%H', `${sha}..HEAD`, '--', versionFile]).trim().split('\n').filter(Boolean);
        const bump = newer.find((c) => { try { return JSON.parse(showFile(repo, c, versionFile)).version !== version; } catch { return true; } });
        return git(repo, ['rev-parse', bump ? `${bump}^` : 'HEAD']).trim();
      }
    } catch { /* not JSON at that commit */ }
  }
  return null;
}

// ---- detectors: facts that can be compared mechanically ------------------

function extractBlock(text, startRe) {
  if (!text) return null;
  const m = startRe.exec(text);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(m.index, i + 1).replace(/\s+/g, ' ');
  }
  return null;
}

const DETECTORS = [
  {
    name: 'Scoring rules (DEFAULT_SCORING, SCORING_VERSION)',
    file: 'backend/src/engine/scoring.js',
    pages: ['scoring-system'],
    read: (t) => t && [extractBlock(t, /DEFAULT_SCORING = Object\.freeze\(\{/), (/SCORING_VERSION = (\d+)/.exec(t) || [])[1]].join(' | version '),
  },
  {
    name: 'Level 1 points in the Mini App (L1_POINTS)',
    file: 'tools/telegram-template.html',
    pages: ['scoring-system', 'levels-guide'],
    read: (t) => t && ((/const L1_POINTS=\{.*?\}\};/.exec(t) || [])[0] || null),
  },
  {
    name: 'Rounds per game (ROUNDS)',
    file: 'tools/telegram-template.html',
    pages: ['game-rules', 'levels-guide'],
    read: (t) => t && ((/const ROUNDS = (\d+)/.exec(t) || [])[1] || null),
  },
  {
    name: 'API routes',
    file: 'backend/src/app.js',
    pages: ['game-features', 'privacy-and-security'],
    read: (t) => t && [...t.matchAll(/api\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`).sort().join(', '),
  },
  {
    name: 'Telegram profile fields stored at sign-in',
    file: 'backend/src/services/players.js',
    pages: ['privacy-and-security'],
    read: (t) => t && ((extractBlock(t, /const providerData = compact\(\{/) || '').match(/\b\w+(?=:)/g) || []).join(', '),
  },
];

function questionCounts(repo, ref) {
  const dir = 'backend/content/questions';
  const files = ref
    ? (git(repo, ['ls-tree', '--name-only', `${ref}:${dir}`], { allowFail: true }) || '').trim().split('\n').filter(Boolean)
    : (existsSync(join(repo, dir)) ? readdirSync(join(repo, dir)) : []);
  const counts = {};
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const text = ref ? showFile(repo, ref, `${dir}/${f}`) : readFileSync(join(repo, dir, f), 'utf8');
    try {
      const j = JSON.parse(text);
      const qs = Array.isArray(j) ? j : j.questions || [];
      const level = j.level || f.replace(/^level-\d+-|(-\d+)?\.json$/g, '');
      counts[level] = (counts[level] || 0) + qs.length;
    } catch { /* invalid content is reported by content:check */ }
  }
  return counts;
}

function migrationSummary(sql) {
  const out = [];
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?/gi)) out.push(`new table ${m[1]}`);
  for (const m of sql.matchAll(/ALTER TABLE "?(\w+)"?\s+ADD COLUMN (?:IF NOT EXISTS )?"?(\w+)"?/gi)) out.push(`new column ${m[1]}.${m[2]}`);
  for (const m of sql.matchAll(/UPDATE "?(\w+)"?\s+(?:\w+\s+)?SET/gi)) out.push(`updates rows of ${m[1]}`);
  for (const m of sql.matchAll(/CREATE (?:OR REPLACE )?TRIGGER "?(\w+)"?/gi)) out.push(`trigger ${m[1]}`);
  return [...new Set(out)];
}

function changelogEntry(text, version) {
  if (!text) return null;
  const re = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|$(?![\\s\\S]))`, 'm');
  const m = re.exec(text);
  return m ? m[0].trim() : null;
}

// ---- release notes -----------------------------------------------------------

// Parses release-notes/NEXT.md: "## <Category>" sections with "- " items.
// Lines inside HTML comments (the template's instructions) are ignored.
export function parseReleaseNotes(text, categories) {
  const notes = Object.fromEntries([...categories, 'Known Issues', 'Notes for Documentation'].map((c) => [c, []]));
  let cur = null;
  for (const line of (text || '').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = Object.keys(notes).find((k) => k.toLowerCase() === h[1].toLowerCase()) || null; continue; }
    if (cur && /^\s*[-*]\s+\S/.test(line)) notes[cur].push(line.replace(/^(\s*)\*\s+/, '$1- '));
    else if (cur && line.trim() && notes[cur].length && /^\s{2,}\S/.test(line)) notes[cur][notes[cur].length - 1] += ` ${line.trim()}`;
  }
  return notes;
}

function whatsNewPage(version, date, notes, categories, evidence) {
  const lines = ['---', "title: What's New in This Version", `description: Changes in GeoAIGames version ${version}.`, `version: ${version}`, `lastUpdated: ${date}`, `releaseDate: ${date}`, '---', "# What's New in This Version", '', `- **Version:** ${version}`, `- **Release date:** ${date}`, ''];
  lines.push(`<!-- REVIEW (generated for ${version}): write a one-paragraph summary of the release for players here, check every item below against the code and the evidence report (docs-site/reviews/v${version}.md), set the release date to the actual deployment date, then delete this marker. -->`, '');
  for (const c of categories) {
    lines.push(`## ${c}`, '');
    if (notes[c].length) lines.push(...notes[c]);
    else {
      lines.push(`<!-- REVIEW: release-notes/NEXT.md has nothing under "${c}". Confirm "None." against the evidence, or add the changes. Then delete this marker. -->`);
      lines.push(c === 'Breaking Changes' || c === 'Bug Fixes' ? '- None.' : '- No changes in this release.');
    }
    lines.push('');
  }
  if (notes['Known Issues'].length) lines.push('## Known Issues', '', ...notes['Known Issues'], '');
  if (evidence.suggestions.length) {
    lines.push(`<!-- REVIEW: changes detected in the code that may belong in this page:\n${evidence.suggestions.map((s) => `  - ${s}`).join('\n')}\n-->`, '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ---- main ----------------------------------------------------------------------

export function collectEvidence({ repo, baseRef, appVersion, prevVersion, versionFile }) {
  const head = git(repo, ['rev-parse', '--short', 'HEAD']).trim();
  const commits = git(repo, ['log', '--format=%h %ad %s', '--date=short', `${baseRef}..HEAD`]).trim().split('\n').filter(Boolean);
  // Working tree against the base: committed and uncommitted changes.
  const changed = git(repo, ['diff', '--name-status', '--find-renames', baseRef]).trim().split('\n').filter(Boolean).map((l) => {
    const [status, ...paths] = l.split('\t');
    return { status: status[0], file: paths[paths.length - 1] };
  });
  for (const f of git(repo, ['ls-files', '--others', '--exclude-standard']).trim().split('\n').filter(Boolean)) changed.push({ status: '?', file: f });

  const areas = new Map();
  const pageReasons = new Map();
  const addReason = (page, reason) => { if (!pageReasons.has(page)) pageReasons.set(page, []); pageReasons.get(page).push(reason); };
  for (const c of changed) {
    const { area, pages } = classify(c.file);
    if (!area) continue;
    if (!areas.has(area)) areas.set(area, { files: [], pages: pages || [] });
    areas.get(area).files.push(`${c.status} ${c.file}`);
    if (pages === null) addReason('index', `unclassified file changed: ${c.file} (decide which pages it affects)`);
    for (const p of pages || []) addReason(p, `${area}: ${c.file}`);
  }

  const facts = [];
  const suggestions = [];
  for (const d of DETECTORS) {
    const before = d.read(showFile(repo, baseRef, d.file));
    const after = d.read(existsSync(join(repo, d.file)) ? readFileSync(join(repo, d.file), 'utf8') : null);
    if (before !== after) {
      facts.push({ name: d.name, before, after });
      for (const p of d.pages) addReason(p, `${d.name} changed`);
      suggestions.push(`${d.name} changed`);
    }
  }
  const qBefore = questionCounts(repo, baseRef);
  const qAfter = questionCounts(repo, null);
  for (const level of new Set([...Object.keys(qBefore), ...Object.keys(qAfter)])) {
    if ((qBefore[level] || 0) !== (qAfter[level] || 0)) {
      const text = `Questions in level "${level}": ${qBefore[level] || 0} → ${qAfter[level] || 0}`;
      facts.push({ name: text, before: qBefore[level] || 0, after: qAfter[level] || 0 });
      addReason('levels-guide', text);
      suggestions.push(text);
    }
  }
  const migrations = changed
    .filter((c) => /^backend\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(c.file) && c.status !== 'D')
    .map((c) => ({ name: c.file.split('/')[3], summary: migrationSummary(readFileSync(join(repo, c.file), 'utf8')) }));
  for (const m of migrations) suggestions.push(`Database migration ${m.name}: ${m.summary.join('; ') || 'see SQL'}`);

  const devChangelog = changelogEntry(existsSync(join(repo, 'docs/CHANGELOG.md')) ? readFileSync(join(repo, 'docs/CHANGELOG.md'), 'utf8') : null, appVersion);
  return { head, baseRef, prevVersion, appVersion, versionFile, commits, changed, areas, pageReasons, facts, suggestions, migrations, devChangelog };
}

function reportMarkdown(ev, notes, date) {
  const out = [`# Documentation evidence report: ${ev.prevVersion} → ${ev.appVersion}`, '',
    `Generated ${date} from commit ${ev.head} (base: ${ev.baseRef.slice(0, 7)}, the last commit of ${ev.prevVersion}). This report is for developers and is not published.`, '',
    'Use the code changes below as the primary evidence. Commit messages and notes are supplementary. Anything that cannot be verified must not be documented.', '',
    '## Pages to review', ''];
  if (!ev.pageReasons.size) out.push('No page is affected by the detected changes.', '');
  for (const [page, reasons] of [...ev.pageReasons].sort()) {
    out.push(`### ${page}.md`, '', ...[...new Set(reasons)].map((r) => `- [ ] ${r}`), '');
  }
  out.push('## Detected fact changes', '');
  if (!ev.facts.length) out.push('None.', '');
  for (const f of ev.facts) out.push(`- **${f.name}**`, `  - before: \`${String(f.before).slice(0, 400)}\``, `  - after: \`${String(f.after).slice(0, 400)}\``);
  out.push('', '## Database migrations', '');
  if (!ev.migrations.length) out.push('None.');
  for (const m of ev.migrations) out.push(`- ${m.name}: ${m.summary.join('; ') || 'no DDL detected; read the SQL'}`);
  out.push('', '## Changed files by area', '');
  for (const [area, a] of ev.areas) out.push(`### ${area}${a.pages.length ? ` → ${a.pages.join(', ')}` : ' (no player-facing page)'}`, '', ...a.files.map((f) => `- \`${f}\``), '');
  out.push('## Commits', '', ...(ev.commits.length ? ev.commits.map((c) => `- ${c}`) : ['None (uncommitted changes only).']), '');
  out.push('## Developer release notes (release-notes/NEXT.md)', '');
  for (const [k, items] of Object.entries(notes)) if (items.length) out.push(`### ${k}`, '', ...items, '');
  out.push('## Developer changelog entry (docs/CHANGELOG.md)', '', ev.devChangelog ? ev.devChangelog.replace(/^#/gm, '###') : `No entry for ${ev.appVersion} yet.`, '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function generate({ docsDir, repo = REPO_DIR, version, date = today(), since = null, dryRun = false } = {}) {
  const project = loadProject(docsDir);
  const { config, manifest, navigation } = project;
  const appVersion = version || readAppVersion(repo, config);
  if (!isIsoDate(date)) throw new DocsError(`invalid date ${date}`);
  const versions = manifest.versions;
  const prev = versions[versions.length - 1];
  if (!prev) throw new DocsError('versions.json has no previous version to start from');
  const existing = versions.find((v) => v.version === appVersion);
  if (existing?.status === 'final') {
    throw new DocsError(`app version ${appVersion} is already documented and final; it is not newer than the last documented version. Bump ${config.appVersionFile} first (docs/VERSIONING.md).`);
  }
  if (existing) {
    throw new DocsError(`draft documentation for ${appVersion} already exists (versions/${versionDirName(appVersion)}). Edit it directly; use "docs evidence" to refresh the report.`);
  }
  if (compareSemver(appVersion, prev.version) <= 0) {
    throw new DocsError(`app version ${appVersion} is not newer than the last documented version ${prev.version}. Bump ${config.appVersionFile} first (docs/VERSIONING.md).`);
  }
  const baseRef = since || findReleaseCommit(repo, config.appVersionFile, prev.version);
  if (!baseRef) throw new DocsError(`no commit has ${config.appVersionFile} at version ${prev.version}; pass --since <git ref of the previous release>`);

  const ev = collectEvidence({ repo, baseRef, appVersion, prevVersion: prev.version, versionFile: config.appVersionFile });
  const notesFile = join(project.docsDir, 'release-notes', 'NEXT.md');
  const notes = parseReleaseNotes(existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '', config.whatsNewCategories);
  for (const n of notes['Notes for Documentation']) ev.suggestions.push(`Developer note: ${n.replace(/^- /, '')}`);
  const report = reportMarkdown(ev, notes, date);
  if (dryRun) return { appVersion, prevVersion: prev.version, baseRef, report, evidence: ev };

  const src = join(project.docsDir, 'versions', versionDirName(prev.version));
  const dst = join(project.docsDir, 'versions', versionDirName(appVersion));
  mkdirSync(dst, { recursive: true });
  for (const p of navigation.pages) {
    if (p.id === 'whats-new' || !existsSync(join(src, p.file))) continue;
    let text = readFileSync(join(src, p.file), 'utf8');
    text = setFrontMatterField(text, 'version', appVersion);
    // Version numbers in prose ("in version 2.3.0") describe the version
    // the page documents; they move with it. "since version X" stays.
    text = text.replace(new RegExp(`(?<!since )version ${prev.version.replace(/\./g, '\\.')}\\b`, 'g'), `version ${appVersion}`);
    text = text.replace(new RegExp(`/versions/v${prev.version.replace(/\./g, '\\.')}/`, 'g'), `/versions/v${appVersion}/`);
    const reasons = ev.pageReasons.get(p.id);
    if (reasons) {
      const marker = `<!-- REVIEW (generated for ${appVersion}): the code changed in ways that may affect this page. Check it against the code, update it (and lastUpdated), then delete this marker.\n${[...new Set(reasons)].map((r) => `  - ${r}`).join('\n')}\n-->`;
      text = text.replace(/^(# .*\n)/m, `$1\n${marker}\n`);
    }
    writeFileSync(join(dst, p.file), text);
  }
  writeFileSync(join(dst, 'whats-new.md'), whatsNewPage(appVersion, date, notes, config.whatsNewCategories, ev));
  if (existsSync(join(src, 'index.md'))) {
    // The introduction describes the initial release only in the first version.
    const idx = readFileSync(join(dst, 'index.md'), 'utf8');
    if (/initial documentation release/i.test(idx)) {
      writeFileSync(join(dst, 'index.md'), idx.replace(/^(# .*\n)/m, `$1\n<!-- REVIEW (generated for ${appVersion}): this page still describes the initial documentation release. Rewrite that paragraph for ${appVersion}, then delete this marker. -->\n`));
    }
  }
  writeText(join(project.docsDir, 'reviews', `v${appVersion}.md`), report);
  manifest.versions.push({ version: appVersion, releaseDate: date, status: 'draft' });
  writeJson(join(project.docsDir, 'versions.json'), manifest);
  return { appVersion, prevVersion: prev.version, baseRef, report, evidence: ev, dir: dst };
}

// Re-creates only the evidence report of an existing draft (after more
// commits). Never touches the pages.
export function refreshEvidence({ docsDir, repo = REPO_DIR, version, since = null, date = today() } = {}) {
  const project = loadProject(docsDir);
  const appVersion = version || readAppVersion(repo, project.config);
  const idx = project.manifest.versions.findIndex((v) => v.version === appVersion);
  if (idx < 1) throw new DocsError(`no draft documentation for ${appVersion} with a previous version`);
  const prev = project.manifest.versions[idx - 1];
  const baseRef = since || findReleaseCommit(repo, project.config.appVersionFile, prev.version);
  if (!baseRef) throw new DocsError(`no commit has version ${prev.version}; pass --since`);
  const ev = collectEvidence({ repo, baseRef, appVersion, prevVersion: prev.version, versionFile: project.config.appVersionFile });
  const notesFile = join(project.docsDir, 'release-notes', 'NEXT.md');
  const notes = parseReleaseNotes(existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '', project.config.whatsNewCategories);
  const report = reportMarkdown(ev, notes, date);
  writeText(join(project.docsDir, 'reviews', `v${appVersion}.md`), report);
  return { report };
}


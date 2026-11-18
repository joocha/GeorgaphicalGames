// Shared helpers for the documentation tools. No dependencies: the tools
// run on the production server with only Node.js available.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// docs-site/ (the documentation source root) and the repository root.
export const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_DIR = join(DOCS_DIR, '..');

export class DocsError extends Error {}

// ---- semantic versions -------------------------------------------------

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isSemver(v) {
  return typeof v === 'string' && SEMVER.test(v);
}

export function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const versionDirName = (v) => `v${v}`;

// ---- files ---------------------------------------------------------------

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new DocsError(`${file}: ${e.code === 'ENOENT' ? 'file not found' : `invalid JSON (${e.message})`}`);
  }
}

export function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

// All files below `dir`, as sorted paths relative to `dir` with "/" separators.
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

// Content checksum of a version directory: file names and bytes, in order.
// Recorded in versions.json when a version is frozen; any later edit of a
// published version changes it, and validation fails.
export function checksumDir(dir) {
  const h = createHash('sha256');
  for (const f of listFiles(dir)) {
    h.update(`${f}\0`);
    h.update(readFileSync(join(dir, f)));
    h.update('\0');
  }
  return `sha256-${h.digest('hex')}`;
}

// ---- front matter ----------------------------------------------------------

// Minimal "key: value" front matter between two "---" lines at the top.
export function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: null, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: text.slice(m[0].length) };
}

export function setFrontMatterField(text, key, value) {
  const { data, body } = parseFrontMatter(text);
  if (!data) throw new DocsError('no front matter');
  data[key] = value;
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// ---- project configuration -------------------------------------------------

export function loadProject(docsDir = DOCS_DIR) {
  const config = readJson(join(docsDir, 'site.config.json'));
  const navigation = readJson(join(docsDir, 'navigation.json'));
  const manifest = readJson(join(docsDir, 'versions.json'));
  return { docsDir, config, navigation, manifest };
}

export function readAppVersion(repoDir, config) {
  const pkg = readJson(join(repoDir, config.appVersionFile || 'backend/package.json'));
  if (!isSemver(pkg.version)) throw new DocsError(`app version "${pkg.version}" is not MAJOR.MINOR.PATCH`);
  return pkg.version;
}

export const today = () => new Date().toISOString().slice(0, 10);

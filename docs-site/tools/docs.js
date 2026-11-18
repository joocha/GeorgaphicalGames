#!/usr/bin/env node
// GeoAIGames documentation CLI. Usage: node docs-site/tools/docs.js <command>
// Run without arguments for help. Process: docs/RELEASE_PROCESS.md.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { buildSite } from './lib/build.js';
import { generate, refreshEvidence } from './lib/generate.js';
import { freeze, publish, verify } from './lib/release.js';
import { printReport, validateDist, validateSource } from './lib/validate.js';
import { DOCS_DIR, DocsError, REPO_DIR, loadProject, readAppVersion } from './lib/util.js';

const HELP = `GeoAIGames documentation tools

  validate [--strict] [--release]       validate the Markdown sources
                                        --release: as a deploy would, for the app version
  build [--out DIR] [--release]         build the static site (default out: docs-site/dist)
        [--app-version X] [--commit SHA]
  validate-dist DIR [--expect X]        validate a built site
  generate [--version X] [--date D]     start the documentation of a new release
           [--since REF] [--dry-run]    (evidence report + draft version)
  evidence [--version X] [--since REF]  refresh the evidence report of a draft
  freeze VERSION [--date D]             finalize a version (checksum; immutable from now on)
  publish --docs-root DIR               build, validate and atomically activate (server)
          [--health-url URL] [--keep N]
  verify --url URL [--expect X]         check a public documentation site
  preview [--port 4000] [--dir DIR]     serve a built site locally
`;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function serve(dir, port) {
  const types = { '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
  createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    // Same lookup order as the Nginx configuration: $uri $uri.html $uri/index.html.
    const candidates = [join(dir, path), join(dir, `${path}.html`), join(dir, path, 'index.html')];
    const file = candidates.find((f) => existsSync(f) && statSync(f).isFile());
    if (!file) { res.writeHead(404, { 'Content-Type': types['.html'] }); res.end(existsSync(join(dir, '404.html')) ? readFileSync(join(dir, '404.html')) : 'Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  }).listen(port, '127.0.0.1', () => console.log(`Serving ${dir} at http://127.0.0.1:${port}/`));
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const docsDir = a['docs-dir'] || DOCS_DIR;
  const repo = a.repo || REPO_DIR;
  switch (cmd) {
    case 'validate': {
      const release = a.release ? { appVersion: readAppVersion(repo, loadProject(docsDir).config) } : null;
      const r = validateSource({ docsDir, strict: Boolean(a.strict), release });
      printReport(r, 'Documentation sources');
      return r.ok ? 0 : 1;
    }
    case 'build': {
      const out = a.out || join(docsDir, 'dist');
      const appVersion = a['app-version'] || (a.release ? readAppVersion(repo, loadProject(docsDir).config) : null);
      const res = buildSite({ docsDir, out, release: Boolean(a.release), appVersion, commit: a.commit || null });
      console.log(`Built ${out}: current ${res.current}; versions ${res.versions.join(', ')}`);
      return 0;
    }
    case 'validate-dist': {
      const r = validateDist({ dist: a._[1] || join(docsDir, 'dist'), expectVersion: a.expect || null, docsDir });
      printReport(r, 'Documentation build');
      return r.ok ? 0 : 1;
    }
    case 'generate': {
      const res = generate({ docsDir, repo, version: a.version, date: a.date, since: a.since, dryRun: Boolean(a['dry-run']) });
      if (a['dry-run']) { console.log(res.report); return 0; }
      console.log(`Created draft documentation for ${res.appVersion} (from ${res.prevVersion}, base ${res.baseRef.slice(0, 7)}).`);
      console.log(`Evidence report: docs-site/reviews/v${res.appVersion}.md`);
      console.log(`Pages to review: ${[...res.evidence.pageReasons.keys()].join(', ') || 'none'} (+ whats-new)`);
      console.log('Next: update the pages, delete the REVIEW markers, run "validate --strict", then "freeze".');
      return 0;
    }
    case 'evidence': {
      refreshEvidence({ docsDir, repo, version: a.version, since: a.since });
      console.log('Evidence report updated.');
      return 0;
    }
    case 'freeze': {
      if (!a._[1]) throw new DocsError('usage: freeze VERSION [--date YYYY-MM-DD]');
      try {
        const res = freeze({ docsDir, version: a._[1], date: a.date || null });
        console.log(`Version ${res.version} is final (${res.checksum}). Commit docs-site/ with the release.`);
        return 0;
      } catch (e) {
        if (e.report) printReport(e.report, 'Documentation sources');
        throw e;
      }
    }
    case 'publish': {
      try {
        const res = await publish({ docsDir, repo, docsRoot: a['docs-root'], healthUrl: a['health-url'] || null, keep: Number(a.keep || 5) });
        if (res.status === 'skipped') console.log(`NOTE: documentation not published: ${res.reason}`);
        else console.log(`Documentation ${res.version} published.`);
        return 0;
      } catch (e) {
        if (e.report) printReport(e.report, 'Documentation');
        throw e;
      }
    }
    case 'verify': {
      if (!a.url) throw new DocsError('usage: verify --url URL [--expect X]');
      const r = await verify({ url: a.url, expect: a.expect || null });
      for (const p of r.problems) console.error(`  error    ${p}`);
      console.log(`${a.url}: ${r.ok ? 'OK' : 'FAILED'} (current version ${r.currentVersion ?? 'unknown'})`);
      return r.ok ? 0 : 1;
    }
    case 'preview':
      serve(a.dir || join(docsDir, 'dist'), Number(a.port || 4000));
      return null;
    default:
      console.log(HELP);
      return cmd ? 1 : 0;
  }
}

main().then((code) => { if (code !== null) process.exitCode = code; }, (e) => {
  console.error(`ERROR: ${e.message}`);
  if (!(e instanceof DocsError)) console.error(e.stack);
  process.exitCode = 1;
});

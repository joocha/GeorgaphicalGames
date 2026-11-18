// Builds the static documentation website from the Markdown sources.
//
// Output (docs/AI_KNOWLEDGE_BASE.md describes the public URLs):
//   index.html, 404.html, robots.txt, sitemap.xml, llms.txt
//   assets/                       CSS, JS, images
//   data/versions.json            public version manifest
//   data/docs-index.json          machine-readable index of the current version
//   versions/vX.Y.Z/<page>.html   rendered page, and <page>.md raw Markdown
//   versions/vX.Y.Z/all.md        every section in order, What's New last
//   versions/vX.Y.Z/search-index.json, docs-index.json
//   latest/                       copy of the current version
//   changelog/index.html|md       all published What's New sections + history
//
// Release builds (deploys) contain only final versions up to the deployed
// app version; drafts never reach the public site.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, inlineText, renderMarkdown } from './markdown.js';
import {
  DocsError, compareSemver, isSemver, loadProject, parseFrontMatter, versionDirName, writeJson, writeText,
} from './util.js';

const ICON = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16h26M16 3c4 4 5.5 8.5 5.5 13S20 25 16 29M16 3c-4 4-5.5 8.5-5.5 13S12 25 16 29" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M22.5 6.5l-4 8.5-8.5 4 4-8.5z" fill="var(--accent2)" stroke="none"/></svg>`;

// Chooses the versions that go into a build.
export function selectVersions(manifest, { release, appVersion }) {
  const all = manifest.versions.filter((v) => isSemver(v.version));
  if (!release) {
    if (!all.length) throw new DocsError('versions.json lists no versions');
    const current = (appVersion && all.find((v) => v.version === appVersion)) || all[all.length - 1];
    return { versions: all, current };
  }
  if (!appVersion) throw new DocsError('a release build needs the deployed app version');
  const current = all.find((v) => v.version === appVersion);
  if (!current) throw new DocsError(`no documentation for app version ${appVersion}; the previous documentation stays published`);
  if (current.status !== 'final') throw new DocsError(`documentation for ${appVersion} is a draft (run: docs freeze ${appVersion}); the previous documentation stays published`);
  const versions = all.filter((v) => v.status === 'final' && compareSemver(v.version, appVersion) <= 0);
  return { versions, current };
}

function loadPages(project, version) {
  const dir = join(project.docsDir, 'versions', versionDirName(version));
  return project.navigation.pages
    .filter((p) => existsSync(join(dir, p.file)))
    .map((p) => {
      const raw = readFileSync(join(dir, p.file), 'utf8');
      const { data, body } = parseFrontMatter(raw);
      return { ...p, raw, meta: data || {}, body, slug: p.file.replace(/\.md$/, '') };
    });
}

// Plain-text sections for the client-side search.
function searchSections(body) {
  const out = [];
  let cur = null;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const { headings } = renderMarkdown(line);
      cur = { heading: inlineText(h[2]), anchor: headings[0].id, text: '' };
      out.push(cur);
    } else if (cur && line.trim() && !/^\|?\s*:?-{2,}/.test(line)) {
      cur.text += ` ${inlineText(line.replace(/[|>#`]/g, ' ').replace(/^\s*[-*]\s+/, ''))}`;
    }
  }
  return out.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim().slice(0, 1200) }));
}

function layout({ project, title, description, rel, canonical, versionLabel, versions, current, pageSlug, versionRoot, nav, breadcrumb, content, meta, banner, mdHref, prevNext, searchIndex }) {
  const { config } = project;
  const options = versions
    .slice()
    .reverse()
    .map((v) => `<option value="${rel}versions/${versionDirName(v.version)}/"${v.version === versionLabel ? ' selected' : ''}>${v.version}${v.version === current.version ? ' (latest)' : ''}${v.status === 'draft' ? ' (draft)' : ''}</option>`)
    .join('');
  return `<!doctype html>
<html lang="${config.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(config.siteName)}</title>
<meta name="description" content="${escapeHtml(description || '')}">
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
${mdHref ? `<link rel="alternate" type="text/markdown" href="${mdHref}">` : ''}
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description || '')}">
<meta name="docs-version" content="${escapeHtml(versionLabel || current.version)}">
<link rel="stylesheet" href="${rel}assets/css/style.css">
<link rel="icon" href="${rel}assets/images/favicon.svg" type="image/svg+xml">
</head>
<body data-root="${rel}" data-version-root="${versionRoot || ''}" data-page="${pageSlug || ''}" data-search="${searchIndex}">
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
  <button class="menu-btn" id="menuBtn" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar"><span></span><span></span><span></span></button>
  <a class="brand" href="${rel}index.html">${ICON}<span>${escapeHtml(config.product)}<small>Docs</small></span></a>
  <div class="search" role="search">
    <input id="searchInput" type="search" placeholder="Search the docs" aria-label="Search the documentation" autocomplete="off">
    <kbd>/</kbd>
    <div class="search-results" id="searchResults" role="listbox" hidden></div>
  </div>
  <label class="version-select"><span>Version</span><select id="versionSelect" aria-label="Documentation version">${options}</select></label>
  <a class="play" href="${escapeHtml(config.playUrl)}" rel="noopener">Play</a>
</header>
<div class="layout">
<nav class="sidebar" id="sidebar" aria-label="Documentation">${nav}</nav>
<div class="scrim" id="scrim" hidden></div>
<main id="content">
${banner || ''}
<nav class="breadcrumb" aria-label="Breadcrumb">${breadcrumb}</nav>
<article class="doc">${content}</article>
${prevNext || ''}
<footer class="meta">${meta}</footer>
</main>
</div>
<footer class="site-footer">
  <span>${escapeHtml(config.product)} official documentation</span>
  <span><a href="${rel}data/versions.json">versions.json</a> · <a href="${rel}data/docs-index.json">docs-index.json</a> · <a href="${rel}llms.txt">llms.txt</a> · <a href="${rel}changelog/index.html">Changelog</a></span>
</footer>
<script src="${rel}assets/js/app.js" defer></script>
</body>
</html>
`;
}

function sidebar(pages, activeSlug, prefix, rel, activeChangelog) {
  const items = pages
    .map((p) => `<li><a href="${prefix}${p.slug}.html"${p.slug === activeSlug ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a></li>`)
    .join('');
  return `<p class="nav-title">Documentation</p><ul>${items}</ul>
<p class="nav-title">Project</p><ul>
<li><a href="${rel}changelog/index.html"${activeChangelog ? ' aria-current="page"' : ''}>Changelog</a></li>
<li><a href="${rel}data/docs-index.json">AI documentation index</a></li>
</ul>`;
}

function tocHtml(headings) {
  const h2 = headings.filter((h) => h.level === 2);
  if (h2.length < 3) return '';
  return `<details class="toc" open><summary>On this page</summary><ul>${h2.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></details>`;
}

export function buildSite({ docsDir, out, release = false, appVersion = null, commit = null, now = new Date() } = {}) {
  const project = loadProject(docsDir);
  const { config } = project;
  const { versions, current } = selectVersions(project.manifest, { release, appVersion });
  const generatedAt = now.toISOString();
  const siteUrl = config.siteUrl.replace(/\/$/, '');

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(project.docsDir, 'assets'), join(out, 'assets'), { recursive: true });

  const pagesByVersion = new Map(versions.map((v) => [v.version, loadPages(project, v.version)]));
  const sitemap = [];

  const emitVersion = (v, folder, isLatestCopy) => {
    const pages = pagesByVersion.get(v.version);
    const rel = '../../'.slice(0, folder.split('/').length * 3);
    const isCurrent = v.version === current.version;
    const search = [];
    pages.forEach((p, k) => {
      const { html, headings } = renderMarkdown(p.body);
      const urlPath = `/${folder}/${p.slug}`;
      const canonical = `${siteUrl}${isCurrent ? `/latest/${p.slug}` : urlPath}`;
      let banner = '';
      if (v.status === 'draft') banner = `<div class="banner draft">Draft documentation for version ${v.version}. It is not published and may change.</div>`;
      else if (!isCurrent) banner = `<div class="banner old">You are reading the documentation for version ${v.version}. The current version is <a href="${rel}latest/${p.slug}.html">${current.version}</a>.</div>`;
      const prev = pages[k - 1];
      const next = pages[k + 1];
      const prevNext = `<nav class="prevnext">${prev ? `<a class="prev" href="${prev.slug}.html"><small>Previous</small>${escapeHtml(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.slug}.html"><small>Next</small>${escapeHtml(next.title)}</a>` : '<span></span>'}</nav>`;
      const crumbs = [`<a href="${rel}index.html">Docs</a>`, `<a href="index.html">${isLatestCopy ? `Latest (${v.version})` : `Version ${v.version}`}</a>`];
      if (p.slug !== 'index') crumbs.push(`<span aria-current="page">${escapeHtml(p.title)}</span>`);
      // Pages link to the site root with "../../" (they live in versions/vX/);
      // /latest/ is one level shallower.
      const body = isLatestCopy ? html.replace(/href="\.\.\/\.\.\//g, 'href="../') : html;
      const content = body.replace(/(<h1[^>]*>.*?<\/h1>\n)/, `$1${tocHtml(headings)}`);
      writeText(join(out, folder, `${p.slug}.html`), layout({
        project, title: p.meta.title || p.title, description: p.meta.description, rel, canonical,
        versionLabel: v.version, versions, current, pageSlug: p.slug, versionRoot: `${rel}${folder}/`,
        nav: sidebar(pages, p.slug, '', rel, false), breadcrumb: crumbs.join('<span class="sep">/</span>'), content, banner, prevNext,
        mdHref: `${p.slug}.md`, searchIndex: 'search-index.json',
        meta: `<span>Version <b>${v.version}</b></span><span>Last updated <time datetime="${p.meta.lastUpdated}">${p.meta.lastUpdated}</time></span><a href="${p.slug}.md">View Markdown source</a>`,
      }));
      writeText(join(out, folder, p.file), p.raw);
      search.push({ id: p.id, title: p.meta.title || p.title, url: `${p.slug}.html`, sections: searchSections(p.body) });
      sitemap.push({ loc: `${siteUrl}${urlPath}`, lastmod: p.meta.lastUpdated });
    });
    writeJson(join(out, folder, 'search-index.json'), search);
    const all = [`<!-- ${config.product} documentation, version ${v.version}. All sections in order; "What's New in This Version" is the last section. -->`, ...pages.map((p) => p.body.trim())].join('\n\n');
    writeText(join(out, folder, 'all.md'), `${all}\n`);
    writeJson(join(out, folder, 'docs-index.json'), docsIndex(project, v, pages, `/${folder}/`, generatedAt, siteUrl));
  };

  for (const v of versions) emitVersion(v, `versions/${versionDirName(v.version)}`, false);
  emitVersion(current, 'latest', true);

  // Changelog: every included What's New section, newest first, then the
  // summary of releases before the documentation platform.
  const changelogMd = buildChangelog(project, versions, pagesByVersion);
  writeText(join(out, 'changelog', 'index.md'), changelogMd);
  {
    const { html } = renderMarkdown(parseFrontMatter(changelogMd).body);
    const rel = '../';
    writeText(join(out, 'changelog', 'index.html'), layout({
      project, title: 'Changelog', description: `Release history of ${config.product}.`, rel, canonical: `${siteUrl}/changelog/`,
      versionLabel: current.version, versions, current, pageSlug: 'changelog', versionRoot: `${rel}latest/`,
      nav: sidebar(pagesByVersion.get(current.version), null, `${rel}latest/`, rel, true),
      breadcrumb: `<a href="${rel}index.html">Docs</a><span class="sep">/</span><span aria-current="page">Changelog</span>`,
      content: html, mdHref: 'index.md', searchIndex: `${rel}latest/search-index.json`,
      meta: `<span>Current version <b>${current.version}</b></span><a href="index.md">View Markdown source</a>`,
    }));
  }

  // Landing page.
  const curPages = pagesByVersion.get(current.version);
  const cards = curPages
    .filter((p) => p.slug !== 'index')
    .map((p) => `<a class="card" href="latest/${p.slug}.html"><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.meta.description || '')}</p></a>`)
    .join('');
  const hero = `<section class="hero"><p class="eyebrow">Official documentation · version ${current.version}</p>
<h1>${escapeHtml(config.product)}</h1>
<p class="lead">How the geography game works: rules, scoring, levels, features, statistics and privacy. Written for players and for AI assistants.</p>
<p class="hero-actions"><a class="btn" href="latest/index.html">Read the documentation</a><a class="btn ghost" href="latest/whats-new.html">What's new in ${current.version}</a></p></section>
<section class="cards">${cards}</section>
<section class="machine"><h2>For AI systems and integrations</h2><ul>
<li><a href="data/docs-index.json"><code>/data/docs-index.json</code></a>: sections of the current version with Markdown URLs</li>
<li><a href="data/versions.json"><code>/data/versions.json</code></a>: all published versions</li>
<li><a href="latest/all.md"><code>/latest/all.md</code></a>: the complete current documentation in one Markdown file</li>
<li><a href="llms.txt"><code>/llms.txt</code></a>: a short guide for language models</li></ul></section>`;
  writeText(join(out, 'index.html'), layout({
    project, title: `${config.product} Documentation`, description: `Official documentation for ${config.product} ${current.version}.`, rel: '', canonical: `${siteUrl}/`,
    versionLabel: current.version, versions, current, pageSlug: '', versionRoot: 'latest/', nav: sidebar(curPages, null, 'latest/', '', false),
    breadcrumb: '<span aria-current="page">Docs</span>', content: hero, searchIndex: 'latest/search-index.json',
    meta: `<span>Current version <b>${current.version}</b>, released ${current.releaseDate}</span>`,
  }));
  writeText(join(out, '404.html'), layout({
    project, title: 'Page not found', description: '', rel: '/', canonical: null, versionLabel: current.version, versions, current,
    pageSlug: '', versionRoot: '/latest/', nav: sidebar(curPages, null, '/latest/', '/', false), breadcrumb: '<a href="/index.html">Docs</a>',
    content: '<h1>Page not found</h1><p>This page does not exist. Start from the <a href="/latest/index.html">current documentation</a>.</p>', searchIndex: '/latest/search-index.json', meta: '',
  }));

  // Machine-readable data.
  const publicVersions = versions.slice().reverse().map((v) => ({
    version: v.version, releaseDate: v.releaseDate, status: v.status === 'final' ? 'published' : 'draft',
    latest: v.version === current.version, path: `/versions/${versionDirName(v.version)}/`, checksum: v.checksum || null,
  }));
  writeJson(join(out, 'data', 'versions.json'), {
    product: config.product, currentVersion: current.version, releaseDate: current.releaseDate, latestPath: '/latest/',
    generatedAt, ...(commit ? { sourceCommit: commit } : {}), versions: publicVersions,
  });
  writeJson(join(out, 'data', 'docs-index.json'), docsIndex(project, current, curPages, '/latest/', generatedAt, siteUrl));
  writeJson(join(out, 'data', 'navigation.json'), project.navigation.pages.map(({ id, title, file }) => ({ id, title, file })));
  writeText(join(out, 'llms.txt'), llmsTxt(config, current, curPages, siteUrl));
  writeText(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);
  sitemap.unshift({ loc: `${siteUrl}/`, lastmod: current.releaseDate }, { loc: `${siteUrl}/changelog/`, lastmod: current.releaseDate });
  writeText(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
  return { current: current.version, versions: versions.map((v) => v.version) };
}

function docsIndex(project, v, pages, base, generatedAt, siteUrl) {
  return {
    product: project.config.product,
    documentationLanguage: project.config.language,
    currentVersion: v.version,
    releaseDate: v.releaseDate,
    generatedAt,
    fullText: `${base}all.md`,
    changelog: '/changelog/index.md',
    versions: '/data/versions.json',
    sections: pages.map((p) => ({
      id: p.id,
      title: p.meta.title || p.title,
      description: p.meta.description || '',
      lastUpdated: p.meta.lastUpdated || null,
      path: `${base}${p.file}`,
      html: `${base}${p.slug}.html`,
      url: `${siteUrl}${base}${p.file}`,
    })),
  };
}

function buildChangelog(project, versions, pagesByVersion) {
  const parts = [`# Changelog\n\nRelease history of ${project.config.product}. Each entry is the "What's New in This Version" section of that version's documentation. Versions follow semantic versioning (MAJOR.MINOR.PATCH).\n`];
  for (const v of versions.slice().reverse()) {
    const wn = pagesByVersion.get(v.version).find((p) => p.id === 'whats-new');
    if (!wn) continue;
    const body = wn.body
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^# .*\n/m, '')
      .replace(/^- \*\*(Version|Release date):\*\*.*\n/gm, '')
      .replace(/^(#{2,5}) /gm, '#$1 ')
      .replace(/\]\(\.\.\/\.\.\/changelog\/index\.md\)/g, '](#releases-before-the-documentation-platform)')
      .replace(/\]\((?!https?:|#|\.\.\/)([\w-]+\.md(#[\w-]+)?)\)/g, `](../versions/${versionDirName(v.version)}/$1)`)
      .trim();
    parts.push(`## Version ${v.version} (${v.releaseDate})\n\n[Documentation for ${v.version}](../versions/${versionDirName(v.version)}/index.md)\n\n${body}\n`);
  }
  const history = join(project.docsDir, 'changelog', 'history.md');
  if (existsSync(history)) parts.push(readFileSync(history, 'utf8').trim());
  return `${parts.join('\n')}\n`;
}

function llmsTxt(config, v, pages, siteUrl) {
  return `# ${config.product}

> ${config.product} is a geography learning game played as a Telegram Mini App (${config.playUrl}). This is its official documentation, version ${v.version} (released ${v.releaseDate}). The documentation is the authoritative source for game rules, scoring, levels, features, statistics and privacy. Every page is available as Markdown.

Current version: ${v.version}
Machine-readable index: ${siteUrl}/data/docs-index.json
Version manifest: ${siteUrl}/data/versions.json
Complete documentation in one file: ${siteUrl}/latest/all.md

## Sections (current version)

${pages.map((p) => `- [${p.meta.title || p.title}](${siteUrl}/latest/${p.file}): ${p.meta.description || ''}`).join('\n')}

## Other

- [Changelog](${siteUrl}/changelog/index.md): release history
- Older versions: ${siteUrl}/versions/vX.Y.Z/ (see versions.json)
`;
}

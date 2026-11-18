// A small Markdown renderer for the documentation pages. It supports the
// subset the guidelines allow (docs/DOCUMENTATION_GUIDELINES.md): headings,
// paragraphs, nested lists, GFM tables, fenced code, blockquotes, rules,
// links, bold, italic and inline code. Raw HTML is escaped, HTML comments
// are dropped. Keeping it in-house avoids a build dependency on the server.

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GitHub-compatible heading anchors: lower case, punctuation removed
// (except "-" and "_"), spaces to "-".
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~[\]()]/g, (c) => (c === '_' ? '_' : ''))
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

// Plain text of inline Markdown (for headings, search and slugs).
export function inlineText(md) {
  return md
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

const stripComments = (text) => text.replace(/<!--[\s\S]*?-->/g, '');

// Rewrites a link target for the HTML site: "page.md#x" → "page.html#x".
function htmlHref(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return href;
  return href.replace(/\.md(?=$|#)/, '.html');
}

function renderInline(md, opts) {
  const codes = [];
  let s = md.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const external = /^https?:\/\//i.test(href);
    const target = opts.rewriteLinks === false ? href : htmlHref(href);
    return `<a href="${target}"${external ? ' rel="noopener"' : ''}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const RE = {
  fence: /^```\s*([\w-]*)\s*$/,
  heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,
  list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
  quote: /^\s*>\s?(.*)$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Renders Markdown to HTML. Returns {html, headings:[{level, text, id}]}.
export function renderMarkdown(source, opts = {}) {
  const lines = stripComments(source).replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  const usedIds = new Map();
  const inline = (s) => renderInline(s, opts);

  const uniqueId = (text) => {
    const base = slugify(text) || 'section';
    const n = usedIds.get(base) || 0;
    usedIds.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };

  function parseList(start, indent) {
    const first = RE.list.exec(lines[start]);
    const ordered = /\d/.test(first[2]);
    const items = [];
    let i = start;
    while (i < lines.length) {
      const m = RE.list.exec(lines[i]);
      if (!m || m[1].length < indent) break;
      if (m[1].length > indent) {
        // A deeper list belongs to the previous item.
        const sub = parseList(i, m[1].length);
        if (items.length) items[items.length - 1].children += sub.html.trimEnd();
        i = sub.next;
        continue;
      }
      const item = { text: m[3], children: '' };
      i++;
      // Continuation lines (indented, not a new item) join the item text.
      while (i < lines.length && lines[i].trim() && !RE.list.test(lines[i]) && /^\s+/.test(lines[i])) {
        item.text += ` ${lines[i].trim()}`;
        i++;
      }
      items.push(item);
      if (i < lines.length && !lines[i].trim()) {
        // A blank line ends the list unless another item of this list follows.
        const nextM = RE.list.exec(lines[i + 1] || '');
        if (nextM && nextM[1].length >= indent) i++;
        else break;
      }
    }
    const tag = ordered ? 'ol' : 'ul';
    const html = `<${tag}>${items.map((it) => `<li>${inline(it.text)}${it.children}</li>`).join('')}</${tag}>\n`;
    return { html, next: i };
  }

  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m = RE.fence.exec(line);
    if (m) {
      const buf = [];
      i++;
      while (i < lines.length && !RE.fence.test(lines[i])) buf.push(lines[i++]);
      i++;
      const lang = m[1] ? ` class="language-${escapeHtml(m[1])}"` : '';
      html += `<pre><code${lang}>${escapeHtml(buf.join('\n'))}</code></pre>\n`;
      continue;
    }

    m = RE.heading.exec(line);
    if (m) {
      const level = m[1].length;
      const text = inlineText(m[2]);
      const id = uniqueId(text);
      headings.push({ level, text, id });
      const anchor = level > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
      html += `<h${level} id="${id}">${inline(m[2])}${anchor}</h${level}>\n`;
      i++;
      continue;
    }

    if (RE.hr.test(line)) { html += '<hr>\n'; i++; continue; }

    if (line.trim().startsWith('|') && RE.tableSep.test(lines[i + 1] || '')) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</${tag}>`;
      html += `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`)
        .join('')}</tbody></table></div>\n`;
      continue;
    }

    if (RE.quote.test(line)) {
      const buf = [];
      while (i < lines.length && RE.quote.test(lines[i])) buf.push(RE.quote.exec(lines[i++])[1]);
      html += `<blockquote>${renderMarkdown(buf.join('\n'), opts).html}</blockquote>\n`;
      continue;
    }

    m = RE.list.exec(line);
    if (m) {
      const list = parseList(i, m[1].length);
      html += list.html;
      i = list.next;
      continue;
    }

    const buf = [];
    while (
      i < lines.length && lines[i].trim() && !RE.fence.test(lines[i]) && !RE.heading.test(lines[i]) &&
      !RE.list.test(lines[i]) && !RE.quote.test(lines[i]) && !RE.hr.test(lines[i]) &&
      !(lines[i].trim().startsWith('|') && RE.tableSep.test(lines[i + 1] || ''))
    ) buf.push(lines[i++].trim());
    html += `<p>${inline(buf.join(' '))}</p>\n`;
  }
  return { html, headings };
}

// Markdown links of a document: [{text, href, line}] (code spans and fenced
// code are ignored, so examples don't count as links).
export function extractLinks(source) {
  const out = [];
  let inFence = false;
  stripComments(source).split('\n').forEach((line, idx) => {
    if (RE.fence.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const clean = line.replace(/`[^`]*`/g, '');
    for (const m of clean.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) out.push({ text: m[1], href: m[2], line: idx + 1 });
  });
  return out;
}

// Headings with their ids, without rendering (for link checks).
export function headingIds(source) {
  return renderMarkdown(source).headings;
}

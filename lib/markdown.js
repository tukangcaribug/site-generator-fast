// Fast Markdown for makefun-site 1.0.0 (README "Markdown", lib/markdown.js).
// Lexing and rendering fused into one pass over the lines; inline rendering is
// an iterative scan with a segment buffer. Behaviour is the reference's exactly.

import { escapeHtml, slugify, uniqueSlug } from './text.js';

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A line trimmed of spaces and tabs at both ends. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** Fence-open language of `line`, or null when it is not a fence open. */
function fenceLang(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  const start = i;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45;
    if (!ok) break;
    i++;
  }
  const langEnd = i;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  if (i !== line.length) return null;
  return line.slice(3, langEnd);
}

/** Whether `line` is a fence close: three backticks, spaces or tabs after them. */
function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's { depth, text }, or null (a heading's text is never empty). */
function headingOf(line) {
  let n = 0;
  while (n < 6 && line.charCodeAt(n) === 35) n++;
  if (n === 0 || n === 7) return null;
  if (n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let b = line.length;
  while (b > n && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  // Text is everything after the space/tab run: HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/.
  let a = n;
  while (a < line.length && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  if (a >= b) return null;
  return { depth: n, text: line.slice(a, b) };
}

/** Whether `line` is a thematic break: `---` or `***`, then spaces or tabs only. */
function isHr(line) {
  const c = line.charCodeAt(0);
  if (c !== 45 && c !== 42) return false;
  if (line.charCodeAt(1) !== c || line.charCodeAt(2) !== c) return false;
  for (let i = 3; i < line.length; i++) {
    const cc = line.charCodeAt(i);
    if (cc !== 32 && cc !== 9) return false;
  }
  return true;
}

/** Whether `line` ends a paragraph: blank, fence, heading or thematic break. */
function endsParagraph(line) {
  if (line === '') return true;
  const c = line.charCodeAt(0);
  if (c === 96) return fenceLang(line) !== null; // '`'
  if (c === 35) return headingOf(line) !== null; // '#'
  if (c === 45 || c === 42) return isHr(line); // '-' '*'
  if (c === 32 || c === 9) return isBlank(line);
  return false;
}

/** A bullet item's text, or null. */
function bulletOf(line) {
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** An ordered item's { start, text }, or null. */
function orderedOf(line) {
  let i = 0;
  while (i < 9 && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) i++;
  if (i === 0) return null;
  if (line.charCodeAt(i) !== 46 || line.charCodeAt(i + 1) !== 32) return null; // '.' + ' '
  return { start: Number(line.slice(0, i)), text: line.slice(i + 2) };
}

/** Whether `line` continues a list item: two or more spaces then a non-space. */
function isContinued(line) {
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  for (let i = 2; i < line.length; i++) if (line.charCodeAt(i) !== 32) return true;
  return false;
}

/** Whether the character at `j` is escaped: an odd run of backslashes right
 * before it (from `from`). Within such a run the backslashes pair up
 * (backslash is itself escapable), so an odd run means the last one escapes
 * the character at `j` — the same rule the left-to-right scan applies. */
function isEscaped(s, from, j) {
  let n = 0;
  let k = j - 1;
  while (k >= from && s.charCodeAt(k) === 92) { n++; k--; }
  return (n & 1) === 1;
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1; never at or past `end`. */
function findUnescaped(s, what, from, end) {
  let j = s.indexOf(what, from);
  while (j !== -1 && j + what.length <= end) {
    if (!isEscaped(s, from, j)) return j;
    j = s.indexOf(what, j + 1);
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1; never at or past `end`. */
function findSingleStar(s, from, end) {
  let j = s.indexOf('*', from);
  while (j !== -1 && j < end) {
    if (s[j + 1] === '*') {
      // A ** pair — unless its first star is escaped, in which case the
      // scan resumes at the second star (it may itself start a ** pair).
      j = s.indexOf('*', j + (isEscaped(s, from, j) ? 1 : 2));
      continue;
    }
    if (isEscaped(s, from, j)) { j = s.indexOf('*', j + 1); continue; }
    return j;
  }
  return -1;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** No markup and no escapable character at all: the text renders as itself. */
const INLINE_PLAIN = /[\\`*\[&<>"']/;

/**
 * `s` rendered inline; `env.link(target)` is a link's href. One iterative scan
 * with an explicit frame stack for strong/em/link interiors (no slices, no
 * recursion): a frame's interior is scanned in place, bounded by its closer.
 */
export function inline(s, env) {
  if (!INLINE_PLAIN.test(s)) return s;
  return inlineScan(s, 0, s.length, env);
}

/** Global scan for the next character inline treats specially. */
const SPECIAL_RE = /[\\`*\[&<>"']/g;

function inlineScan(s, start, end, env) {
  const out = [];
  let run = -1; // start of the current plain run, or -1
  let i = start;
  let lim = end; // innermost frame's end, or the scan end
  const stack = []; // { end, close, skipTo }
  const flush = (to) => {
    if (run !== -1) { if (to > run) out.push(s.slice(run, to)); run = -1; }
  };
  while (i < end) {
    while (stack.length !== 0 && i >= stack[stack.length - 1].end) {
      const f = stack.pop();
      flush(i);
      out.push(f.close);
      i = f.skipTo;
      lim = stack.length === 0 ? end : stack[stack.length - 1].end;
    }
    if (i >= end) break;
    // Jump straight to the next special character in this frame (one C++
    // scan); everything before it is a plain run.
    SPECIAL_RE.lastIndex = i;
    const mm = SPECIAL_RE.exec(s);
    const ns = (mm !== null && mm.index < lim) ? mm.index : -1;
    if (ns === -1) {
      if (run === -1) run = i;
      i = lim;
      continue;
    }
    if (ns > i) {
      if (run === -1) run = i;
      i = ns;
    }
    const c = s[i];
    if (c === '\\' && i + 1 < lim && ESCAPABLE.has(s[i + 1])) {
      flush(i);
      out.push(escapeHtml(s[i + 1]));
      i += 2;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j < lim && j > i + 1) {
        flush(i);
        out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        i = j + 1;
      } else {
        if (run === -1) run = i;
        i++;
      }
      continue;
    }
    if (c === '*') {
      if (i + 1 < lim && s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2, lim);
        if (j > i + 2) {
          flush(i);
          out.push('<strong>');
          stack.push({ end: j, close: '</strong>', skipTo: j + 2 });
          lim = j;
          i += 2;
        } else {
          if (run === -1) run = i;
          i += 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1, lim);
      if (j > i + 1) {
        flush(i);
        out.push('<em>');
        stack.push({ end: j, close: '</em>', skipTo: j + 1 });
        lim = j;
        i += 1;
      } else {
        if (run === -1) run = i;
        i++;
      }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1, lim);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 || m >= lim ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        flush(i);
        out.push('<a href="', escapeHtml(env.link(target)), '">');
        stack.push({ end: k, close: '</a>', skipTo: m + 1 });
        lim = k;
        i += 1;
      } else {
        if (run === -1) run = i;
        i++;
      }
      continue;
    }
    const e = ESCAPES[c];
    if (e !== undefined) {
      flush(i);
      out.push(e);
      i++;
      continue;
    }
    if (run === -1) run = i;
    i++;
  }
  flush(end);
  // Frames left open (can only be ones whose end is `end` itself — the loop
  // exits at `end` before popping them): close them in order.
  while (stack.length !== 0) out.push(stack.pop().close);
  return out.join('');
}

/**
 * `src` rendered: its HTML (each block on its own lines, a "\n" after the last),
 * its table of contents (every level 2 and 3 heading) and its excerpt (the first
 * paragraph's inline HTML, or "").
 */
export function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (line === '' || line.charCodeAt(0) === 32 || line.charCodeAt(0) === 9) {
      if (isBlank(line)) { i++; continue; }
    }
    const c0 = line.charCodeAt(0);
    let lang = null;
    if (c0 === 96) lang = fenceLang(line);
    if (lang !== null) {
      const body = [];
      i++;
      while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      const codeParts = [];
      for (let k = 0; k < body.length; k++) { codeParts.push(escapeHtml(body[k])); codeParts.push('\n'); }
      blocks.push(`<pre><code${cls}>${codeParts.join('')}</code></pre>`);
      continue;
    }
    let heading = null;
    if (c0 === 35) heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text), ids);
      const html = inline(heading.text, env);
      blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>`);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if ((c0 === 45 || c0 === 42) && isHr(line)) { blocks.push('<hr>'); i++; continue; }
    if (c0 === 62) { // '>'
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i++];
        l = l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1); // drop '>' and one space
        body.push(l);
      }
      const kept = [];
      for (const l of body) { const t = trimLine(l); if (t !== '') kept.push(t); }
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    }
    let bullet = null;
    let ordered = null;
    if (c0 === 45 || c0 === 42) bullet = bulletOf(line);
    else if (c0 >= 48 && c0 <= 57) ordered = orderedOf(line);
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = [];
      let start = 1;
      if (isOrdered) start = ordered.start;
      while (i < n) {
        if (isOrdered) {
          const m = orderedOf(lines[i]);
          if (m !== null) { items.push([trimLine(m.text)]); i++; continue; }
        } else {
          const m = bulletOf(lines[i]);
          if (m !== null) { items.push([trimLine(m)]); i++; continue; }
        }
        if (isContinued(lines[i])) { items[items.length - 1].push(trimLine(lines[i])); i++; continue; }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      const parts = [`${open}\n`];
      for (const item of items) parts.push(`<li>${inline(item.join('\n'), env)}</li>\n`);
      parts.push(`</${tag}>`);
      blocks.push(parts.join(''));
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  // One C++ join instead of a per-block += loop.
  return { html: blocks.length === 0 ? '' : `${blocks.join('\n')}\n`, toc, excerpt: excerpt ?? '' };
}

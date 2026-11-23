// Fast text helpers for makefun-site 1.0.0 semantics (README "Text", lib/text.js).
// Pure functions; slugify results are memoised per input string (pure memo —
// output identical with or without it). clearCaches() resets the memo.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const ESC_RE = /[&<>"']/;
const ESC_RE_G = /[&<>"']/g;

/** `text` with & < > " and ' escaped. One C++ regex scan to test, one C++
 * replace when a special is present (far cheaper than five indexOf scans
 * plus a per-character JS loop under --no-opt). */
export function escapeHtml(text) {
  if (!ESC_RE.test(text)) return text;
  return text.replace(ESC_RE_G, (c) => ESCAPES[c]);
}

export const SLUG_MAX = 64;

const slugCache = new Map();
export function clearCaches() { slugCache.clear(); }

/**
 * Slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of
 * characters other than a-z and 0-9 one "-", none at either end, at most 64
 * characters (a "-" left at the cut dropped), "untitled" when nothing is left.
 */
export function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i];
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  slugCache.set(text, out);
  return out;
}

/** `slug` made unique against `taken` (and added to it): slug, slug-2, slug-3 ... */
export function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) { taken.add(slug); return slug; }
  let n = 2;
  let out = `${slug}-2`;
  while (taken.has(out)) { n++; out = `${slug}-${n}`; }
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
export function longDate(date) {
  const y = date.slice(0, 4);
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The words of a body: its runs of characters other than whitespace.
 * (The reference's own form: the C++ regex engine does the scan, which is
 * far faster than a per-character loop under Sparkplug.) */
export function wordsOf(text) {
  const m = text.match(/\S+/g);
  return m === null ? 0 : m.length;
}

// Fast front matter for makefun-site 1.0.0 (README "Front matter", lib/frontmatter.js).
// Identical acceptance and error strings; only the scanning is tightened.

export const KEYS = Object.freeze(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) { // '"'
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' }; // '['
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first
 * reason it is refused. `text` has "\n" line ends. Lines are scanned by index
 * (no split); the body is a view of `text` past the closing `---`, which the
 * reference's split+join reconstructs exactly.
 */
export function parseFrontMatter(text) {
  // [line, nextPos]: the line starting at `from`, and where the next starts.
  const lineAt = (from) => {
    const nl = text.indexOf('\n', from);
    return nl === -1 ? [text.slice(from), text.length + 1] : [text.slice(from, nl), nl + 1];
  };
  const [first, p0] = lineAt(0);
  if (first !== '---') return { error: 'no front matter' };
  // The reference finds the closing `---` before it validates any line: a
  // file with no closing line is "not closed" even when an earlier line is
  // not "key: value" either.
  let p = p0;
  let bodyStart = -1;
  let closeLine = -1;
  let n = 2; // 1-based number of the line starting at p
  while (p <= text.length) {
    const [line, np] = lineAt(p);
    if (line === '---') { closeLine = n; bodyStart = np > text.length ? text.length : np; break; }
    p = np;
    n++;
  }
  if (closeLine === -1) return { error: 'the front matter is not closed' };
  const data = {};
  p = p0;
  n = 2;
  while (n < closeLine) {
    const [line, np] = lineAt(p);
    if (!isBlank(line) && line.charCodeAt(0) !== 35) { // not blank, not '#' comment
      const colon = line.indexOf(':');
      if (colon === -1) return { error: `line ${n} is not "key: value"` };
      const key = line.slice(0, colon);
      if (!/^[a-z_]+$/.test(key)) return { error: `line ${n} is not "key: value"` };
      // Reference LINE regex: ^([a-z_]+):(?: (.*))?$ — colon followed by
      // exactly one space then the value, or end of line.
      let raw;
      if (colon === line.length - 1) raw = '';
      else if (line.charCodeAt(colon + 1) === 32) raw = line.slice(colon + 2);
      else return { error: `line ${n} is not "key: value"` };
      // Trailing spaces and tabs dropped.
      let e = raw.length;
      while (e > 0 && (raw.charCodeAt(e - 1) === 32 || raw.charCodeAt(e - 1) === 9)) e--;
      if (e !== raw.length) raw = raw.slice(0, e);
      if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    p = np;
    n++;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(bodyStart) };
}

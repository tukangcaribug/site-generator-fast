// Fast template dialect for makefun-site 1.0.0 (README "Templates", lib/template.js).
// Parsing is the reference's exactly (same AST, same errors); rendering writes
// into an array instead of concatenating strings at every step.

/** The deepest an include nests: one past it renders nothing. */
export const INCLUDE_DEPTH = 8;

/** Root-scope names whose values are fixed for one whole build (one case). */
const FIXED = new Set(['site', 'tags', 'recent']);

/**
 * Which templates may be memoised, and on what, for one build's parsed
 * templates (a Map of name to nodes). A template's output is a pure function
 * of (a) the case-fixed names site/tags/recent and (b) at most one other
 * free variable: every name it reads, transitively through its includes, is
 * either fixed, bound by one of its own for-loops (from a collection that
 * is itself fixed or free-derived), or that one free variable. Then:
 * - no other free variable: mode 'const' (one rendering per include depth
 *   serves every render of the template in the build);
 * - exactly one free variable `keyVar`: mode 'key' (one rendering per
 *   include depth per value of that variable — the same object rendered
 *   wherever it is included, e.g. one post's card in every list).
 * Anything else (two or more free variables, or a read of a name no scope
 * provides) is not memoised. 'loop' is never a key: the loop object is one
 * object mutated per iteration, so it cannot tell iterations apart.
 * A cycle (a template including itself, directly or not) is not memoised.
 * If any for-loop anywhere binds a fixed name, shadowing it, no template is
 * memoised at all: a fixed read could then mean the loop's item.
 * Returns a Map of name to { mode, keyVar?, cache }, the caches empty.
 */
export function analyzeMemo(templates) {
  // Pre-scan: no for-loop anywhere may bind a fixed name.
  const forVars = new Set();
  const scan = (nodes) => {
    for (const n of nodes) {
      if (n.k === 4) { forVars.add(n.name); scan(n.body); }
      else if (n.k === 3) { scan(n.then); if (n.else !== null) scan(n.else); }
    }
  };
  for (const nodes of templates.values()) scan(nodes);
  for (const v of forVars) if (FIXED.has(v)) return new Map();

  // Walk one template's nodes. `inherited` holds names bound by fors
  // enclosing the current point in an ancestor template (carried through
  // includes); `local` holds names bound by this template's own fors on the
  // current path. A read of a fixed name or a locally-bound name is
  // determined inside the template; any other read is a free input and goes
  // into `used`. Returns false on an include cycle, or on a read of an
  // unbound 'loop' (the loop object is mutated per iteration, so it can
  // never be a memo key and its value is iteration-dependent).
  const walk = (name, nodes, inherited, local, used, visiting) => {
    const read = (s) => {
      if (FIXED.has(s) || local.has(s)) return true;
      if (s === 'loop') return false;
      used.add(s);
      return true;
    };
    for (const n of nodes) {
      if (n.k === 1 || n.k === 2) {
        if (!read(n.path[0])) return false;
      } else if (n.k === 3) {
        if (!read(n.path[0])) return false;
        if (!walk(name, n.then, inherited, local, used, visiting)) return false;
        if (n.else !== null && !walk(name, n.else, inherited, local, used, visiting)) return false;
      } else if (n.k === 4) {
        if (!read(n.path[0])) return false;
        const inner = new Set(local);
        inner.add(n.name);
        inner.add('loop');
        if (!walk(name, n.body, inherited, inner, used, visiting)) return false;
      } else if (n.k === 5) {
        const sub = templates.get(n.name);
        if (sub !== undefined) {
          if (visiting.has(n.name)) return false;
          visiting.add(n.name);
          const next = new Set(inherited);
          for (const v of local) next.add(v);
          const ok = walk(n.name, sub, next, new Set(), used, visiting);
          visiting.delete(n.name);
          if (!ok) return false;
        }
      }
    }
    return true;
  };
  const out = new Map();
  for (const [name, nodes] of templates) {
    const used = new Set();
    if (!walk(name, nodes, new Set(), new Set(), used, new Set([name]))) continue;
    if (used.size === 0) out.set(name, { mode: 'const', cache: new Map() });
    else if (used.size === 1) {
      const keyVar = [...used][0];
      if (keyVar !== 'loop') out.set(name, { mode: 'key', keyVar, cache: new Map() });
    }
  }
  return out;
}

/** Thrown when a template does not parse: carries the template name and the reason. */
export class TemplateError extends Error {}

function failParse(name, why) {
  throw new TemplateError(`template "${name}": ${why}`);
}

function identStart(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function identRest(ch) {
  const c = ch.charCodeAt(0);
  return identStart(ch) || (c >= 48 && c <= 57);
}

function isIdent(s) {
  if (s.length === 0 || !identStart(s[0])) return false;
  for (let i = 1; i < s.length; i++) if (!identRest(s[i])) return false;
  return true;
}

function isPathText(s) {
  if (s.length === 0) return false;
  for (const part of s.split('.')) if (!isIdent(part)) return false;
  return true;
}

/** Splits `text` into its dotted path segments, or throws when it names no path. */
function pathOf(name, text) {
  if (!isPathText(text)) failParse(name, `${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** Finds every tag opener in `src` and, for each, where it closes and where scanning resumes. */
function scanSpans(name, src) {
  const opener = /\{\{\{|\{\{|\{%/g;
  const spans = [];
  let hit;
  while ((hit = opener.exec(src)) !== null) {
    const at = hit.index;
    const mark = hit[0];
    if (mark === '{{{' || mark === '{{') {
      const triple = mark === '{{{';
      const width = triple ? 3 : 2;
      const stop = src.indexOf(triple ? '}}}' : '}}', at + width);
      if (stop === -1) failParse(name, `a ${triple ? '{{{' : '{{'} is not closed`);
      spans.push({ sort: triple ? 'raw' : 'var', open: at, close: stop, resume: stop + width });
    } else {
      const stop = src.indexOf('%}', at + 2);
      if (stop === -1) failParse(name, 'a {% is not closed');
      const end = stop + 2;
      const lineStart = src.lastIndexOf('\n', at - 1) + 1;
      const nl = src.indexOf('\n', end);
      const lineEnd = nl === -1 ? src.length : nl;
      const alone = /^[ \t]*$/.test(src.slice(lineStart, at)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
      spans.push({ sort: 'tag', open: at, close: stop, resume: alone ? (nl === -1 ? src.length : nl + 1) : end, lineStart, alone });
    }
  }
  return spans;
}

/** Cuts `src` into tokens: runs of text, {{ }} / {{{ }}} values, and {% %} tags. */
function tokenize(name, src) {
  const spans = scanSpans(name, src);
  const out = [];
  let buf = '';
  let cursor = 0;
  const flush = () => {
    if (buf !== '') {
      out.push({ t: 'text', text: buf });
      buf = '';
    }
  };
  for (const sp of spans) {
    buf += src.slice(cursor, sp.open);
    if (sp.sort === 'tag' && sp.alone) buf = buf.slice(0, buf.length - (sp.open - sp.lineStart));
    flush();
    if (sp.sort === 'var' || sp.sort === 'raw') {
      const wide = sp.sort === 'raw' ? 3 : 2;
      out.push({ t: sp.sort, path: pathOf(name, src.slice(sp.open + wide, sp.close).trim()) });
    } else {
      out.push({ t: 'tag', tag: src.slice(sp.open + 2, sp.close).trim() });
    }
    cursor = sp.resume;
  }
  buf += src.slice(cursor);
  flush();
  return out;
}

/** Reads one {% %} tag's meaning: for/if/else/end/include, or null when it names none. */
function tagKind(tag) {
  if (tag === 'else') return { k: 'else' };
  if (tag === 'endfor') return { k: 'endfor' };
  if (tag === 'endif') return { k: 'endif' };
  if (tag.startsWith('for ')) {
    const rest = tag.slice(4);
    const gap = rest.indexOf(' ');
    if (gap === -1) return null;
    const loopName = rest.slice(0, gap);
    if (!isIdent(loopName)) return null;
    if (!rest.slice(gap).startsWith(' in ')) return null;
    const coll = rest.slice(gap + 4);
    if (coll === '' || /\s/.test(coll)) return null;
    return { k: 'for', name: loopName, pathText: coll };
  }
  if (tag.startsWith('if ')) {
    let body = tag.slice(3);
    let neg = false;
    if (body.startsWith('not ')) {
      neg = true;
      body = body.slice(4);
    }
    if (body === '' || /\s/.test(body)) return null;
    return { k: 'if', neg, pathText: body };
  }
  if (tag.startsWith('include "') && tag.endsWith('"')) {
    const nm = tag.slice(9, -1);
    if (/^[a-z0-9-]+$/.test(nm)) return { k: 'include', name: nm };
    return null;
  }
  return null;
}

/** Builds the node tree for one template's source; a TemplateError escapes when the source is malformed. */
export function parseTemplate(name, src) {
  const top = { kind: 'root', body: [] };
  const frames = [top];
  let current = top.body;
  for (const chunk of tokenize(name, src)) {
    if (chunk.t === 'text') {
      current.push({ kind: 'text', k: 0, text: chunk.text });
      continue;
    }
    if (chunk.t === 'var' || chunk.t === 'raw') {
      current.push({ kind: chunk.t, k: chunk.t === 'var' ? 1 : 2, path: chunk.path });
      continue;
    }
    const head = tagKind(chunk.tag);
    if (head === null) failParse(name, `{% ${chunk.tag} %} is not a tag`);
    const host = frames[frames.length - 1];
    if (head.k === 'for') {
      const node = { kind: 'for', k: 4, name: head.name, path: pathOf(name, head.pathText), body: [] };
      current.push(node);
      frames.push(node);
      current = node.body;
    } else if (head.k === 'if') {
      const node = { kind: 'if', k: 3, not: head.neg, path: pathOf(name, head.pathText), then: [], else: null };
      current.push(node);
      frames.push(node);
      current = node.then;
    } else if (head.k === 'else') {
      if (host.kind !== 'if' || host.else !== null) failParse(name, 'an else outside an if');
      host.else = [];
      current = host.else;
    } else if (head.k === 'endfor' || head.k === 'endif') {
      const want = head.k === 'endfor' ? 'for' : 'if';
      if (host.kind !== want) failParse(name, `an ${head.k} with no open ${head.k.slice(3)}`);
      frames.pop();
      const up = frames[frames.length - 1];
      current = up.kind === 'root' ? up.body : up.kind === 'for' ? up.body : up.else ?? up.then;
    } else {
      current.push({ kind: 'include', k: 5, name: head.name });
    }
  }
  if (frames.length > 1) failParse(name, `a ${frames[frames.length - 1].kind} is not closed`);
  return top.body;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
function lookup(scope, path) {
  let s = scope;
  while (s !== null) {
    const v = s.vars[path[0]];
    // Defined values are the common case: skip the hasOwn call for them.
    // (An explicitly-undefined binding still resolves here, as before.)
    if (v !== undefined || Object.hasOwn(s.vars, path[0])) {
      if (path.length === 1) return v;
      let w = v;
      for (let k = 1; k < path.length; k++) {
        if (w === null || typeof w !== 'object' || !Object.hasOwn(w, path[k])) return undefined;
        w = w[path[k]];
      }
      return w;
    }
    s = s.parent;
  }
  return undefined;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * `nodes` rendered into `out` (an array of strings) in `scope` ({ vars, parent }).
 * `ctx` holds the parsed templates (`templates`, a Map of name to nodes), the HTML
 * escape, the include depth, and the per-build memo table (`memoByName`, a Map
 * of template name to { mode, cache } from analyzeMemo, or undefined).
 */
export function renderNodes(nodes, scope, ctx, depth, out) {
  // Hoisted: every var node reads escape, every include reads templates.
  const esc = ctx.escape;
  const tpl = ctx.templates;
  const memoByName = ctx.memoByName;
  for (const n of nodes) {
    switch (n.k) {
      case 0:
        out.push(n.text);
        break;
      case 1: {
        const v = lookup(scope, n.path);
        out.push(esc(typeof v === 'string' ? v : textOf(v)));
        break;
      }
      case 2: {
        const v = lookup(scope, n.path);
        out.push(typeof v === 'string' ? v : textOf(v));
        break;
      }
      case 3: {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
        break;
      }
      case 4: {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const vars = { [n.name]: undefined, loop: { index: 0, first: false, last: false, length: xs.length } };
        const child = { vars, parent: scope };
        for (let k = 0; k < xs.length; k++) {
          vars[n.name] = xs[k];
          vars.loop.index = k + 1;
          vars.loop.first = k === 0;
          vars.loop.last = k === xs.length - 1;
          renderNodes(n.body, child, ctx, depth, out);
        }
        break;
      }
      case 5: {
        if (depth >= INCLUDE_DEPTH) break;
        const t = tpl.get(n.name);
        if (t === undefined) break;
        const md = memoByName === undefined ? undefined : memoByName.get(n.name);
        if (md === undefined) {
          renderNodes(t, scope, ctx, depth + 1, out);
          break;
        }
        if (md.mode === 'const') {
          let s = md.cache.get(depth);
          if (s === undefined) {
            const tmp = [];
            renderNodes(t, scope, ctx, depth + 1, tmp);
            s = tmp.join('');
            md.cache.set(depth, s);
          }
          out.push(s);
          break;
        }
        const kv = lookup(scope, [md.keyVar]);
        let byKey = md.cache.get(depth);
        if (byKey === undefined) {
          byKey = new Map();
          md.cache.set(depth, byKey);
        }
        let s = byKey.get(kv);
        if (s === undefined) {
          const tmp = [];
          renderNodes(t, scope, ctx, depth + 1, tmp);
          s = tmp.join('');
          byKey.set(kv, s);
        }
        out.push(s);
        break;
      }
    }
  }
}

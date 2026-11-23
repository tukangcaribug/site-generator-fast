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

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
export class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
export function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', k: 0, text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, k: tok.t === 'var' ? 1 : 2, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', k: 4, name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', k: 3, not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', k: 5, name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
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

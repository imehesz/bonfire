// Tiny AST for Strudel code. Modules build expressions with these helpers and
// the printer turns them into REPL-ready source, wrapping long chains.

export class Expr {
  constructor(head, args = null, calls = []) {
    this.head = head; // identifier or literal text, e.g. 's', 'stack', 'sine'
    this.args = args; // null = bare identifier, [] = call with no args
    this.calls = calls; // [{ name, args }]
  }
  call(name, ...args) {
    return new Expr(this.head, this.args, [...this.calls, { name, args }]);
  }
  // Only add the call when cond is truthy — keeps generated code free of no-ops.
  callIf(cond, name, ...args) {
    return cond ? this.call(name, ...args) : this;
  }
}

// Raw code fragment (already valid source).
export class Raw {
  constructor(text) {
    this.text = text;
  }
}

export const raw = (text) => new Raw(text);
export const fn = (name, ...args) => new Expr(name, args);
export const ident = (name) => new Expr(name);
// Double-quoted string = mini-notation in the Strudel REPL.
export const mini = (s) => raw(JSON.stringify(String(s)));
// Single-quoted string = plain JS string in the REPL.
export const str = (s) => raw(`'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

export function num(v, digits = 3) {
  if (!Number.isFinite(v)) return raw('0');
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return raw(String(Object.is(r, -0) ? 0 : r));
}

// Arrow function argument, e.g. x => x.fast(2)
export const lambda = (bodyFromX) => ({ lambda: bodyFromX(ident('x')) });
// Arrow function with named params, e.g. (e, n) => e.gain(n)
export const arrow = (params, body) => ({ arrow: params, body });
// Object literal argument, e.g. { a: note("c"), b: note("e") }
export const obj = (entries) => ({ obj: entries });

const INDENT = '  ';
const MAX_INLINE = 64;

function argText(a, depth) {
  if (a instanceof Raw) return a.text;
  if (a instanceof Expr) return printExpr(a, depth);
  if (a && a.lambda) return `x => ${printExpr(a.lambda, depth)}`;
  if (a && a.arrow) return `(${a.arrow}) => ${printExpr(a.body, depth)}`;
  if (a && a.obj) {
    const parts = a.obj.map(([k, v]) => `${k}: ${argText(v, depth + 1)}`);
    const inline = `{ ${parts.join(', ')} }`;
    if (!inline.includes('\n') && inline.length <= MAX_INLINE) return inline;
    return `{\n${parts.map((p) => INDENT.repeat(depth + 1) + p).join(',\n')}\n${INDENT.repeat(depth)}}`;
  }
  if (typeof a === 'number') return num(a).text;
  if (typeof a === 'string') return JSON.stringify(a);
  return String(a);
}

function headText(e, depth) {
  if (e.args === null) return e.head;
  const parts = e.args.map((a) => argText(a, depth + 1));
  const inline = `${e.head}(${parts.join(', ')})`;
  if (!inline.includes('\n') && inline.length <= MAX_INLINE) return inline;
  const pad = INDENT.repeat(depth + 1);
  return `${e.head}(\n${parts.map((p) => pad + p).join(',\n')}\n${INDENT.repeat(depth)})`;
}

export function printExpr(e, depth = 0) {
  if (e instanceof Raw) return e.text;
  const head = headText(e, depth);
  const calls = e.calls.map((c) => `.${c.name}(${c.args.map((a) => argText(a, depth + 1)).join(', ')})`);
  const inline = head + calls.join('');
  if (!inline.includes('\n') && inline.length <= MAX_INLINE) return inline;
  if (!calls.length) return head;
  const pad = INDENT.repeat(depth + 1);
  return head + calls.map((c) => `\n${pad}${c}`).join('');
}

// formula.js - safe formula language (no eval / Function) + machine compiler.
//
// Language (BASIC flavoured, case-insensitive):
//   numbers   12  1.5  .0375  1E-3  1.5D2  25.4000508#  (suffix # = double, ! = single)
//   names     letters/digits/_ starting with a letter, optional type suffix # ! %
//   operators ^ (power, left-assoc like BASIC)  unary -  * /  + -
//             = <> < > <= >= (give -1 true / 0 false, like BASIC)  NOT AND OR
//   functions SIN COS TAN ATN(=ATAN) (radians), SIND COSD TAND ASIND ACOSD ATND (degrees),
//             ASIN ACOS SQR(=SQRT) ABS SGN INT FIX CINT ROUND EXP LOG CSNG CDBL MIN MAX
//             IF(cond, a, b)  -- only the chosen branch is evaluated
//   constant  PI
import { makeBackend } from './numeric.js';
import { BasicError } from './mbf.js';

export const FUNCTIONS = {
  SIN: 1, COS: 1, TAN: 1, ATN: 1, ATAN: 1, SQR: 1, SQRT: 1, EXP: 1, LOG: 1, ABS: 1, SGN: 1,
  INT: 1, FIX: 1, CINT: 1, CSNG: 1, CDBL: 1, ROUND: 1, ASIN: 1, ACOS: 1,
  SIND: 1, COSD: 1, TAND: 1, ASIND: 1, ACOSD: 1, ATND: 1, ATAND: 1,
  IF: 3, MIN: -2, MAX: -2,
};
const ALIASES = { ATAN: 'ATN', SQRT: 'SQR', ATAND: 'ATND' };
export const RESERVED = new Set([...Object.keys(FUNCTIONS), 'PI', 'AND', 'OR', 'NOT', 'MOD']);
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*[#!%]?$/;

export class FormulaError extends Error {
  constructor(msg, pos) { super(msg); this.pos = pos; }
}

// ------------------------------------------------------------------ tokenizer
export function tokenize(src, allowStrings = false) {
  const toks = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    let m;
    const rest = s.slice(i);
    if ((m = /^(\d+\.?\d*|\.\d+)([EeDd][+-]?\d+)?[!#]?/.exec(rest))) {
      toks.push({ k: 'num', v: m[0], pos: i }); i += m[0].length; continue;
    }
    if ((m = /^[A-Za-z][A-Za-z0-9_]*[#!%]?/.exec(rest))) {
      toks.push({ k: 'id', v: m[0].toUpperCase(), pos: i }); i += m[0].length; continue;
    }
    if (allowStrings && ch === '"') {
      const j = s.indexOf('"', i + 1);
      if (j < 0) throw new FormulaError('Missing closing quote', i);
      toks.push({ k: 'str', v: s.slice(i + 1, j), pos: i }); i = j + 1; continue;
    }
    if ((m = /^(<>|<=|>=|==|[-+*/^(),=<>;])/.exec(rest))) {
      toks.push({ k: 'op', v: m[0] === '==' ? '=' : m[0], pos: i }); i += m[0].length; continue;
    }
    throw new FormulaError(`Unexpected character "${ch}"`, i);
  }
  toks.push({ k: 'end', v: '', pos: s.length });
  return toks;
}

// ------------------------------------------------------------------ parser
class Parser {
  constructor(toks) { this.t = toks; this.i = 0; }
  peek() { return this.t[this.i]; }
  next() { return this.t[this.i++]; }
  isOp(v) { const p = this.peek(); return p.k === 'op' && p.v === v; }
  isWord(v) { const p = this.peek(); return p.k === 'id' && p.v === v; }
  expect(v) {
    const p = this.next();
    if (p.k !== 'op' || p.v !== v) throw new FormulaError(`Expected "${v}" but found ${p.k === 'end' ? 'end of formula' : '"' + p.v + '"'}`, p.pos);
  }
  parseExpr() { return this.parseOr(); }
  parseOr() { let a = this.parseAnd(); while (this.isWord('OR')) { this.next(); a = { k: 'bin', op: 'OR', a, b: this.parseAnd() }; } return a; }
  parseAnd() { let a = this.parseNot(); while (this.isWord('AND')) { this.next(); a = { k: 'bin', op: 'AND', a, b: this.parseNot() }; } return a; }
  parseNot() { if (this.isWord('NOT')) { this.next(); return { k: 'un', op: 'NOT', a: this.parseNot() }; } return this.parseRel(); }
  parseRel() {
    let a = this.parseAdd();
    while (['=', '<>', '<', '>', '<=', '>='].some((o) => this.isOp(o))) {
      const op = this.next().v; a = { k: 'bin', op, a, b: this.parseAdd() };
    }
    return a;
  }
  parseAdd() {
    let a = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) { const op = this.next().v; a = { k: 'bin', op, a, b: this.parseMul() }; }
    return a;
  }
  parseMul() {
    let a = this.parseNeg();
    while (this.isOp('*') || this.isOp('/')) { const op = this.next().v; a = { k: 'bin', op, a, b: this.parseNeg() }; }
    return a;
  }
  parseNeg() {
    if (this.isOp('-')) { this.next(); return { k: 'un', op: '-', a: this.parseNeg() }; }
    if (this.isOp('+')) { this.next(); return this.parseNeg(); }
    return this.parsePow();
  }
  parsePow() {
    let a = this.parsePrimary();
    while (this.isOp('^')) { this.next(); a = { k: 'bin', op: '^', a, b: this.parsePowOperand() }; }
    return a;
  }
  parsePowOperand() {
    if (this.isOp('-')) { this.next(); return { k: 'un', op: '-', a: this.parsePowOperand() }; }
    if (this.isOp('+')) { this.next(); return this.parsePowOperand(); }
    return this.parsePrimary();
  }
  parsePrimary() {
    const p = this.next();
    if (p.k === 'num') return { k: 'num', text: p.v, pos: p.pos };
    if (p.k === 'op' && p.v === '(') { const e = this.parseExpr(); this.expect(')'); return e; }
    if (p.k === 'id') {
      if (p.v === 'PI') { if (this.isOp('(')) { this.next(); this.expect(')'); } return { k: 'pi', pos: p.pos }; }
      if (p.v in FUNCTIONS) {
        if (!this.isOp('(')) throw new FormulaError(`${p.v} needs brackets, e.g. ${p.v}(x)`, p.pos);
        this.next();
        const args = [];
        if (!this.isOp(')')) { args.push(this.parseExpr()); while (this.isOp(',')) { this.next(); args.push(this.parseExpr()); } }
        this.expect(')');
        const n = FUNCTIONS[p.v];
        if (n > 0 && args.length !== n) throw new FormulaError(`${p.v} takes ${n} value${n > 1 ? 's' : ''}, got ${args.length}`, p.pos);
        if (n < 0 && args.length < -n) throw new FormulaError(`${p.v} needs at least ${-n} values`, p.pos);
        return { k: 'call', name: ALIASES[p.v] || p.v, args, pos: p.pos };
      }
      if (RESERVED.has(p.v)) throw new FormulaError(`"${p.v}" is a reserved word`, p.pos);
      return { k: 'var', name: p.v, pos: p.pos };
    }
    if (p.k === 'end') throw new FormulaError('Formula ends too early', p.pos);
    throw new FormulaError(`Unexpected "${p.v}"`, p.pos);
  }
}

export function parseFormula(src) {
  if (String(src).trim() === '') throw new FormulaError('Formula is empty', 0);
  const p = new Parser(tokenize(src));
  const ast = p.parseExpr();
  const t = p.peek();
  if (t.k !== 'end') throw new FormulaError(`Unexpected "${t.v}" after end of formula`, t.pos);
  return ast;
}

// BASIC PRINT list: items separated by ; or , e.g.  "R="; R, "C="; CC
export function parsePrintLine(src) {
  const toks = tokenize(src, true);
  const p = new Parser(toks);
  const items = [];
  while (p.peek().k !== 'end') {
    const t = p.peek();
    if (t.k === 'op' && (t.v === ';' || t.v === ',')) { p.next(); items.push({ sep: t.v }); continue; }
    if (t.k === 'str') { p.next(); items.push({ str: t.v }); continue; }
    items.push({ expr: p.parseExpr() });
  }
  return items;
}

export function refsOf(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.k === 'var') out.add(ast.name);
  if (ast.a) refsOf(ast.a, out);
  if (ast.b) refsOf(ast.b, out);
  if (ast.args) ast.args.forEach((x) => refsOf(x, out));
  if (ast.expr) refsOf(ast.expr, out);
  return out;
}

// ------------------------------------------------------------------ evaluator
export function evalAst(ast, env, num) {
  switch (ast.k) {
    case 'num': {
      const key = '_lit_' + num.id;
      if (!ast[key]) Object.defineProperty(ast, key, { value: num.lit(ast.text), enumerable: false });
      return ast[key];
    }
    case 'pi': return num.pi();
    case 'var': {
      if (!env.has(ast.name)) throw new FormulaError(`Unknown name "${ast.name}"`, ast.pos);
      return env.get(ast.name);
    }
    case 'un': {
      const a = evalAst(ast.a, env, num);
      return ast.op === '-' ? num.neg(a) : num.not(a);
    }
    case 'bin': {
      const a = evalAst(ast.a, env, num);
      const b = evalAst(ast.b, env, num);
      switch (ast.op) {
        case '+': return num.add(a, b);
        case '-': return num.sub(a, b);
        case '*': return num.mul(a, b);
        case '/': return num.div(a, b);
        case '^': return num.pow(a, b);
        case '=': return num.bool(num.eq(a, b));
        case '<>': return num.bool(num.ne(a, b));
        case '<': return num.bool(num.lt(a, b));
        case '>': return num.bool(num.gt(a, b));
        case '<=': return num.bool(num.le(a, b));
        case '>=': return num.bool(num.ge(a, b));
        case 'AND': return num.and(a, b);
        case 'OR': return num.or(a, b);
      }
      throw new FormulaError('bad operator ' + ast.op);
    }
    case 'call': {
      if (ast.name === 'IF') {
        const c = evalAst(ast.args[0], env, num);
        return evalAst(num.truthy(c) ? ast.args[1] : ast.args[2], env, num);
      }
      const vals = ast.args.map((x) => evalAst(x, env, num));
      if (ast.name === 'MIN' || ast.name === 'MAX') {
        return vals.reduce((m, v) => ((ast.name === 'MIN' ? num.lt(v, m) : num.gt(v, m)) ? v : m));
      }
      const f = num.fn[ast.name];
      if (!f) throw new FormulaError(`Function ${ast.name} not available`, ast.pos);
      return f(vals[0]);
    }
  }
  throw new FormulaError('bad node');
}

// BASIC PRINT formatting of one line (semicolon = no gap, comma = 14-column zones)
export function formatPrintLine(items, env, num, width = 80) {
  let out = '';
  const lines = [];
  for (const it of items) {
    if (it.sep === ';') continue;
    if (it.sep === ',') {
      const col = out.length + 1;
      const zones = Math.max(1, Math.floor(width / 14));
      const nextZone = Math.floor((col - 1) / 14) + 1;
      if (nextZone >= zones) { lines.push(out); out = ''; } else out += ' '.repeat(1 + 14 * nextZone - col);
      continue;
    }
    const word = it.str !== undefined ? it.str : num.format(evalAst(it.expr, env, num)) + ' ';
    // like the BASIC screen: a word that does not fit on the line starts a new line
    if (width && out.length > 0 && out.length + word.length > width) { lines.push(out); out = ''; }
    out += word;
    while (width && out.length > width) { lines.push(out.slice(0, width)); out = out.slice(width); }
  }
  lines.push(out);
  return lines.join('\n');
}

// ------------------------------------------------------------------ machines
export const sigilOf = (name) => (/[#!%]$/.test(name) ? name.slice(-1) : '!');
export const TRAIN_KINDS = ['index', 'differential', 'feed', 'other'];
export const STRATEGIES = ['legacy-ramgear', 'ranked', 'bc-breakdown'];

// Validate and compile a machine definition. Returns {ok, errors, warnings, ...}.
export function compileMachine(def) {
  const errors = [], warnings = [];
  const err = (where, msg) => errors.push({ where, msg });
  const symbols = new Map(); // NAME -> {kind, def}
  const formulas = new Map();
  if (!def || typeof def !== 'object') return { ok: false, errors: [{ where: 'machine', msg: 'Not a machine definition' }], warnings };
  if (!def.name || !String(def.name).trim()) err('machine', 'Machine needs a name');
  const addSym = (rawName, kind, d, where) => {
    const name = String(rawName || '').trim().toUpperCase();
    if (!name) { err(where, 'Missing name'); return null; }
    if (!NAME_RE.test(name)) { err(where, `"${rawName}" is not a valid name (letters, digits, _; start with a letter)`); return null; }
    if (RESERVED.has(name.replace(/[#!%]$/, ''))) { err(where, `"${name}" is a reserved word`); return null; }
    if (symbols.has(name)) { err(where, `Name "${name}" is used twice`); return null; }
    symbols.set(name, { kind, def: d });
    return name;
  };
  (def.inputs || []).forEach((inp, i) => {
    const where = `input ${inp.name || '#' + (i + 1)}`;
    const t = inp.type || 'number';
    if (!['number', 'choice', 'text'].includes(t)) err(where, `Unknown input type "${t}"`);
    if (t === 'choice' && !(Array.isArray(inp.options) && inp.options.length)) err(where, 'Choice input needs options');
    addSym(inp.name, t === 'text' ? 'text' : 'input', inp, where);
  });
  const fdefs = [...(def.constants || []).map((c) => ({ ...c, _kind: 'constant' })), ...(def.formulas || []).map((f) => ({ ...f, _kind: 'formula' }))];
  for (const f of fdefs) {
    const where = `${f._kind} ${f.name || '?'}`;
    const name = addSym(f.name, f._kind, f, where);
    if (!name) continue;
    try {
      const ast = parseFormula(f.expr);
      formulas.set(name, { name, ast, refs: refsOf(ast), def: f });
    } catch (e) {
      err(where, `Formula error: ${e.message}${e.pos !== undefined ? ` (at character ${e.pos + 1})` : ''}`);
    }
  }
  for (const f of formulas.values()) {
    for (const r of f.refs) {
      const s = symbols.get(r);
      if (!s) err(`${f.def._kind} ${f.name}`, `Unknown name "${r}" (not an input, constant or formula)`);
      else if (s.kind === 'text') err(`${f.def._kind} ${f.name}`, `"${r}" is a text field and cannot be used in a formula`);
    }
  }
  // topological order + cycle detection
  const order = [];
  const state = new Map();
  const visit = (n, stack) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) {
      const cyc = stack.slice(stack.indexOf(n)).concat(n);
      err(`formula ${n}`, `Circular reference: ${cyc.join(' → ')}`);
      return;
    }
    state.set(n, 1);
    const f = formulas.get(n);
    for (const r of f.refs) if (formulas.has(r)) visit(r, stack.concat(n));
    state.set(n, 2);
    order.push(n);
  };
  for (const n of formulas.keys()) visit(n, []);
  const outputs = (def.outputs || []).map((o, i) => {
    const name = String(o.name || '').toUpperCase();
    if (!symbols.has(name)) err(`output ${o.name || '#' + (i + 1)}`, `Unknown name "${o.name}"`);
    else if (symbols.get(name).kind === 'text') err(`output ${o.name}`, 'Text fields cannot be shown as results');
    return { ...o, name };
  });
  const report = [];
  (def.report || []).forEach((line, i) => {
    try {
      const items = parsePrintLine(line);
      for (const it of items) for (const r of refsOf(it.expr)) if (!symbols.has(r) || symbols.get(r).kind === 'text') err(`report line ${i + 1}`, `Unknown name "${r}"`);
      report.push(items);
    } catch (e) { err(`report line ${i + 1}`, e.message); }
  });
  (def.trains || []).forEach((t, i) => {
    const where = `gear train ${t.label || '#' + (i + 1)}`;
    if (!TRAIN_KINDS.includes(t.kind)) err(where, `Unknown train type "${t.kind}"`);
    if (!STRATEGIES.includes(t.strategy)) err(where, `Unknown search strategy "${t.strategy}"`);
    const names = t.strategy === 'bc-breakdown' ? (t.values || []) : [t.ratio];
    if (!names.length) err(where, 'Needs the name of the ratio to search for');
    for (const n of names) {
      const u = String(n || '').toUpperCase();
      if (!symbols.has(u) || symbols.get(u).kind === 'text') err(where, `Unknown ratio name "${n}"`);
    }
    if (t.strategy === 'ranked' && t.gears && ![2, 4].includes(Number(t.gears))) err(where, 'gears must be 2 or 4');
  });
  if (def.numeric && !['gwbasic', 'ieee-single', 'float64'].includes(def.numeric)) err('machine', `Unknown numeric mode "${def.numeric}"`);
  const usedInputs = new Set();
  for (const f of formulas.values()) f.refs.forEach((r) => usedInputs.add(r));
  for (const it of report) for (const x of it) refsOf(x.expr, usedInputs);
  outputs.forEach((o) => usedInputs.add(o.name));
  for (const [n, s] of symbols) if (s.kind === 'input' && !usedInputs.has(n)) warnings.push({ where: `input ${n}`, msg: 'Input is not used by any formula' });
  return { ok: errors.length === 0, errors, warnings, symbols, formulas, order, outputs, report, def };
}

// Evaluate a machine. inputs: {NAME: "text as typed"}; missing -> default.
export function evaluateMachine(def, inputs = {}, opts = {}) {
  const compiled = opts.compiled || compileMachine(def);
  if (!compiled.ok) return { ok: false, errors: compiled.errors.map((e) => `${e.where}: ${e.msg}`), warnings: [] };
  const warnings = [];
  const num = makeBackend(opts.numeric || def.numeric || 'gwbasic', { warn: (m) => warnings.push(m) });
  const env = new Map();
  const errors = [];
  const upInputs = {};
  for (const [k, v] of Object.entries(inputs || {})) upInputs[k.toUpperCase()] = v;
  for (const inp of def.inputs || []) {
    const name = inp.name.toUpperCase();
    if ((inp.type || 'number') === 'text') continue;
    let text = upInputs[name];
    if (text === undefined || text === null || (opts.useExamples && String(text).trim() === '')) {
      text = inp.default !== undefined ? inp.default : (opts.useExamples && inp.example !== undefined ? inp.example : '');
    }
    if (String(text).trim() === '' && !opts.blankIsZero) {
      errors.push(`${inp.label || name}: please enter a value`);
      continue;
    }
    try {
      env.set(name, num.input(String(text), sigilOf(name)));
    } catch (e) {
      errors.push(`${inp.label || name}: "${text}" is not a number${e.basicError ? ` (BASIC: ${e.basicError === 'Illegal function call' ? '?Redo from start' : e.basicError})` : ''}`);
    }
  }
  if (errors.length) return { ok: false, errors, warnings, env, num };
  for (const n of compiled.order) {
    const f = compiled.formulas.get(n);
    try {
      const before = warnings.length;
      env.set(n, num.assign(evalAst(f.ast, env, num), sigilOf(n)));
      for (let i = before; i < warnings.length; i++) warnings[i] = `${warnings[i]} while working out ${n}`;
    } catch (e) {
      errors.push(`${n}: ${e.basicError || e.message}`);
      return { ok: false, errors, warnings, env, num };
    }
  }
  const display = {};
  for (const [n] of env) display[n] = num.format(env.get(n));
  const reportText = compiled.report.map((items) => formatPrintLine(items, env, num));
  // v1.8.5: the same formulas in exact rational arithmetic, so index trains can be checked for ZERO error
  let exactEnv = null;
  if (!opts.noExact && num.id !== 'rational') {
    try { const ex = evaluateMachine(def, inputs, { ...opts, compiled, numeric: 'rational', noExact: true }); if (ex.ok) exactEnv = ex.env; } catch (e) { exactEnv = null; }
  }
  return { ok: true, errors, warnings, env, num, display, reportText, compiled, exactEnv };
}

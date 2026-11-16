// Shared label rendering used by the editor, the sheet preview and printing.
// Every length is expressed as a multiple of the CSS variable --u (size of one point),
// so the same DOM renders at any zoom on screen and at exactly 1pt per unit in print.
import { fontStack, ensureFont } from './fonts.js';
import { encodeBarcode } from './barcode.js';

export const U = v => `calc(var(--u) * ${Math.round(v * 1000) / 1000})`;

/* ------------------------------------------------------------ text templates
 * A text box's content is a template made of:
 *   plain text
 *   {{Column}}                    merge field
 *   {{#Column}} … {{/Column}}     shown only when Column has a value
 *   {{^Column}} … {{/Column}}     shown only when Column is empty
 *   <b> <i> <u> … </b> </i> </u>  bold / italic / underline for part of the text
 */
const PIECE = /(<\/?[biu]>)|\{\{\s*([^{}]+?)\s*\}\}/gi;

// Splits a template into text, field and section pieces, each carrying the style in effect
// and its position in the source. Style tags are tolerant of bad nesting.
export function parseTemplate(content) {
  const src = String(content ?? '');
  const pieces = [];
  const depth = { b: 0, i: 0, u: 0 };
  const style = () => ({ b: depth.b > 0, i: depth.i > 0, u: depth.u > 0 });
  let last = 0;
  for (const m of src.matchAll(PIECE)) {
    if (m.index > last) pieces.push({ kind: 'text', raw: src.slice(last, m.index), start: last, ...style() });
    last = m.index + m[0].length;
    if (m[1]) {
      const k = m[1].replace(/[<>/]/g, '').toLowerCase();
      depth[k] = Math.max(0, depth[k] + (m[1][1] === '/' ? -1 : 1));
      pieces.push({ kind: 'tag', raw: m[0], start: m.index });
    } else {
      const name = m[2];
      const op = '#^/'.includes(name[0]) ? name[0] : '';
      if (op) pieces.push({ kind: 'sec', op, name: name.slice(1).trim(), raw: m[0], start: m.index });
      else pieces.push({ kind: 'field', name, raw: m[0], start: m.index, ...style() });
    }
  }
  if (last < src.length) pieces.push({ kind: 'text', raw: src.slice(last), start: last, ...style() });
  return pieces;
}

// Resolves fields and conditional sections for one row.
// Returns lines, each a list of runs: [{ text, b, i, u }].
export function mergeRuns(content, row, removeBlank) {
  const lines = [{ runs: [], hadField: false }];
  const open = []; // stack of { name, show }
  const add = (text, p) => {
    const parts = String(text).split('\n');
    parts.forEach((part, n) => {
      if (n > 0) lines.push({ runs: [], hadField: false });
      if (part) lines[lines.length - 1].runs.push({ text: part, b: p.b, i: p.i, u: p.u });
    });
  };
  for (const p of parseTemplate(content)) {
    const visible = open.every(s => s.show);
    if (p.kind === 'sec') {
      if (visible) lines[lines.length - 1].hadField = true;
      if (p.op === '/') {
        const at = open.map(s => s.name).lastIndexOf(p.name);
        if (at >= 0) open.length = at;
      } else {
        const filled = String(row?.[p.name] ?? '').trim() !== '';
        open.push({ name: p.name, show: p.op === '#' ? filled : !filled });
      }
    } else if (!visible || p.kind === 'tag') {
      continue;
    } else if (p.kind === 'field') {
      lines[lines.length - 1].hadField = true;
      add(row?.[p.name] ?? '', p);
    } else add(p.raw, p);
  }
  const text = l => l.runs.map(r => r.text).join('');
  return (removeBlank ? lines.filter(l => !(l.hadField && !text(l).trim())) : lines).map(l => l.runs);
}

export function mergeText(content, row, removeBlank) {
  return mergeRuns(content, row, removeBlank).map(runs => runs.map(r => r.text).join('')).join('\n');
}

function styled(node, p) {
  if (p.b) node.style.fontWeight = '700';
  if (p.i) node.style.fontStyle = 'italic';
  if (p.u) node.style.textDecoration = 'underline';
  return node;
}
function span(text, p) {
  if (!p.b && !p.i && !p.u) return document.createTextNode(text);
  const s = document.createElement('span');
  s.textContent = text;
  return styled(s, p);
}

function appendRuns(target, lines) {
  lines.forEach((runs, n) => {
    if (n > 0) target.append('\n');
    for (const r of runs) target.append(span(r.text, r));
  });
}

// Editor view of the raw template: merge fields and conditions shown as chips.
function appendChips(target, content) {
  for (const p of parseTemplate(content)) {
    if (p.kind === 'tag') continue;
    if (p.kind === 'text') { target.append(span(p.raw, p)); continue; }
    const chip = document.createElement('span');
    chip.className = 'chip';
    if (p.kind === 'sec') {
      chip.classList.add('cond');
      chip.textContent = p.op === '#' ? `if ${p.name}:` : p.op === '^' ? `if no ${p.name}:` : 'end if';
    } else {
      chip.textContent = p.name;
      styled(chip, p);
    }
    target.append(chip);
  }
}

/* ----------------------------------------------------------------- elements */

export function placeNode(node, el) {
  node.style.left = U(el.x);
  node.style.top = U(el.y);
  node.style.width = U(el.w);
  node.style.height = U(el.h);
}

const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const SVG_NS = 'http://www.w3.org/2000/svg';

function placeholder(label, chipText) {
  const ph = document.createElement('div');
  ph.className = 'img-placeholder';
  ph.append(label);
  if (chipText) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = chipText;
    ph.append(' ', chip);
  }
  return ph;
}

function barcodeSvg(code, color) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const path = document.createElementNS(SVG_NS, 'path');
  let d = '';
  if (code.kind === 'matrix') {
    const q = code.quiet, n = code.size + q * 2;
    svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
    code.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        let w = 1;
        while (row[x + w]) w++;
        d += `M${x + q} ${y + q}h${w}v1h-${w}z`;
        x += w - 1;
      }
    });
  } else {
    const q = code.quiet, bits = code.bits;
    svg.setAttribute('viewBox', `0 0 ${bits.length + q * 2} 1`);
    svg.setAttribute('preserveAspectRatio', 'none'); // bars stretch to fill the box
    for (let x = 0; x < bits.length; x++) {
      if (bits[x] !== '1') continue;
      let w = 1;
      while (bits[x + w] === '1') w++;
      d += `M${x + q} 0h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  path.setAttribute('d', d);
  path.setAttribute('fill', color || '#000');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.append(path);
  return svg;
}

// ctx: { editor, showNames, resolveImage(el, row) }
export function buildElementNode(el, row, ctx) {
  const node = document.createElement('div');
  node.className = 'el el-' + el.type;
  placeNode(node, el);

  if (el.type === 'text') {
    ensureFont(el.fontFamily);
    const t = document.createElement('div');
    t.className = 'txt';
    node.style.justifyContent = VALIGN[el.valign] || 'flex-start';
    Object.assign(t.style, {
      fontFamily: fontStack(el.fontFamily),
      fontSize: U(el.fontSize),
      fontWeight: el.bold ? '700' : '400',
      fontStyle: el.italic ? 'italic' : 'normal',
      textDecoration: el.underline ? 'underline' : 'none',
      color: el.color,
      textAlign: el.align,
      lineHeight: String(el.lineHeight),
    });
    if (ctx.editor && (ctx.showNames || !row)) {
      appendChips(t, el.content);
    } else {
      const lines = mergeRuns(el.content, row, el.removeBlank);
      const empty = !lines.some(runs => runs.some(r => r.text.trim()));
      if (empty && ctx.editor) { appendChips(t, el.content); node.classList.add('ghost'); }
      else appendRuns(t, lines);
    }
    if (el.shrink) { node.dataset.fit = el.fontSize; t.classList.add('nowrapword'); }
    node.append(t);
  } else if (el.type === 'image') {
    const src = ctx.resolveImage(el, row);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.draggable = false;
      img.style.objectFit = el.fit;
      node.append(img);
    } else if (ctx.editor) {
      node.append(placeholder('Image', el.source === 'column' ? el.column : ''));
    }
  } else if (el.type === 'barcode') {
    const value = mergeText(el.content, row, false).replace(/\s*\n\s*/g, ' ').trim();
    const code = value ? encodeBarcode(el.format, value) : null;
    if (code?.ok) {
      node.append(barcodeSvg(code, el.color));
      if (el.showText && code.kind !== 'matrix') {
        const cap = document.createElement('div');
        cap.className = 'bar-text';
        cap.textContent = code.text;
        cap.style.fontSize = U(el.textSize);
        cap.style.color = el.color;
        node.append(cap);
      }
    } else if (ctx.editor) {
      // Nothing is printed for an empty or unencodable value; the editor explains why.
      const fields = parseTemplate(el.content).filter(p => p.kind === 'field').map(p => p.name).join(', ');
      node.append(value ? placeholder(`Can't make this barcode from "${value}"`) : placeholder('Barcode', fields));
      if (value) node.classList.add('invalid');
    }
  }
  return node;
}

// Shrinks the font of auto-fit text boxes until their content fits the box.
export function fitAll(root) {
  for (const node of root.querySelectorAll('[data-fit]')) {
    const t = node.firstElementChild;
    const size = +node.dataset.fit;
    const overflows = () =>
      t.offsetHeight > node.clientHeight + 0.5 || t.scrollWidth > node.clientWidth + 0.5;
    t.style.fontSize = U(size);
    if (!overflows()) continue;
    let lo = Math.min(2, size), hi = size;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      t.style.fontSize = U(mid);
      if (overflows()) hi = mid; else lo = mid;
    }
    t.style.fontSize = U(lo);
  }
}

/* ------------------------------------------------- styling part of a template */

// Toggles bold/italic/underline ('b' | 'i' | 'u') on the range [from, to) of a template.
// A range that cuts into a merge field, condition or tag grows to cover all of it, so a merge
// field is always styled as a whole. Returns { content, from, to } with the range's new position.
export function toggleRangeStyle(content, from, to, key) {
  let pieces = parseTemplate(content);
  for (const p of pieces) {
    if (p.kind === 'text') continue;
    const end = p.start + p.raw.length;
    if (from > p.start && from < end) from = p.start;
    if (to > p.start && to < end) to = end;
  }
  // Split text pieces at the range edges so every piece is wholly inside or outside.
  pieces = pieces.flatMap(p => {
    if (p.kind !== 'text') return [p];
    const cuts = [from, to].map(c => c - p.start).filter(c => c > 0 && c < p.raw.length);
    const out = [];
    let at = 0;
    for (const c of [...new Set(cuts)].sort((a, b) => a - b).concat(p.raw.length)) {
      out.push({ ...p, raw: p.raw.slice(at, c), start: p.start + at });
      at = c;
    }
    return out;
  });
  const inRange = p => p.start >= from && p.start + p.raw.length <= to;
  const targets = pieces.filter(p => (p.kind === 'text' || p.kind === 'field') && inRange(p));
  if (!targets.length) return { content, from, to };
  const on = !targets.every(p => p[key]);
  for (const p of targets) p[key] = on;

  // Re-serialise, writing tags only where the style changes.
  let out = '', outFrom = null, outTo = null;
  const openTags = [];
  const setStyle = want => {
    const drop = openTags.findIndex(k => !want[k]);
    if (drop >= 0) for (const k of openTags.splice(drop).reverse()) out += `</${k}>`;
    for (const k of ['b', 'i', 'u']) if (want[k] && !openTags.includes(k)) { openTags.push(k); out += `<${k}>`; }
  };
  for (const p of pieces) {
    if (p.kind === 'tag') continue;
    // Conditions carry no style; leave tags alone around them unless nothing follows.
    if (p.kind !== 'sec') setStyle(p);
    if (inRange(p) && outFrom === null) outFrom = out.length;
    out += p.raw;
    if (inRange(p)) outTo = out.length;
  }
  setStyle({});
  return { content: out, from: outFrom ?? out.length, to: outTo ?? out.length };
}

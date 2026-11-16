// Shared label rendering used by the editor, the sheet preview and printing.
// Every length is expressed as a multiple of the CSS variable --u (size of one point),
// so the same DOM renders at any zoom on screen and at exactly 1pt per unit in print.
import { fontStack, ensureFont } from './fonts.js';

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export const U = v => `calc(var(--u) * ${Math.round(v * 1000) / 1000})`;

export function mergeText(content, row, removeBlank) {
  const out = [];
  for (const line of String(content).split('\n')) {
    let hadField = false;
    const s = line.replace(TOKEN, (m, key) => { hadField = true; return row?.[key] ?? ''; });
    if (removeBlank && hadField && !s.trim()) continue;
    out.push(s);
  }
  return out.join('\n');
}

function appendChips(target, content) {
  let last = 0;
  for (const m of String(content).matchAll(TOKEN)) {
    if (m.index > last) target.append(content.slice(last, m.index));
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = m[1];
    target.append(chip);
    last = m.index + m[0].length;
  }
  if (last < content.length) target.append(content.slice(last));
}

export function placeNode(node, el) {
  node.style.left = U(el.x);
  node.style.top = U(el.y);
  node.style.width = U(el.w);
  node.style.height = U(el.h);
}

const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

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
      const s = mergeText(el.content, row, el.removeBlank);
      if (!s.trim() && ctx.editor) { appendChips(t, el.content); node.classList.add('ghost'); }
      else t.textContent = s;
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
      const ph = document.createElement('div');
      ph.className = 'img-placeholder';
      if (el.source === 'column' && el.column) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = el.column;
        ph.append('Image: ', chip);
      } else ph.textContent = 'Image';
      node.append(ph);
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

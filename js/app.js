import { TEMPLATES, TEMPLATE_GROUPS, IN, MM } from './templates.js';
import { parseCSV } from './csv.js';
import { buildElementNode, placeNode, fitAll, U, toggleRangeStyle } from './render.js';
import { BARCODE_FORMATS } from './barcode.js';
import {
  SYSTEM_FONTS, GOOGLE_FONTS, fontStack, setFontLoadCallback, registerCustomFont, whenFontsReady,
} from './fonts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PX_PER_PT = 96 / 72;
const MIN_SIZE = 4; // pt
const MAX_PREVIEW_PAGES = 10;
const KEY_DESIGN = 'labelgen.design.v1';
const KEY_DATA = 'labelgen.data.v1';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uid = () => 'e' + Math.random().toString(36).slice(2, 9);

function newDesign() {
  return {
    version: 1,
    templateId: '5160',
    custom: null,
    elements: [],
    fonts: [],   // [{ name, assetId }]
    assets: {},  // id -> data URL (images and uploaded fonts)
    print: { outline: false, startAt: 1, copies: 1, offsetX: 0, offsetY: 0 },
  };
}

const state = {
  design: newDesign(),
  data: { raw: '', fileName: '', hasHeader: true, headers: [], records: [] },
  imageLib: new Map(), // lower-cased file name -> object URL
  sel: [], // ids of the selected elements
  record: 0,
  zoom: 'fit',
  view: 'design',
  showNames: false,
  snap: true,
};

const labelEl = $('#label');
const overlay = $('#overlay');
const stage = $('#stage');

/* ------------------------------------------------------------------ helpers */

function getTpl() {
  const d = state.design;
  if (d.templateId === 'custom' && d.custom) return { ...d.custom, id: 'custom', name: 'Custom' };
  return TEMPLATES.find(t => t.id === d.templateId) || TEMPLATES[0];
}
const unitK = () => (getTpl().unit === 'mm' ? MM : IN);
const toUnit = pt => +(pt / unitK()).toFixed(getTpl().unit === 'mm' ? 1 : 3);
const fromUnit = v => (parseFloat(v) || 0) * unitK();
const selection = () => state.design.elements.filter(e => state.sel.includes(e.id));
// The selected element when exactly one is selected (single-element editing).
const selected = () => { const s = selection(); return s.length === 1 ? s[0] : null; };
const groupOf = el => (el.group ? state.design.elements.filter(e => e.group === el.group) : [el]);
function bounds(els) {
  const x = Math.min(...els.map(e => e.x)), y = Math.min(...els.map(e => e.y));
  return { x, y, w: Math.max(...els.map(e => e.x + e.w)) - x, h: Math.max(...els.map(e => e.y + e.h)) - y };
}
// Selected elements split into units that move together: whole groups, or single boxes.
function selectionUnits() {
  const units = new Map();
  for (const el of selection()) {
    const key = el.group || el.id;
    if (!units.has(key)) units.set(key, []);
    units.get(key).push(el);
  }
  return [...units.values()];
}
const currentRow = () => state.data.records[state.record] || null;

function currentU() {
  if (state.zoom !== 'fit') return state.zoom * PX_PER_PT;
  const t = getTpl();
  const availW = Math.max(120, stage.clientWidth - 100);
  const availH = Math.max(120, stage.clientHeight - 140);
  return clamp(Math.min(availW / t.w, availH / t.h), 0.3, 4 * PX_PER_PT);
}

function resolveImage(el, row) {
  if (el.source === 'static') return state.design.assets[el.assetId] || null;
  const v = String(row?.[el.column] ?? '').trim();
  if (!v) return null;
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(v)) return v;
  const base = v.split(/[\\/]/).pop().toLowerCase();
  return state.imageLib.get(base) || state.imageLib.get(base.replace(/\.[a-z0-9]+$/, '')) || null;
}

const readFile = (file, as) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  as === 'text' ? r.readAsText(file) : r.readAsDataURL(file);
});

// Keeps embedded images to a size that still prints sharply but saves quickly.
async function imageToDataUrl(file, maxDim = 1800) {
  const url = await readFile(file);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return url;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return url; }
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && url.length < 1_500_000) return url;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return file.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
}

function pickFile(input) {
  return new Promise(resolve => {
    input.value = '';
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

/* ------------------------------------------------------------- persistence */

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY_DESIGN, JSON.stringify(state.design)); }
    catch { /* over quota (large images): the design can still be saved to a file */ }
  }, 400);
}
function saveData() {
  try {
    const { raw, fileName, hasHeader } = state.data;
    if (raw.length < 1_500_000) localStorage.setItem(KEY_DATA, JSON.stringify({ raw, fileName, hasHeader }));
    else localStorage.removeItem(KEY_DATA);
  } catch { /* ignore */ }
}

function normalizeDesign(d) {
  const base = newDesign();
  const out = { ...base, ...d, print: { ...base.print, ...(d.print || {}) } };
  out.elements = Array.isArray(d.elements) ? d.elements : [];
  out.assets = d.assets || {};
  out.fonts = Array.isArray(d.fonts) ? d.fonts : [];
  if (out.templateId !== 'custom' && !TEMPLATES.some(t => t.id === out.templateId)) out.templateId = '5160';
  if (out.templateId === 'custom' && !out.custom) out.templateId = '5160';
  return out;
}

async function registerDesignFonts() {
  for (const f of state.design.fonts) {
    const data = state.design.assets[f.assetId];
    if (data) await registerCustomFont(f.name, data).catch(() => {});
  }
}

function usedAssets() {
  const d = state.design, keep = {};
  for (const el of d.elements) if (el.type === 'image' && d.assets[el.assetId]) keep[el.assetId] = d.assets[el.assetId];
  for (const f of d.fonts) if (d.assets[f.assetId]) keep[f.assetId] = d.assets[f.assetId];
  return keep;
}

function downloadDesign() {
  const payload = { app: 'label-generator', design: { ...state.design, assets: usedAssets() } };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  a.download = 'label-design.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function openDesignText(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { alert('That file is not a valid label design.'); return; }
  const d = parsed?.design;
  if (!d || !Array.isArray(d.elements)) { alert('That file is not a valid label design.'); return; }
  state.design = normalizeDesign(d);
  state.sel = [];
  await registerDesignFonts();
  resetHistory();
  refreshAll();
}

/* ------------------------------------------------------------------ history */

const hist = { stack: [], idx: -1, timer: null };
function snapshot() {
  const { assets, ...rest } = state.design;
  return JSON.stringify(rest);
}
function pushHistory() {
  clearTimeout(hist.timer);
  hist.timer = null;
  const s = snapshot();
  if (hist.stack[hist.idx] === s) return;
  hist.stack.length = hist.idx + 1;
  hist.stack.push(s);
  if (hist.stack.length > 100) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  updateUndoButtons();
}
function scheduleHistory() {
  clearTimeout(hist.timer);
  hist.timer = setTimeout(pushHistory, 400);
}
function resetHistory() {
  hist.stack = [];
  hist.idx = -1;
  pushHistory();
}
function stepHistory(dir) {
  if (hist.timer) pushHistory();
  const idx = hist.idx + dir;
  if (idx < 0 || idx >= hist.stack.length) return;
  hist.idx = idx;
  Object.assign(state.design, JSON.parse(hist.stack[idx]));
  state.sel = selection().map(e => e.id);
  refreshAll({ history: false });
}
function updateUndoButtons() {
  $('#btnUndo').disabled = hist.idx <= 0;
  $('#btnRedo').disabled = hist.idx >= hist.stack.length - 1;
}

/* ---------------------------------------------------------- change plumbing */

// Call after any edit to the design.
function changed({ history = true } = {}) {
  renderEditor();
  const editing = $('.inline-edit', overlay);
  const editingEl = editing && state.design.elements.find(e => e.id === editing.dataset.id);
  if (editingEl) { placeNode(editing, editingEl); styleInlineEdit(editing, editingEl); }
  syncProps();
  if (state.view === 'sheets') renderSheets();
  scheduleSave();
  if (history === 'debounce') scheduleHistory();
  else if (history) pushHistory();
  updateUndoButtons();
}

function refreshAll(opts) {
  syncTemplateUI();
  syncFontList();
  syncColumns();
  syncPrintUI();
  changed(opts);
}

/* ------------------------------------------------------------------- editor */

const editorCtx = () => ({ editor: true, showNames: state.showNames, resolveImage });

function renderEditor() {
  const t = getTpl();
  const u = currentU();
  const wrap = $('#labelWrap');
  wrap.style.setProperty('--u', u + 'px');
  wrap.style.width = labelEl.style.width = t.w * u + 'px';
  wrap.style.height = labelEl.style.height = t.h * u + 'px';
  labelEl.classList.toggle('round', t.shape === 'round');

  const row = currentRow();
  const ctx = editorCtx();
  labelEl.replaceChildren(...state.design.elements.map(el => {
    const node = buildElementNode(el, row, ctx);
    node.dataset.id = el.id;
    return node;
  }));
  fitAll(labelEl);
  renderSelection();

  $('#emptyHint').hidden = state.design.elements.length > 0;
  $('#zoomLabel').textContent = Math.round((u / PX_PER_PT) * 100) + '%';
  const n = state.data.records.length;
  $('#recLabel').textContent = n ? `Record ${state.record + 1} of ${n}` : 'No data';
  $('#btnPrev').disabled = !n || state.record === 0;
  $('#btnNext').disabled = !n || state.record >= n - 1;
}

const HANDLES = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
const CURSORS = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };

function renderSelection() {
  $$('.sel', overlay).forEach(n => n.remove());
  const els = selection();
  for (const el of els) {
    const box = document.createElement('div');
    box.className = 'sel';
    placeNode(box, el);
    if (els.length === 1) {
      for (const [name, [x, y]] of Object.entries(HANDLES)) {
        const h = document.createElement('div');
        h.className = 'h';
        h.dataset.h = name;
        h.style.left = x + '%';
        h.style.top = y + '%';
        h.style.cursor = CURSORS[name] + '-resize';
        box.append(h);
      }
    }
    overlay.append(box);
  }
  if (els.length > 1) {
    const box = document.createElement('div');
    box.className = 'sel bbox';
    placeNode(box, bounds(els));
    overlay.append(box);
  }
}

function setSelection(ids) {
  state.sel = [...new Set(ids)];
  renderSelection();
  syncProps();
}

function showGuides(vx, hy) {
  $$('.guide', overlay).forEach(n => n.remove());
  if (vx != null) { const g = document.createElement('div'); g.className = 'guide v'; g.style.left = U(vx); overlay.append(g); }
  if (hy != null) { const g = document.createElement('div'); g.className = 'guide hz'; g.style.top = U(hy); overlay.append(g); }
}

// Returns the smallest correction that aligns one of `points` with a snap target.
function snapDelta(points, targets, threshold) {
  let best = null;
  for (const p of points) for (const t of targets) {
    const d = t - p;
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
  }
  return best;
}

function trackPointer(onMove, onUp) {
  const end = ev => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onUp(ev);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function snapTargets(moving) {
  const t = getTpl();
  const others = state.design.elements.filter(o => !moving.includes(o));
  return {
    tx: [0, t.w / 2, t.w, ...others.flatMap(o => [o.x, o.x + o.w / 2, o.x + o.w])],
    ty: [0, t.h / 2, t.h, ...others.flatMap(o => [o.y, o.y + o.h / 2, o.y + o.h])],
  };
}

// Drags the whole selection. `onClick` runs instead if the pointer never moved.
function startMove(e, onClick) {
  e.preventDefault();
  document.activeElement?.blur?.();
  const t = getTpl();
  const u = currentU();
  const els = selection();
  const starts = els.map(o => ({ o, x: o.x, y: o.y, node: labelEl.querySelector(`[data-id="${o.id}"]`) }));
  const bb = bounds(els);
  const { tx, ty } = snapTargets(els);
  let moved = false;

  trackPointer(ev => {
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
    moved = true;
    let x = bb.x + (ev.clientX - e.clientX) / u;
    let y = bb.y + (ev.clientY - e.clientY) / u;
    let gx = null, gy = null;
    if (state.snap && !ev.altKey) {
      const thr = 5 / u;
      const sx = snapDelta([x, x + bb.w / 2, x + bb.w], tx, thr);
      const sy = snapDelta([y, y + bb.h / 2, y + bb.h], ty, thr);
      if (sx) { x += sx.d; gx = sx.at; }
      if (sy) { y += sy.d; gy = sy.at; }
    }
    x = clamp(x, 0, Math.max(0, t.w - bb.w));
    y = clamp(y, 0, Math.max(0, t.h - bb.h));
    for (const s of starts) {
      s.o.x = s.x + x - bb.x;
      s.o.y = s.y + y - bb.y;
      placeNode(s.node, s.o);
    }
    renderSelection();
    showGuides(gx, gy);
    syncProps();
  }, () => {
    showGuides(null, null);
    if (moved) changed(); else onClick?.();
  });
}

function startResize(e, el, mode) {
  e.preventDefault();
  document.activeElement?.blur?.();
  const t = getTpl();
  const u = currentU();
  const start = { x: el.x, y: el.y, w: el.w, h: el.h };
  const { tx, ty } = snapTargets([el]);
  const node = labelEl.querySelector(`[data-id="${el.id}"]`);
  const selBox = $('.sel', overlay);
  let moved = false;

  trackPointer(ev => {
    const dx = (ev.clientX - e.clientX) / u;
    const dy = (ev.clientY - e.clientY) / u;
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
    moved = true;
    const snapOn = state.snap && !ev.altKey;
    const thr = 5 / u;
    let gx = null, gy = null;
    let l = start.x, r = start.x + start.w, tp = start.y, b = start.y + start.h;
    if (mode.includes('w')) l += dx;
    if (mode.includes('e')) r += dx;
    if (mode.includes('n')) tp += dy;
    if (mode.includes('s')) b += dy;
    if (snapOn) {
      if (mode.includes('w')) { const s = snapDelta([l], tx, thr); if (s) { l = s.at; gx = s.at; } }
      if (mode.includes('e')) { const s = snapDelta([r], tx, thr); if (s) { r = s.at; gx = s.at; } }
      if (mode.includes('n')) { const s = snapDelta([tp], ty, thr); if (s) { tp = s.at; gy = s.at; } }
      if (mode.includes('s')) { const s = snapDelta([b], ty, thr); if (s) { b = s.at; gy = s.at; } }
    }
    l = mode.includes('w') ? clamp(l, 0, start.x + start.w - MIN_SIZE) : start.x;
    tp = mode.includes('n') ? clamp(tp, 0, start.y + start.h - MIN_SIZE) : start.y;
    r = clamp(r, start.x + MIN_SIZE, t.w);
    b = clamp(b, start.y + MIN_SIZE, t.h);
    Object.assign(el, { x: l, y: tp, w: r - l, h: b - tp });
    placeNode(node, el);
    placeNode(selBox, el);
    fitAll(labelEl);
    showGuides(gx, gy);
    syncProps();
  }, () => {
    showGuides(null, null);
    if (moved) changed();
  });
}

// Rubber-band selection started on an empty part of the label.
function startMarquee(e, base) {
  e.preventDefault();
  document.activeElement?.blur?.();
  const rect = labelEl.getBoundingClientRect();
  const u = currentU();
  const x0 = (e.clientX - rect.left) / u, y0 = (e.clientY - rect.top) / u;
  const box = document.createElement('div');
  box.className = 'marquee';
  let shown = false;
  trackPointer(ev => {
    const x1 = (ev.clientX - rect.left) / u, y1 = (ev.clientY - rect.top) / u;
    const m = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    if (!shown && Math.max(m.w, m.h) * u < 3) return;
    if (!shown) { overlay.append(box); shown = true; }
    placeNode(box, m);
    const hits = state.design.elements
      .filter(o => o.x < m.x + m.w && o.x + o.w > m.x && o.y < m.y + m.h && o.y + o.h > m.y)
      .flatMap(groupOf);
    setSelection([...base, ...hits.map(o => o.id)]);
  }, () => box.remove());
}

labelEl.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const node = e.target.closest('.el');
  if (!node) {
    if (!additive) setSelection([]);
    startMarquee(e, additive ? [...state.sel] : []);
    return;
  }
  const el = state.design.elements.find(x => x.id === node.dataset.id);
  const ids = groupOf(el).map(o => o.id);
  const allIn = ids.every(id => state.sel.includes(id));
  if (additive) { // Ctrl/Cmd/Shift+click adds or removes the box (with its group)
    e.preventDefault();
    setSelection(allIn ? state.sel.filter(id => !ids.includes(id)) : [...state.sel, ...ids]);
    return;
  }
  if (!state.sel.includes(el.id)) { setSelection(ids); startMove(e); return; }
  // A plain click on something already selected narrows the selection:
  // from several boxes to this one's group, and from a group to this one box.
  const wholeGroupOnly = allIn && state.sel.length === ids.length;
  startMove(e, () => { if (state.sel.length > 1) setSelection(wholeGroupOnly ? [el.id] : ids); });
});
overlay.addEventListener('pointerdown', e => {
  const h = e.target.closest('.h');
  const el = selected();
  if (h && el && e.button === 0) startResize(e, el, h.dataset.h);
});
stage.addEventListener('pointerdown', e => {
  if (e.target === stage || e.target.id === 'labelWrap') setSelection([]);
});
labelEl.addEventListener('dblclick', e => {
  const node = e.target.closest('.el');
  const el = node && state.design.elements.find(x => x.id === node.dataset.id);
  if (!el) return;
  if (el.type === 'text') startInlineEdit(el);
  else if (el.source === 'static') chooseStaticImage(el);
});

function styleInlineEdit(ta, el) {
  Object.assign(ta.style, {
    fontFamily: fontStack(el.fontFamily),
    fontSize: U(el.fontSize),
    fontWeight: el.bold ? '700' : '400',
    fontStyle: el.italic ? 'italic' : 'normal',
    textDecoration: el.underline ? 'underline' : 'none',
    color: el.color,
    textAlign: el.align,
    lineHeight: String(el.lineHeight),
  });
}

function startInlineEdit(el) {
  $('.inline-edit', overlay)?.remove();
  const ta = document.createElement('textarea');
  ta.className = 'inline-edit';
  ta.spellcheck = false;
  ta.value = el.content;
  placeNode(ta, el);
  ta.dataset.id = el.id;
  styleInlineEdit(ta, el);
  overlay.append(ta);
  ta.focus();
  ta.select();
  let cancelled = false;
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { cancelled = true; ta.blur(); }
    else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) ta.blur();
  });
  ta.addEventListener('blur', () => {
    if (!cancelled && ta.value !== el.content) { el.content = ta.value; changed(); }
    ta.remove();
  });
}

/* --------------------------------------------------------- adding elements */

function labelMargin() {
  const t = getTpl();
  return t.shape === 'round' ? t.w * 0.16 : Math.min(6, t.h * 0.08);
}
function defaultFontSize() {
  return clamp(Math.round(getTpl().h / 7), 6, 12);
}

function addElement(el) {
  state.design.elements.push(el);
  state.sel = [el.id];
  changed();
}

function makeText(content, at) {
  const t = getTpl();
  const m = labelMargin();
  const fontSize = defaultFontSize();
  const h = Math.min(t.h, Math.ceil(fontSize * 1.3));
  let x = m, w = Math.max(MIN_SIZE, t.w - 2 * m), y;
  if (at) {
    w = Math.min(w, Math.max(t.w * 0.45, 72));
    x = clamp(at.x - w / 2, 0, t.w - w);
    y = clamp(at.y - h / 2, 0, t.h - h);
  } else {
    const els = state.design.elements;
    const bottom = els.length ? Math.max(...els.map(e => e.y + e.h)) : m - 1;
    y = bottom + 1;
    if (y + h > t.h - 0.5) y = clamp(m + (els.length % 6) * 4, 0, t.h - h);
  }
  return {
    id: uid(), type: 'text', x, y, w, h, content,
    fontFamily: 'Arial', fontSize, bold: false, italic: false, underline: false,
    color: '#000000', align: 'left', valign: 'middle', lineHeight: 1.15,
    shrink: true, removeBlank: true,
  };
}

function makeImage(props, at) {
  const t = getTpl();
  const m = labelMargin();
  const size = Math.max(MIN_SIZE, Math.min(t.h - 2 * m, t.w / 3));
  const x = at ? clamp(at.x - size / 2, 0, t.w - size) : m;
  const y = at ? clamp(at.y - size / 2, 0, t.h - size) : clamp(m, 0, t.h - size);
  return { id: uid(), type: 'image', x, y, w: size, h: size, source: 'static', assetId: null, column: '', fit: 'contain', ...props };
}

function makeBarcode(content) {
  const t = getTpl();
  const m = labelMargin();
  const w = Math.max(MIN_SIZE, Math.min(t.w - 2 * m, 150));
  const h = Math.max(MIN_SIZE, Math.min(t.h - 2 * m, 44));
  return {
    id: uid(), type: 'barcode', x: clamp((t.w - w) / 2, 0, t.w - w), y: clamp(t.h - h - m, 0, t.h - h), w, h,
    format: 'CODE128', content, showText: true, textSize: 7, color: '#000000',
  };
}

async function chooseStaticImage(el) {
  const [file] = await pickFile($('#fileImg'));
  if (!file) return false;
  const id = uid();
  state.design.assets[id] = await imageToDataUrl(file);
  el.assetId = id;
  el.source = 'static';
  changed();
  return true;
}

$('#btnAddText').onclick = () => {
  const el = makeText('Text');
  addElement(el);
  startInlineEdit(el);
};
$('#btnAddBarcode').onclick = () => addElement(makeBarcode(state.data.headers[0] ? `{{${state.data.headers[0]}}}` : '12345678'));
$('#btnAddImage').onclick = async () => {
  const [file] = await pickFile($('#fileImg'));
  if (!file) return;
  const id = uid();
  state.design.assets[id] = await imageToDataUrl(file);
  addElement(makeImage({ assetId: id }));
};

/* --------------------------------------------------------------------- data */

function reparse() {
  const d = state.data;
  const rows = d.raw ? parseCSV(d.raw) : [];
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  let headers = [];
  if (rows.length) {
    const first = d.hasHeader ? rows.shift() : [];
    const seen = new Set();
    for (let i = 0; i < width; i++) {
      let name = (first[i] || '').replace(/[{}]/g, '').trim() || `Column ${i + 1}`;
      const base = name;
      for (let k = 2; seen.has(name); k++) name = `${base} (${k})`;
      seen.add(name);
      headers.push(name);
    }
  }
  d.headers = headers;
  d.records = rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  state.record = clamp(state.record, 0, Math.max(0, d.records.length - 1));
}

function loadCSVText(text, fileName) {
  Object.assign(state.data, { raw: text, fileName });
  state.record = 0;
  reparse();
  saveData();
  syncColumns();
  changed({ history: false });
}

function syncColumns() {
  const d = state.data;
  const has = d.headers.length > 0;
  $('#columnsSection').hidden = !has;
  $('#headerRow').hidden = !has;
  $('#chkHeader').checked = d.hasHeader;
  $('#dataInfo').textContent = has
    ? `${d.fileName || 'Data'} – ${d.records.length} row${d.records.length === 1 ? '' : 's'}, ${d.headers.length} columns`
    : 'Load a CSV file, or drop one anywhere on this page. Your data stays in your browser.';

  const row = currentRow();
  $('#columns').replaceChildren(...d.headers.map(h => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.col = h;
    li.title = 'Click to add, or drag onto the label';
    const main = document.createElement('div');
    main.className = 'col-main';
    const name = document.createElement('div');
    name.className = 'col-name';
    name.textContent = h;
    const sample = document.createElement('div');
    sample.className = 'col-sample';
    sample.textContent = row?.[h] ?? '';
    main.append(name, sample);
    const img = document.createElement('button');
    img.className = 'col-img';
    img.textContent = 'image';
    img.title = 'Add this column as an image box (the column holds image URLs or file names)';
    const bar = document.createElement('button');
    bar.className = 'col-img col-bar';
    bar.textContent = 'barcode';
    bar.title = 'Add a barcode or QR code generated from this column';
    li.append(main, img, bar);
    return li;
  }));

  const fill = (sel, placeholder) => {
    const cur = sel.value;
    sel.replaceChildren(new Option(placeholder, ''), ...d.headers.map(h => new Option(h, h)));
    sel.value = cur;
  };
  fill($('#pInsert'), 'Insert merge field…');
  fill($('#pImgColumn'), 'Choose a column…');
  fill($('#pBarInsert'), 'Insert merge field…');

  const condGroup = (label, prefix) => {
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...d.headers.map(h => new Option(h, prefix + h)));
    return g;
  };
  $('#pCond').replaceChildren(
    new Option('Insert conditional text…', ''),
    condGroup('Show text only if this column has a value', '#'),
    condGroup('Show text only if this column is empty', '^'),
  );
}

$('#columns').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const col = li.dataset.col;
  if (e.target.closest('.col-bar')) addElement(makeBarcode(`{{${col}}}`));
  else if (e.target.closest('.col-img')) addElement(makeImage({ source: 'column', column: col }));
  else addElement(makeText(`{{${col}}}`));
});
$('#columns').addEventListener('dragstart', e => {
  const li = e.target.closest('li');
  if (li) { e.dataTransfer.setData('application/x-label-field', li.dataset.col); e.dataTransfer.effectAllowed = 'copy'; }
});
labelEl.addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('application/x-label-field')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
labelEl.addEventListener('drop', e => {
  const col = e.dataTransfer.getData('application/x-label-field');
  if (!col) return;
  e.preventDefault();
  e.stopPropagation();
  const r = labelEl.getBoundingClientRect();
  const u = currentU();
  addElement(makeText(`{{${col}}}`, { x: (e.clientX - r.left) / u, y: (e.clientY - r.top) / u }));
});

$('#btnCsv').onclick = async () => {
  const [file] = await pickFile($('#fileCsv'));
  if (file) loadCSVText(await readFile(file, 'text'), file.name);
};
$('#btnSample').onclick = async () => {
  const text = await (await fetch('sample/addresses.csv')).text();
  loadCSVText(text, 'Sample addresses');
  if (!state.design.elements.length) {
    const t = getTpl();
    const m = labelMargin();
    const el = makeText('{{Name}}\n{{Company}}\n{{Address}}\n{{Address 2}}\n{{City}}, {{State}} {{Zip}}');
    Object.assign(el, { x: m, y: m, w: t.w - 2 * m, h: t.h - 2 * m });
    addElement(el);
  }
};
$('#chkHeader').onchange = e => {
  state.data.hasHeader = e.target.checked;
  reparse();
  saveData();
  syncColumns();
  changed({ history: false });
};

// Drop files anywhere: CSV loads data, JSON opens a design.
window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async e => {
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  e.preventDefault();
  if (/\.json$/i.test(file.name)) openDesignText(await readFile(file, 'text'));
  else if (/\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith('text/')) loadCSVText(await readFile(file, 'text'), file.name);
});

$('#btnPrev').onclick = () => stepRecord(-1);
$('#btnNext').onclick = () => stepRecord(1);
function stepRecord(d) {
  state.record = clamp(state.record + d, 0, Math.max(0, state.data.records.length - 1));
  renderEditor();
  const row = currentRow();
  $$('#columns li').forEach(li => { $('.col-sample', li).textContent = row?.[li.dataset.col] ?? ''; });
}

/* --------------------------------------------------------------- properties */

function syncFontList() {
  const sel = $('#pFont');
  const cur = sel.value;
  const group = (label, names) => {
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...names.map(n => new Option(n, n)));
    return g;
  };
  const groups = [group('Standard', Object.keys(SYSTEM_FONTS)), group('Google Fonts', GOOGLE_FONTS)];
  if (state.design.fonts.length) groups.unshift(group('Uploaded', state.design.fonts.map(f => f.name)));
  sel.replaceChildren(...groups);
  sel.value = cur;
}

// [input id, getter, setter]; setters receive the raw input value.
const num = (v, lo, hi, fallback) => { const n = parseFloat(v); return Number.isFinite(n) ? clamp(n, lo, hi) : fallback; };
const FIELDS = [
  ['pContent', el => (el.type === 'text' ? el.content : undefined), (el, v) => { el.content = v; }],
  ['pBarFormat', el => el.format, (el, v) => { el.format = v; }],
  ['pBarValue', el => (el.type === 'barcode' ? el.content : undefined), (el, v) => { el.content = v; }],
  ['pBarText', el => el.showText, (el, v) => { el.showText = v; }],
  ['pBarTextSize', el => el.textSize, (el, v) => { el.textSize = num(v, 3, 72, el.textSize); }],
  ['pBarColor', el => (el.type === 'barcode' ? el.color : undefined), (el, v) => { el.color = v; }],
  ['pFont', el => el.fontFamily, (el, v) => { el.fontFamily = v; }],
  ['pSize', el => el.fontSize, (el, v) => { el.fontSize = num(v, 2, 400, el.fontSize); }],
  ['pColor', el => (el.type === 'text' ? el.color : undefined), (el, v) => { el.color = v; }],
  ['pLine', el => el.lineHeight, (el, v) => { el.lineHeight = num(v, 0.8, 3, el.lineHeight); }],
  ['pShrink', el => el.shrink, (el, v) => { el.shrink = v; }],
  ['pRemoveBlank', el => el.removeBlank, (el, v) => { el.removeBlank = v; }],
  ['pImgSource', el => el.source, (el, v) => { el.source = v; }],
  ['pImgColumn', el => el.column, (el, v) => { el.column = v; }],
  ['pFit', el => el.fit, (el, v) => { el.fit = v; }],
  ['pX', el => toUnit(el.x), (el, v) => { el.x = clamp(fromUnit(v), 0, Math.max(0, getTpl().w - el.w)); }],
  ['pY', el => toUnit(el.y), (el, v) => { el.y = clamp(fromUnit(v), 0, Math.max(0, getTpl().h - el.h)); }],
  ['pW', el => toUnit(el.w), (el, v) => { el.w = clamp(fromUnit(v), MIN_SIZE, getTpl().w - el.x); }],
  ['pH', el => toUnit(el.h), (el, v) => { el.h = clamp(fromUnit(v), MIN_SIZE, getTpl().h - el.y); }],
];

const SINGLE_ONLY = ['pContent', 'pBarValue', 'pX', 'pY', 'pW', 'pH', 'pImgSource', 'pImgColumn'];
for (const [id, get, set] of FIELDS) {
  const input = $('#' + id);
  const handler = () => {
    // Content and geometry edit one box; style settings apply to every selected box that has them.
    const targets = SINGLE_ONLY.includes(id) ? [selected()].filter(Boolean) : selection().filter(el => get(el) !== undefined);
    if (!targets.length) return;
    for (const el of targets) set(el, input.type === 'checkbox' ? input.checked : input.value);
    changed({ history: 'debounce' }); // typing coalesces into one undo step
  };
  input.addEventListener('input', handler);
  input.addEventListener('change', () => { handler(); syncProps(true); });
}

function syncProps(force = false) {
  const els = selection();
  const el = els[0];
  const single = els.length === 1;
  $('#propsEmpty').hidden = !!el;
  $('#propsEl').hidden = !el;
  if (!el) return;
  const allText = els.every(e => e.type === 'text');
  const allImage = els.every(e => e.type === 'image');
  const grouped = els.some(e => e.group);
  const oneGroup = !single && !!el.group && els.every(e => e.group === el.group) && groupOf(el).length === els.length;
  $('#multiInfo').hidden = single;
  $('#multiCount').textContent = oneGroup ? `Group of ${els.length} boxes` : `${els.length} boxes selected`;
  $('#btnGroup').hidden = single || oneGroup;
  $('#btnUngroup').hidden = !grouped;
  $('#groupRow').hidden = single && !grouped;
  $('#groupHint').hidden = !(single && grouped);
  const unitCount = selectionUnits().length;
  $('#distRow').hidden = unitCount < 2;
  for (const btn of $$('#distRow button')) btn.disabled = unitCount < 3;
  $('#secText').hidden = !allText;
  $('#secContent').hidden = !single;
  $('#secImage').hidden = !allImage;
  $('#secImageSource').hidden = !single;
  $('#secBarcode').hidden = !els.every(e => e.type === 'barcode');
  $('#secBarValue').hidden = !single;
  $('#barTextRow').hidden = els.every(e => e.format === 'QR');
  $('#secPos').hidden = !single;
  $('#posUnit').textContent = `(${getTpl().unit})`;
  for (const id of ['pX', 'pY', 'pW', 'pH']) $('#' + id).step = getTpl().unit === 'mm' ? 0.5 : 0.01;
  for (const [id, get] of FIELDS) {
    const input = $('#' + id);
    const v = get(el);
    if (v === undefined) continue;
    if (input.type === 'checkbox') input.checked = !!v;
    else if (force || document.activeElement !== input) input.value = v;
  }
  for (const b of $$('#propsEl [data-toggle]')) b.classList.toggle('active', !!el[b.dataset.toggle]);
  for (const b of $$('#propsEl [data-set]')) {
    const [k, v] = b.dataset.set.split(':');
    b.classList.toggle('active', el[k] === v);
  }
  if (single && el.type === 'image') {
    $('#imgStatic').hidden = el.source !== 'static';
    $('#imgColumn').hidden = el.source !== 'column';
    const n = new Set(state.imageLib.values()).size;
    $('#imgLibInfo').textContent = n ? `${n} image${n === 1 ? '' : 's'} loaded` : '';
  }
}

$('#propsEl').addEventListener('click', e => {
  const els = selection();
  const b = e.target.closest('button');
  if (!els.length || !b) return;
  if (b.dataset.handled) { delete b.dataset.handled; return; }
  if (b.dataset.toggle) {
    const k = b.dataset.toggle, on = !els[0][k];
    for (const el of els) if (el.type === 'text') el[k] = on;
  } else if (b.dataset.set) {
    const [k, v] = b.dataset.set.split(':');
    for (const el of els) if (el.type === 'text') el[k] = v;
  } else if (b.dataset.place) {
    // One box or one group aligns to the label; several align to each other.
    const t = getTpl();
    const units = selectionUnits();
    const ref = units.length === 1 ? { x: 0, y: 0, w: t.w, h: t.h } : bounds(els);
    const p = b.dataset.place;
    for (const unit of units) {
      const bb = bounds(unit);
      let dx = 0, dy = 0;
      if (p === 'left') dx = ref.x - bb.x;
      if (p === 'hcenter') dx = ref.x + (ref.w - bb.w) / 2 - bb.x;
      if (p === 'right') dx = ref.x + ref.w - bb.w - bb.x;
      if (p === 'top') dy = ref.y - bb.y;
      if (p === 'vmiddle') dy = ref.y + (ref.h - bb.h) / 2 - bb.y;
      if (p === 'bottom') dy = ref.y + ref.h - bb.h - bb.y;
      for (const el of unit) { el.x += dx; el.y += dy; }
    }
  } else if (b.dataset.distribute) {
    distributeSelected(b.dataset.distribute);
    return;
  } else return;
  changed();
});

// Spaces the selected boxes/groups evenly between the two outermost ones.
function distributeSelected(axis) {
  const [pos, size] = axis === 'h' ? ['x', 'w'] : ['y', 'h'];
  const units = selectionUnits().map(els => ({ els, bb: bounds(els) })).sort((a, b) => a.bb[pos] - b.bb[pos] || a.bb[size] - b.bb[size]);
  if (units.length < 3) return;
  const start = units[0].bb[pos];
  const end = Math.max(...units.map(u => u.bb[pos] + u.bb[size]));
  const gap = (end - start - units.reduce((n, u) => n + u.bb[size], 0)) / (units.length - 1);
  let at = start;
  for (const u of units) {
    const d = at - u.bb[pos];
    for (const el of u.els) el[pos] += d;
    at += u.bb[size] + gap;
  }
  changed();
}

// Replaces the textarea selection with before + selection + after and leaves the caret inside.
function insertIntoContent(before, after = '') {
  const el = selected();
  if (!el) return;
  const ta = $('#pContent');
  const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
  const middle = ta.value.slice(s, en);
  el.content = ta.value.slice(0, s) + before + middle + after + ta.value.slice(en);
  ta.value = el.content;
  ta.focus();
  const caret = s + before.length + middle.length;
  ta.setSelectionRange(caret, caret);
  changed();
}

$('#pBarInsert').onchange = e => {
  const el = selected();
  const col = e.target.value;
  e.target.value = '';
  if (!el || !col) return;
  const input = $('#pBarValue');
  const s = input.selectionStart ?? input.value.length, en = input.selectionEnd ?? input.value.length;
  el.content = input.value.slice(0, s) + `{{${col}}}` + input.value.slice(en);
  input.value = el.content;
  changed();
};
$('#pBarFormat').append(...BARCODE_FORMATS.map(f => new Option(f.name, f.id)));

/* Styling part of a text box: with text selected in the in-place editor or the Text field,
   bold / italic / underline wrap just that selection in <b> / <i> / <u> tags. */
const contentField = node => (node?.matches?.('.inline-edit, #pContent') ? node : null);
function styleSelectedRange(ta, key) {
  if (ta.selectionStart === ta.selectionEnd) return false;
  const r = toggleRangeStyle(ta.value, ta.selectionStart, ta.selectionEnd, key[0]);
  if (r.content !== ta.value) {
    ta.focus();
    ta.select();
    // insertText keeps the field's own undo history; fall back to assigning the value.
    if (!document.execCommand('insertText', false, r.content)) {
      ta.value = r.content;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  ta.setSelectionRange(r.from, r.to);
  return true;
}
// Toolbar buttons: act on the text selection when there is one, without stealing focus.
$('#propsEl').addEventListener('mousedown', e => {
  const b = e.target.closest('[data-toggle]');
  const ta = contentField(document.activeElement);
  if (!b || !ta || ta.selectionStart === ta.selectionEnd) return;
  e.preventDefault();
  styleSelectedRange(ta, b.dataset.toggle);
  b.dataset.handled = '1';
});

$('#pInsert').onchange = e => {
  const col = e.target.value;
  e.target.value = '';
  if (col) insertIntoContent(`{{${col}}}`);
};
// Wraps the selected text in a condition; with nothing selected, inserts a ready-made one.
$('#pCond').onchange = e => {
  const v = e.target.value;
  e.target.value = '';
  if (!v) return;
  const kind = v[0], col = v.slice(1);
  const ta = $('#pContent');
  const hasSelection = ta.selectionStart !== ta.selectionEnd;
  const open = `{{${kind}${col}}}` + (!hasSelection && kind === '#' ? `{{${col}}}` : '');
  insertIntoContent(open, `{{/${col}}}`);
};

$('#btnFontUpload').onclick = async () => {
  const [file] = await pickFile($('#fileFont'));
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w \-]/g, ' ').trim() || 'Custom font';
  const dataUrl = await readFile(file);
  try { await registerCustomFont(name, dataUrl); }
  catch { alert('That font file could not be read. Try a .ttf, .otf, .woff or .woff2 file.'); return; }
  const d = state.design;
  if (!d.fonts.some(f => f.name === name)) {
    const id = uid();
    d.assets[id] = dataUrl;
    d.fonts.push({ name, assetId: id });
  }
  syncFontList();
  const el = selected();
  if (el?.type === 'text') el.fontFamily = name;
  changed();
};

$('#btnImgChoose').onclick = () => { const el = selected(); if (el) chooseStaticImage(el); };
$('#btnImgLib').onclick = async () => {
  const files = await pickFile($('#fileImgLib'));
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const name = f.name.toLowerCase();
    state.imageLib.set(name, url);
    state.imageLib.set(name.replace(/\.[a-z0-9]+$/, ''), url);
  }
  changed({ history: false });
};

function removeSelected() {
  const d = state.design;
  d.elements = d.elements.filter(e => !state.sel.includes(e.id));
  state.sel = [];
  changed();
}
// Adds copies of `els` (fresh ids, groups kept together) offset by `shift` points and selects them.
function addCopies(els, shift) {
  if (!els.length) return;
  const t = getTpl();
  const fitted = els.map(el => ({ ...el, w: Math.min(el.w, t.w), h: Math.min(el.h, t.h) }));
  const bb = bounds(fitted);
  const dx = clamp(bb.x + shift, 0, Math.max(0, t.w - bb.w)) - bb.x;
  const dy = clamp(bb.y + shift, 0, Math.max(0, t.h - bb.h)) - bb.y;
  const groups = new Map();
  const copies = fitted.map(el => {
    const copy = { ...structuredClone(el), id: uid() };
    copy.x = clamp(el.x + dx, 0, t.w - copy.w);
    copy.y = clamp(el.y + dy, 0, t.h - copy.h);
    if (el.group) {
      if (!groups.has(el.group)) groups.set(el.group, uid());
      copy.group = groups.get(el.group);
    }
    return copy;
  });
  state.design.elements.push(...copies);
  state.sel = copies.map(c => c.id);
  changed();
}
function duplicateSelected() {
  addCopies(selection(), 6);
}

// Internal clipboard for boxes; each paste lands a little further from the original.
const clipboard = { els: [], pastes: 0 };
function copySelected() {
  const els = selection();
  if (!els.length) return false;
  clipboard.els = structuredClone(els);
  clipboard.pastes = 0;
  return true;
}
function cutSelected() {
  if (!copySelected()) return;
  clipboard.pastes = -1; // first paste after a cut goes back to the original spot
  removeSelected();
}
function pasteClipboard() {
  if (!clipboard.els.length) return;
  clipboard.pastes++;
  // Skip images whose data is no longer in this design (e.g. after opening another file).
  const els = clipboard.els.filter(el => el.type !== 'image' || el.source !== 'static' || !el.assetId || state.design.assets[el.assetId]);
  addCopies(els, 6 * clipboard.pastes);
}
function toggleTextStyle(key) {
  const texts = selection().filter(el => el.type === 'text');
  if (!texts.length) return false;
  const on = !texts[0][key];
  for (const el of texts) el[key] = on;
  changed();
  return true;
}
function reorder(toFront) {
  const els = selection();
  if (!els.length) return;
  const rest = state.design.elements.filter(e => !els.includes(e));
  state.design.elements = toFront ? [...rest, ...els] : [...els, ...rest];
  changed();
}
function groupSelected() {
  const els = selection();
  if (els.length < 2) return;
  const g = uid();
  for (const el of els) el.group = g;
  changed();
}
function ungroupSelected() {
  const els = selection().filter(el => el.group);
  if (!els.length) return;
  for (const el of els) delete el.group;
  changed();
}
function nudgeSelected(dx, dy) {
  const els = selection();
  const t = getTpl();
  const bb = bounds(els);
  const mx = clamp(bb.x + dx, 0, Math.max(0, t.w - bb.w)) - bb.x;
  const my = clamp(bb.y + dy, 0, Math.max(0, t.h - bb.h)) - bb.y;
  for (const el of els) { el.x += mx; el.y += my; }
  changed({ history: 'debounce' });
}
$('#btnGroup').onclick = groupSelected;
$('#btnUngroup').onclick = ungroupSelected;
$('#btnDel').onclick = removeSelected;
$('#btnDup').onclick = duplicateSelected;
$('#btnFront').onclick = () => reorder(true);
$('#btnBack').onclick = () => reorder(false);

/* ---------------------------------------------------------------- templates */

function syncTemplateUI() {
  const sel = $('#tplSelect');
  if (!sel.options.length) {
    for (const g of TEMPLATE_GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      og.append(...g.templates.map(t => new Option(t.name, t.id)));
      sel.append(og);
    }
    sel.append(new Option('Custom size…', 'custom'));
  }
  const t = getTpl();
  sel.value = t.id;
  const dim = t.unit === 'mm'
    ? `${toUnit(t.w)} × ${toUnit(t.h)} mm`
    : `${+(t.w / IN).toFixed(3)} × ${+(t.h / IN).toFixed(3)} in`;
  $('#tplInfo').textContent = `${t.cols * t.rows} per sheet · ${dim}`;
  $('#offUnit').textContent = t.unit;
  $('#numOffX').step = $('#numOffY').step = t.unit === 'mm' ? 0.25 : 0.01;
}

// Keeps every box inside the label after the label size changes.
function fitElementsToLabel() {
  const t = getTpl();
  for (const el of state.design.elements) {
    el.w = Math.min(el.w, t.w);
    el.h = Math.min(el.h, t.h);
    el.x = clamp(el.x, 0, t.w - el.w);
    el.y = clamp(el.y, 0, t.h - el.h);
  }
  const p = state.design.print;
  p.startAt = clamp(p.startAt, 1, t.cols * t.rows);
}

function applyTemplateChange() {
  fitElementsToLabel();
  syncTemplateUI();
  syncPrintUI();
  changed();
}

$('#tplSelect').onchange = e => {
  if (e.target.value === 'custom') {
    if (!state.design.custom) { syncTemplateUI(); openCustomDialog(); return; }
    state.design.templateId = 'custom';
  } else state.design.templateId = e.target.value;
  applyTemplateChange();
};
$('#btnCustom').onclick = openCustomDialog;

function openCustomDialog() {
  const dlg = $('#customDlg');
  const f = $('form', dlg);
  const t = getTpl();
  const k = t.unit === 'mm' ? MM : IN;
  const r = v => +(v / k).toFixed(t.unit === 'mm' ? 2 : 4);
  f.paper.value = Math.abs(t.pageW - 210 * MM) < 1 ? 'a4' : 'letter';
  f.unit.value = t.unit;
  f.cols.value = t.cols;
  f.rows.value = t.rows;
  f.w.value = r(t.w);
  f.h.value = r(t.h);
  f.left.value = r(t.left);
  f.top.value = r(t.top);
  f.gapX.value = r(Math.max(0, t.pitchX - t.w));
  f.gapY.value = r(Math.max(0, t.pitchY - t.h));
  f.shape.value = t.shape;
  f.unit.dataset.prev = t.unit;
  dlg.returnValue = '';
  dlg.showModal();
}
// Converts the entered numbers when the unit is switched inside the dialog.
$('#customDlg form').unit.onchange = e => {
  const f = e.target.form;
  const factor = e.target.value === 'mm' ? 25.4 : 1 / 25.4;
  if (e.target.dataset.prev === e.target.value) return;
  for (const n of ['w', 'h', 'left', 'top', 'gapX', 'gapY']) f[n].value = +(f[n].value * factor).toFixed(e.target.value === 'mm' ? 2 : 4);
  e.target.dataset.prev = e.target.value;
};
$('#customDlg').addEventListener('close', e => {
  const dlg = e.target;
  if (dlg.returnValue !== 'ok') { syncTemplateUI(); return; }
  const f = $('form', dlg);
  const k = f.unit.value === 'mm' ? MM : IN;
  const v = n => Math.max(0, parseFloat(f[n].value) || 0) * k;
  const a4 = f.paper.value === 'a4';
  const w = Math.max(MIN_SIZE * 2, v('w')), h = Math.max(MIN_SIZE * 2, v('h'));
  state.design.custom = {
    unit: f.unit.value,
    pageW: a4 ? 210 * MM : 8.5 * IN,
    pageH: a4 ? 297 * MM : 11 * IN,
    cols: clamp(parseInt(f.cols.value) || 1, 1, 20),
    rows: clamp(parseInt(f.rows.value) || 1, 1, 40),
    w, h, left: v('left'), top: v('top'),
    pitchX: w + v('gapX'), pitchY: h + v('gapY'),
    shape: f.shape.value,
  };
  state.design.templateId = 'custom';
  applyTemplateChange();
});

/* ------------------------------------------------------ preview and printing */

// Appends sheet pages to `root`; returns the total number of pages needed.
function buildPages(root, maxPages = Infinity) {
  const t = getTpl();
  const p = state.design.print;
  const perPage = t.cols * t.rows;
  const start = clamp(p.startAt, 1, perPage) - 1;
  const copies = clamp(p.copies | 0, 1, 999);
  const recs = state.data.records;
  // Without data, fill the rest of one sheet with the static design.
  const count = recs.length ? recs.length * copies : perPage - start;
  const rowAt = i => (recs.length ? recs[Math.floor(i / copies)] : null);
  const totalPages = Math.max(1, Math.ceil((start + count) / perPage));
  const ctx = { editor: false, showNames: false, resolveImage };

  for (let pg = 0; pg < Math.min(totalPages, maxPages); pg++) {
    const page = document.createElement('div');
    page.className = 'page' + (p.outline ? ' outlined' : '');
    page.style.width = U(t.pageW);
    page.style.height = U(t.pageH);
    for (let slot = 0; slot < perPage; slot++) {
      const cell = document.createElement('div');
      cell.className = 'plabel' + (t.shape === 'round' ? ' round' : '');
      cell.style.left = U(t.left + (slot % t.cols) * t.pitchX + p.offsetX);
      cell.style.top = U(t.top + Math.floor(slot / t.cols) * t.pitchY + p.offsetY);
      cell.style.width = U(t.w);
      cell.style.height = U(t.h);
      const i = pg * perPage + slot - start;
      if (i >= 0 && i < count) {
        const row = rowAt(i);
        for (const el of state.design.elements) cell.append(buildElementNode(el, row, ctx));
      }
      page.append(cell);
    }
    root.append(page);
  }
  return totalPages;
}

function renderSheets() {
  const root = $('#sheets');
  const t = getTpl();
  const u = clamp((root.clientWidth - 64) / t.pageW, 0.4, 1.6);
  root.style.setProperty('--u', u + 'px');
  const scroll = root.scrollTop;
  root.replaceChildren();
  const total = buildPages(root, MAX_PREVIEW_PAGES);
  fitAll(root);
  if (total > MAX_PREVIEW_PAGES) {
    const note = document.createElement('div');
    note.className = 'sheet-note';
    note.textContent = `Showing the first ${MAX_PREVIEW_PAGES} of ${total} sheets. All ${total} will print.`;
    root.append(note);
  }
  root.scrollTop = scroll;
  const n = state.data.records.length;
  $('#sheetInfo').textContent = `${total} sheet${total === 1 ? '' : 's'}` + (n ? ` · ${n} record${n === 1 ? '' : 's'}` : ' · no data loaded');
}

function setPageStyle() {
  const t = getTpl();
  $('#pageStyle').textContent = `@page { size: ${+(t.pageW / IN).toFixed(4)}in ${+(t.pageH / IN).toFixed(4)}in; margin: 0; }`;
}

function preparePrint() {
  const root = $('#printRoot');
  root.replaceChildren();
  setPageStyle();
  buildPages(root);
  fitAll(root);
  return root;
}

async function printLabels() {
  const btn = $('#btnPrint');
  btn.disabled = true;
  try {
    const names = [...new Set(state.design.elements.filter(e => e.type === 'text').map(e => e.fontFamily))];
    await whenFontsReady(names);
    const root = preparePrint();
    const pending = $$('img', root).map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    await Promise.race([Promise.all(pending), new Promise(r => setTimeout(r, 8000))]);
    window.print();
  } finally {
    btn.disabled = false;
  }
}
// Covers printing started from the browser's own menu.
window.addEventListener('beforeprint', () => { if (!$('#printRoot').children.length) preparePrint(); });
window.addEventListener('afterprint', () => $('#printRoot').replaceChildren());
$('#btnPrint').onclick = printLabels;

function syncPrintUI() {
  const p = state.design.print;
  const t = getTpl();
  $('#chkOutline').checked = p.outline;
  $('#numStart').value = p.startAt;
  $('#numStart').max = t.cols * t.rows;
  $('#numCopies').value = p.copies;
  $('#numOffX').value = toUnit(p.offsetX);
  $('#numOffY').value = toUnit(p.offsetY);
}
const printField = (id, apply) => { $('#' + id).addEventListener('change', e => { apply(state.design.print, e.target); syncPrintUI(); changed(); }); };
printField('chkOutline', (p, i) => { p.outline = i.checked; });
printField('numStart', (p, i) => { const t = getTpl(); p.startAt = clamp(parseInt(i.value) || 1, 1, t.cols * t.rows); });
printField('numCopies', (p, i) => { p.copies = clamp(parseInt(i.value) || 1, 1, 999); });
printField('numOffX', (p, i) => { p.offsetX = clamp(fromUnit(i.value), -72, 72); });
printField('numOffY', (p, i) => { p.offsetY = clamp(fromUnit(i.value), -72, 72); });

/* ------------------------------------------------------------ top-level UI */

function setView(view) {
  state.view = view;
  $$('#viewTabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#designView').hidden = view !== 'design';
  $('#sheetsView').hidden = view !== 'sheets';
  if (view === 'sheets') renderSheets(); else renderEditor();
}
$('#viewTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

$('#chkNames').onchange = e => { state.showNames = e.target.checked; renderEditor(); };
$('#chkSnap').onchange = e => { state.snap = e.target.checked; };
const zoomBy = f => { state.zoom = clamp((currentU() / PX_PER_PT) * f, 0.25, 8); renderEditor(); };
$('#btnZoomIn').onclick = () => zoomBy(1.25);
$('#btnZoomOut').onclick = () => zoomBy(0.8);
$('#btnZoomFit').onclick = () => { state.zoom = 'fit'; renderEditor(); };

$('#btnUndo').onclick = () => stepHistory(-1);
$('#btnRedo').onclick = () => stepHistory(1);
$('#btnSave').onclick = downloadDesign;
$('#btnOpen').onclick = async () => {
  const [file] = await pickFile($('#fileDesign'));
  if (file) openDesignText(await readFile(file, 'text'));
};
$('#btnNew').onclick = () => {
  if (state.design.elements.length && !confirm('Start a new blank design? The current layout will be cleared (you can undo).')) return;
  const { templateId, custom, assets, fonts } = state.design;
  state.design = { ...newDesign(), templateId, custom, assets, fonts };
  state.sel = [];
  refreshAll();
};

window.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'p') { e.preventDefault(); printLabels(); return; }
  const inField = e.target.closest?.('input, textarea, select, dialog');
  // Bold / italic / underline also work while typing in a text box's content.
  const styleKey = { b: 'bold', i: 'italic', u: 'underline' }[key];
  if (mod && styleKey && !e.shiftKey && !e.altKey && state.view === 'design'
      && (!inField || e.target.matches('.inline-edit, #pContent'))) {
    const ta = contentField(e.target);
    if ((ta && styleSelectedRange(ta, styleKey)) || toggleTextStyle(styleKey)) e.preventDefault();
    return;
  }
  if (inField) return;
  if (mod && key === 'v' && state.view === 'design') { if (clipboard.els.length) { e.preventDefault(); pasteClipboard(); } return; }
  if (mod && key === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 1 : -1); return; }
  if (mod && key === 'y') { e.preventDefault(); stepHistory(1); return; }
  if (state.view !== 'design') return;
  if (mod && key === 'a') { e.preventDefault(); setSelection(state.design.elements.map(o => o.id)); return; }
  if (!state.sel.length) return;
  const el = selected();
  if (mod && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (mod && key === 'c') { e.preventDefault(); copySelected(); return; }
  if (mod && key === 'x') { e.preventDefault(); cutSelected(); return; }
  if (mod && key === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelected() : groupSelected(); return; }
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); removeSelected(); return; }
  if (key === 'escape') { setSelection([]); return; }
  if (key === 'enter' && el?.type === 'text') { e.preventDefault(); startInlineEdit(el); return; }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[key]) {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 0.5;
    nudgeSelected(arrows[key][0] * step, arrows[key][1] * step);
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => (state.view === 'sheets' ? renderSheets() : renderEditor()), 100);
});

setFontLoadCallback(() => {
  renderEditor();
  if (state.view === 'sheets') renderSheets();
});

/* --------------------------------------------------------------------- boot */

(async function init() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_DESIGN) || 'null');
    if (saved && Array.isArray(saved.elements)) state.design = normalizeDesign(saved);
  } catch { /* start fresh */ }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_DATA) || 'null');
    if (saved?.raw) { Object.assign(state.data, saved); reparse(); }
  } catch { /* no saved data */ }
  await registerDesignFonts();
  resetHistory();
  refreshAll({ history: false });
})();

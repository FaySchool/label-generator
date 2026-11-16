// Barcode encoding on top of the vendored JsBarcode (1D) and qrcode-generator (QR) libraries.
// Only their encoders are used; drawing is done in render.js so codes scale with the box.

export const BARCODE_FORMATS = [
  { id: 'CODE128', name: 'Code 128 (letters and numbers)' },
  { id: 'CODE39', name: 'Code 39' },
  { id: 'QR', name: 'QR code' },
  { id: 'EAN13', name: 'EAN-13 (12 or 13 digits)' },
  { id: 'EAN8', name: 'EAN-8 (7 or 8 digits)' },
  { id: 'UPC', name: 'UPC-A (11 or 12 digits)' },
  { id: 'ITF14', name: 'ITF-14 (13 or 14 digits)' },
  { id: 'ITF', name: 'Interleaved 2 of 5 (even number of digits)' },
  { id: 'codabar', name: 'Codabar' },
  { id: 'MSI', name: 'MSI (digits)' },
];

const cache = new Map();

// Returns { ok: false } when the value cannot be encoded in the format, otherwise
//   { ok, kind: 'linear', bits: '1011…', text, quiet }   or
//   { ok, kind: 'matrix', rows: [[bool]], size, quiet }.
export function encodeBarcode(format, value) {
  const key = format + '\n' + value;
  if (!cache.has(key)) {
    if (cache.size > 5000) cache.clear();
    let result = { ok: false };
    try { result = format === 'QR' ? encodeQR(value) : encodeLinear(format, value); } catch { /* invalid input */ }
    cache.set(key, result);
  }
  return cache.get(key);
}

function encodeLinear(format, value) {
  if (format === 'CODE39') value = value.toUpperCase();
  const data = {};
  let valid = true;
  globalThis.JsBarcode(data, value, { format, valid: v => { valid = v; } });
  if (!valid || !data.encodings?.length) return { ok: false };
  return {
    ok: true,
    kind: 'linear',
    bits: data.encodings.map(e => e.data).join(''),
    text: data.encodings.map(e => e.text || '').join('') || value,
    quiet: 10,
  };
}

function encodeQR(value) {
  const qrcode = globalThis.qrcode;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const size = qr.getModuleCount();
  const rows = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => qr.isDark(r, c)));
  return { ok: true, kind: 'matrix', rows, size, quiet: 2 };
}

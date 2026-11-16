// Small RFC 4180 style parser with delimiter detection.
export function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === '\n' && i > 0) break; // first record only
      if (c in counts) counts[c]++;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

export function parseCSV(text, delim = detectDelimiter(text)) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', inQuotes = false, quoted = false;
  const endCell = () => { row.push(quoted ? cell : cell.trim()); cell = ''; quoted = false; };
  const endRow = () => { endCell(); if (row.some(v => v !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') { inQuotes = true; quoted = true; cell = ''; }
    else if (c === delim) endCell();
    else if (c === '\n') endRow();
    else if (c === '\r') { /* handled by \n; lone \r treated as newline */ if (text[i + 1] !== '\n') endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

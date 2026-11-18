// Font catalogue: system stacks, on-demand Google Fonts, and user-uploaded fonts.
export const SYSTEM_FONTS = {
  'Arial': 'Arial, Helvetica, sans-serif',
  'Helvetica': 'Helvetica, Arial, sans-serif',
  'Verdana': 'Verdana, Geneva, sans-serif',
  'Tahoma': 'Tahoma, Geneva, sans-serif',
  'Trebuchet MS': '"Trebuchet MS", Helvetica, sans-serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  'Georgia': 'Georgia, serif',
  'Garamond': 'Garamond, "EB Garamond", Georgia, serif',
  'Courier New': '"Courier New", Courier, monospace',
  'Comic Sans MS': '"Comic Sans MS", "Comic Sans", cursive',
  'Impact': 'Impact, Haettenschweiler, sans-serif',
};

export const GOOGLE_FONTS = [
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito', 'Raleway', 'Source Sans 3',
  'Oswald', 'Bebas Neue', 'Merriweather', 'Playfair Display', 'Lora', 'Libre Baskerville',
  'Roboto Slab', 'Roboto Mono', 'Dancing Script', 'Great Vibes', 'Pacifico', 'Caveat',
];

const custom = new Set();
const loading = new Map(); // google font name -> promise
let onLoad = () => {};

export function setFontLoadCallback(fn) { onLoad = fn; }

export function fontStack(name) {
  if (SYSTEM_FONTS[name]) return SYSTEM_FONTS[name];
  return `"${String(name).replace(/["\\]/g, '')}", sans-serif`;
}

// Starts loading a Google font the first time it is used; fires the callback once ready.
export function ensureFont(name) {
  if (!GOOGLE_FONTS.includes(name) || custom.has(name) || loading.has(name)) return;
  loading.set(name, new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css?family=' +
      encodeURIComponent(name).replace(/%20/g, '+') + ':400,400i,700,700i&display=swap';
    link.onload = () => {
      const variants = ['', 'bold ', 'italic ', 'italic bold '];
      Promise.all(variants.map(v => document.fonts.load(`${v}16px "${name}"`).catch(() => {})))
        .then(() => { resolve(); onLoad(name); });
    };
    link.onerror = () => resolve();
    document.head.append(link);
  }));
}

// A base64 data: URL, as FileReader.readAsDataURL and canvas.toDataURL produce. Nothing else is
// accepted for embedded images and fonts, so they can never make the page load a remote file.
const DATA_URL = /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[a-z0-9.+-]+)*;base64,[a-z0-9+/]*={0,2}$/i;
export const isSafeDataUrl = (url) => typeof url === 'string' && DATA_URL.test(url);

export async function registerCustomFont(name, dataUrl) {
  if (!isSafeDataUrl(dataUrl)) throw new Error('Not a font file');
  const face = new FontFace(name, `url("${dataUrl}")`);
  await face.load();
  document.fonts.add(face);
  custom.add(name);
}

// Resolves when every named font has finished loading (or after a timeout).
export function whenFontsReady(names, timeout = 5000) {
  names.forEach(ensureFont);
  const all = Promise.all(names.map(n => loading.get(n)).filter(Boolean)).then(() => document.fonts.ready);
  return Promise.race([all, new Promise(r => setTimeout(r, timeout))]);
}

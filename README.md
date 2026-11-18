# Label Generator

A static web app that turns a CSV file into printable Avery label sheets. Everything runs in the
browser – your data is never uploaded – and there is no build step.

## Features

- **Common Avery sheets** for US Letter (5160, 5161, 5162, 5163, 5164, 5165, 5167, 5168, 5195, 5266,
  5395, 8371, 22806, 5294) and A4 (L7159–L7173, L7651, L7167), plus fully custom dimensions.
- **CSV import** with automatic delimiter detection (comma, semicolon, tab, pipe). Click a column to
  drop it on the label as a merge field, or drag it to where you want it.
- **WYSIWYG editor**: every merge field, text block and image is a box you can drag, resize, snap
  rotate and nudge. Double-click a text box to edit it in place; mix fields and text with `{{Column}}`.
- **Multi-select and groups**: Ctrl/Cmd/Shift+click or drag a rectangle to select several boxes,
  then move, align, distribute evenly, restyle, duplicate or delete them together. Ctrl/Cmd+G groups boxes so they
  always move as one; Ctrl/Cmd+Shift+G ungroups. Ctrl/Cmd+C, X and V copy, cut and paste boxes,
  and Ctrl/Cmd+B, I and U toggle bold, italic and underline, including while editing text.
- **Conditional text**: `{{#Column}}…{{/Column}}` appears only when the column has a value, and
  `{{^Column}}…{{/Column}}` only when it is empty. For example
  `{{Last}}, {{First}}{{#Preferred}} ({{Preferred}}){{/Preferred}}` prints "Lovelace, Ada (Addie)"
  or just "Lovelace, Ada". The *Insert conditional text* menu writes these for you.
- **Rich text**: select part of a text box and press Ctrl/Cmd+B, I or U to make just those words
  bold, italic or underlined (stored as `<b>`, `<i>`, `<u>` tags). A merge field is always styled
  as a whole, and styling works inside conditional text.
- **Barcodes**: generate Code 128, Code 39, EAN-13, EAN-8, UPC-A, ITF-14, Interleaved 2 of 5,
  Codabar, MSI or QR codes from a merge field.
- **Fonts**: standard system fonts, a set of Google Fonts loaded on demand, or upload your own
  `.ttf` / `.otf` / `.woff` / `.woff2` file.
- **Images**: one image on every label (e.g. a logo), or a different image per row from a column
  holding image URLs or file names of image files you load.
- **Shrink to fit** and **skip empty lines**, so long names and missing "Address 2" values look right.
- **Sheet preview and print options**: start at a given label on a part-used sheet, copies per
  record, outlines for test prints, and a nudge offset to correct printer misalignment.
- Undo/redo, autosave in the browser, and save/open designs as a file.

## Privacy and security

- The design autosaves in the browser. The loaded CSV is kept only for the current tab: it survives
  a reload but is cleared when the tab is closed, so names and addresses don't stay on shared computers.
- The only requests to other sites are the ones you ask for: Google Fonts (fonts.googleapis.com and
  fonts.gstatic.com) when you pick a Google font, and image URLs from a CSV column.
- Images and fonts inside a design file must be embedded `data:` URLs. Anything else, such as a link
  to a remote server, is dropped when the design is opened.
- A Content-Security-Policy in `index.html` makes the browser enforce this: scripts only from this
  site, styles and fonts only from this site and Google Fonts, and no other network connections.

## Printing

Use the **Print…** button and, in the browser's print dialog, set **Scale: 100% / Actual size**
and **Margins: None**. Do a test print on plain paper with *Print outlines* switched on and hold
it against a label sheet before using the real thing. Label dimensions follow Avery's published
templates, but printers vary – use the nudge offset if everything is shifted slightly.

## Run locally

The app uses ES modules, so serve the folder rather than opening `index.html` directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

The included workflow (`.github/workflows/pages.yml`) publishes the site on every push to `main`.
One-time setup: in the repository go to **Settings → Pages** and set **Source** to
**GitHub Actions**. The site will then be available at `https://<user>.github.io/<repo>/`.

All paths are relative, so the site works from any sub-path.

## Third-party code

`vendor/JsBarcode.all.min.js` ([JsBarcode](https://github.com/lindell/JsBarcode), MIT) and
`vendor/qrcode.js` ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT)
provide the barcode encoders.

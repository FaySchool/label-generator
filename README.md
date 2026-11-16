# Label Generator

A static web app that turns a CSV file into printable Avery label sheets. Everything runs in the
browser – your data is never uploaded – and there is no build step.

## Features

- **Common Avery sheets** for US Letter (5160, 5161, 5162, 5163, 5164, 5165, 5167, 5168, 5195, 5266,
  5395, 8371, 22806, 5294) and A4 (L7159–L7173, L7651, L7167), plus fully custom dimensions.
- **CSV import** with automatic delimiter detection (comma, semicolon, tab, pipe). Click a column to
  drop it on the label as a merge field, or drag it to where you want it.
- **WYSIWYG editor**: every merge field, text block and image is a box you can drag, resize, snap
  and nudge. Double-click a text box to edit it in place; mix fields and text with `{{Column}}`.
- **Fonts**: standard system fonts, a set of Google Fonts loaded on demand, or upload your own
  `.ttf` / `.otf` / `.woff` / `.woff2` file.
- **Images**: one image on every label (e.g. a logo), or a different image per row from a column
  holding image URLs or file names of image files you load.
- **Shrink to fit** and **skip empty lines**, so long names and missing "Address 2" values look right.
- **Sheet preview and print options**: start at a given label on a part-used sheet, copies per
  record, outlines for test prints, and a nudge offset to correct printer misalignment.
- Undo/redo, autosave in the browser, and save/open designs as a file.

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

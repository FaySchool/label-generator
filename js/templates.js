// Label sheet definitions. All stored dimensions are in points (1/72 inch).
export const IN = 72;
export const MM = 72 / 25.4;

function make(unit, k, pageW, pageH, id, name, cols, rows, w, h, left, top, pitchX, pitchY, extra = {}) {
  return {
    id, name, unit,
    pageW: pageW * k, pageH: pageH * k,
    cols, rows,
    w: w * k, h: h * k,
    left: left * k, top: top * k,
    pitchX: pitchX * k, pitchY: pitchY * k,
    shape: 'rect',
    ...extra,
  };
}
const letter = (...a) => make('in', IN, 8.5, 11, ...a);
const a4 = (...a) => make('mm', MM, 210, 297, ...a);

export const TEMPLATE_GROUPS = [
  {
    label: 'US Letter (8.5 × 11 in)',
    templates: [
      //      id       name                                        cols rows  w       h       left     top     pitchX  pitchY
      letter('5160', 'Avery 5160 / 8160 – Address 1 × 2⅝ in',        3, 10, 2.625,  1,      0.1875,  0.5,    2.75,   1),
      letter('5161', 'Avery 5161 / 8161 – Address 1 × 4 in',          2, 10, 4,      1,      0.15625, 0.5,    4.1875, 1),
      letter('5162', 'Avery 5162 / 8162 – Address 1⅓ × 4 in',         2, 7,  4,      4 / 3,  0.15625, 5 / 6,  4.1875, 4 / 3),
      letter('5163', 'Avery 5163 / 8163 – Shipping 2 × 4 in',         2, 5,  4,      2,      0.15625, 0.5,    4.1875, 2),
      letter('5164', 'Avery 5164 / 8164 – Shipping 3⅓ × 4 in',        2, 3,  4,      10 / 3, 0.15625, 0.5,    4.1875, 10 / 3),
      letter('5168', 'Avery 5168 – Shipping 3½ × 5 in',               2, 2,  3.5,    5,      0.5,     0.5,    4,      5),
      letter('5165', 'Avery 5165 / 8165 – Full sheet',                1, 1,  8.5,    11,     0,       0,      8.5,    11),
      letter('5167', 'Avery 5167 / 8167 – Return address ½ × 1¾ in',  4, 20, 1.75,   0.5,    0.28125, 0.5,    2.0625, 0.5),
      letter('5195', 'Avery 5195 / 8195 – Return address ⅔ × 1¾ in',  4, 15, 1.75,   2 / 3,  0.28125, 0.5,    2.0625, 2 / 3),
      letter('5266', 'Avery 5266 / 8366 – File folder ⅔ × 3⁷⁄₁₆ in',  2, 15, 3.4375, 2 / 3,  0.53125, 0.5,    4,      2 / 3),
      letter('5395', 'Avery 5395 / 8395 – Name badge 2⅓ × 3⅜ in',     2, 4,  3.375,  7 / 3,  0.6875,  7 / 12, 3.75,   2.5),
      letter('8371', 'Avery 5371 / 8371 – Business card 2 × 3½ in',   2, 5,  3.5,    2,      0.75,    0.5,    3.5,    2),
      letter('22806', 'Avery 22806 – Square 2 × 2 in',                3, 4,  2,      2,      0.625,   0.5625, 2.625,  2.625),
      letter('5294', 'Avery 5294 / 22807 – Round 2½ in',              3, 4,  2.5,    2.5,    0.25,    0.5,    2.75,   2.5, { shape: 'round' }),
    ],
  },
  {
    label: 'A4 (210 × 297 mm)',
    templates: [
      a4('L7160', 'Avery L7160 / J8160 – 63.5 × 38.1 mm',  3, 7,  63.5,  38.1,  7.25, 15.15, 66,    38.1),
      a4('L7159', 'Avery L7159 / J8159 – 63.5 × 33.9 mm',  3, 8,  63.5,  33.9,  7.25, 12.9,  66,    33.9),
      a4('L7161', 'Avery L7161 / J8161 – 63.5 × 46.6 mm',  3, 6,  63.5,  46.6,  7.25, 8.7,   66,    46.6),
      a4('L7162', 'Avery L7162 / J8162 – 99.1 × 33.9 mm',  2, 8,  99.1,  33.9,  4.65, 12.9,  101.6, 33.9),
      a4('L7163', 'Avery L7163 / J8163 – 99.1 × 38.1 mm',  2, 7,  99.1,  38.1,  4.65, 15.15, 101.6, 38.1),
      a4('L7173', 'Avery L7173 / J8173 – 99.1 × 57 mm',    2, 5,  99.1,  57,    4.65, 6,     101.6, 57),
      a4('L7165', 'Avery L7165 / J8165 – 99.1 × 67.7 mm',  2, 4,  99.1,  67.7,  4.65, 13.1,  101.6, 67.7),
      a4('L7651', 'Avery L7651 / J8651 – 38.1 × 21.2 mm',  5, 13, 38.1,  21.2,  4.75, 10.7,  40.6,  21.2),
      a4('L7167', 'Avery L7167 / J8167 – Full sheet',      1, 1,  199.6, 289.1, 5.2,  3.95,  199.6, 289.1),
    ],
  },
];

export const TEMPLATES = TEMPLATE_GROUPS.flatMap(g => g.templates);

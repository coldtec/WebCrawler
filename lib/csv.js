// Aufbau der beiden SAP-Importdateien. Format exakt aus echten Importdateien übernommen – nicht verändern.
import iconv from 'iconv-lite';
import {
  formatPreis, parsePreis, oneLine, timestamp,
  buildKeywords, buildKurzbeschrieb, buildLangbeschrieb, buildVerkaufstext,
} from './format.js';

export const FSP_HEADER = [
  'ArtikelNr.', 'BezeichnungShop', 'Google-Kat.', 'ProdukttypShop', 'KonfigurationGrösse',
  'KonfigurationFarbe', 'SichtbarkeitShop', 'vonRMAausschliessen', 'NichtaufToppreise',
  'StockwerkPauschale', 'StockwerkproGerät', 'InstallationPauschale', 'InstallationproGerät',
  'Vaterartikel', 'PreisShop',
];

export const CT_HEADER = ['ArtikelNr.', 'Keywords', 'ShopKurzbeschrieb', 'ShopLangbeschrieb', 'VerkaufstextCT'];

export const DEFAULTS = {
  produkttypShop: 'simple',
  sichtbarkeitShop: '4',
  vonRMAausschliessen: 'N',
  nichtAufToppreise: 'Y',
  konfigurationGroesse: '',
  konfigurationFarbe: '',
  stockwerkPauschale: '',
  stockwerkProGeraet: '',
  installationPauschale: '',
  installationProGeraet: '',
  vaterartikel: '',
};

const EOL = '\r\n';

export function escapeField(value) {
  const s = String(value ?? '');
  if (/[;"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toLine(fields) {
  return fields.map(escapeField).join(';');
}

/** Pflichtfelder prüfen. Liefert Liste von Fehlermeldungen (leer = ok). */
export function validateArtikel(a, mapping) {
  const errors = [];
  if (!oneLine(a?.artikelnr)) errors.push({ field: 'artikelnr', msg: 'Artikelnummer fehlt' });
  if (!oneLine(a?.bezeichnung)) errors.push({ field: 'bezeichnung', msg: 'Artikelbezeichnung fehlt' });
  if (!oneLine(a?.gruppe)) errors.push({ field: 'gruppe', msg: 'Artikelgruppe fehlt' });
  else if (mapping && !Object.hasOwn(mapping, a.gruppe)) errors.push({ field: 'gruppe', msg: `Artikelgruppe „${a.gruppe}" ist im Mapping nicht vorhanden` });
  if (!Number.isFinite(parsePreis(a?.preis))) errors.push({ field: 'preis', msg: 'Preis fehlt oder ist ungültig (z.B. 59.90)' });
  for (const k of ['vonRMAausschliessen', 'nichtAufToppreise']) {
    const v = a?.[k] ?? DEFAULTS[k];
    if (v !== 'Y' && v !== 'N') errors.push({ field: k, msg: `${k} muss Y oder N sein` });
  }
  return errors;
}

function opt(a, key) {
  const v = a?.[key];
  return oneLine(v === undefined || v === null ? DEFAULTS[key] : v);
}

/** Baut beide Dateien als Feldlisten + Rohtext. mapping: { gruppe: code } */
export function buildExport(a, mapping) {
  const fspValues = [
    oneLine(a.artikelnr),
    oneLine(a.bezeichnung),
    oneLine(mapping[a.gruppe]),
    opt(a, 'produkttypShop'),
    opt(a, 'konfigurationGroesse'),
    opt(a, 'konfigurationFarbe'),
    opt(a, 'sichtbarkeitShop'),
    opt(a, 'vonRMAausschliessen'),
    opt(a, 'nichtAufToppreise'),
    opt(a, 'stockwerkPauschale'),
    opt(a, 'stockwerkProGeraet'),
    opt(a, 'installationPauschale'),
    opt(a, 'installationProGeraet'),
    opt(a, 'vaterartikel'),
    formatPreis(a.preis),
  ];

  const ctValues = [
    oneLine(a.artikelnr),
    buildKeywords(a.keywords),
    buildKurzbeschrieb(a.kurz),
    buildLangbeschrieb(a.lang),
    buildVerkaufstext({ intro: a.verkaufIntro, heading: a.verkaufHeading, merkmale: a.verkaufMerkmale }),
  ];

  const fspRaw = toLine(FSP_HEADER) + EOL + toLine(fspValues) + EOL;
  const ctRaw = toLine(CT_HEADER) + EOL + toLine(ctValues) + EOL;

  return {
    fsp: { fields: FSP_HEADER.map((h, i) => [h, fspValues[i]]), raw: fspRaw },
    ct: { fields: CT_HEADER.map((h, i) => [h, ctValues[i]]), raw: ctRaw },
    warnings: findUnencodable({ ...Object.fromEntries(FSP_HEADER.map((h, i) => [h, fspValues[i]])), ...Object.fromEntries(CT_HEADER.map((h, i) => ['CT ' + h, ctValues[i]])) }),
  };
}

/** Zeichen, die in Windows-1252 nicht darstellbar sind, je Feld. */
export function findUnencodable(fieldMap) {
  const problems = [];
  for (const [name, value] of Object.entries(fieldMap)) {
    const bad = new Set();
    for (const ch of String(value ?? '')) {
      if (iconv.decode(iconv.encode(ch, 'win1252'), 'win1252') !== ch) bad.add(ch);
    }
    if (bad.size) problems.push({ field: name, chars: [...bad] });
  }
  return problems;
}

export function encodeWin1252(text) {
  return iconv.encode(text, 'win1252');
}

export function fileNames(d = new Date()) {
  const ts = timestamp(d);
  return { fsp: `${ts}_FSP_Import.csv`, ct: `${ts}_CT_Import.csv` };
}

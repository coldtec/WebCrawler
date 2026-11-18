import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExport, escapeField, encodeWin1252, validateArtikel, fileNames, FSP_HEADER, CT_HEADER,
} from '../lib/csv.js';
import {
  formatPreis, buildKurzbeschrieb, buildLangbeschrieb, buildVerkaufstext, buildKeywords,
} from '../lib/format.js';
import { parseAgentJson } from '../lib/agent.js';

const mapping = { 'Bräter': '655', 'Kühl-Gefrierkombi': '686' };
const artikel = {
  ean: '4007371064946',
  artikelnr: '115745',
  bezeichnung: 'Berlinger Haus BH/6494 Ovaler Bräter mit Deckel Ø 33 cm Matt Black Collection',
  gruppe: 'Bräter',
  preis: '59.90',
  keywords: 'Bräter, Gusseisen, Induktion',
  kurz: 'Hochwertiges Gusseisen\nRobuste Emaille-Beschichtung\nFür alle Herdarten inklusive Induktion',
  lang: 'Erster Absatz.\n\nZweiter Absatz.',
  verkaufIntro: 'Mit dem Bräter...',
  verkaufHeading: 'Produktinformation',
  verkaufMerkmale: 'Ovaler Bräter mit Deckel\nDurchmesser: 33 cm',
};

test('FSP-Zeile entspricht exakt dem Beispiel', () => {
  const { fsp } = buildExport(artikel, mapping);
  const [header, line, rest] = fsp.raw.split('\r\n');
  assert.equal(header, FSP_HEADER.join(';'));
  assert.equal(header, 'ArtikelNr.;BezeichnungShop;Google-Kat.;ProdukttypShop;KonfigurationGrösse;KonfigurationFarbe;SichtbarkeitShop;vonRMAausschliessen;NichtaufToppreise;StockwerkPauschale;StockwerkproGerät;InstallationPauschale;InstallationproGerät;Vaterartikel;PreisShop');
  assert.equal(line, '115745;Berlinger Haus BH/6494 Ovaler Bräter mit Deckel Ø 33 cm Matt Black Collection;655;simple;;;4;N;Y;;;;;;59.9');
  assert.equal(rest, '');
});

test('CT-Datei: Header und Feldaufbau', () => {
  const { ct } = buildExport(artikel, mapping);
  const [header] = ct.raw.split('\r\n');
  assert.equal(header, CT_HEADER.join(';'));
  const f = Object.fromEntries(ct.fields);
  assert.equal(f['Keywords'], 'Bräter, Gusseisen, Induktion');
  assert.equal(f['ShopKurzbeschrieb'], 'Hochwertiges Gusseisen<BR> Robuste Emaille-Beschichtung<BR> Für alle Herdarten inklusive Induktion<BR>');
  assert.equal(f['ShopLangbeschrieb'], '<P>Erster Absatz.</P><P>Zweiter Absatz.</P>');
  assert.equal(f['VerkaufstextCT'], '<P>Mit dem Bräter...</P><br><P><STRONG>Produktinformation</STRONG></P><UL><LI>Ovaler Bräter mit Deckel</LI> <LI>Durchmesser: 33 cm</LI></UL>');
});

test('EAN wird nicht exportiert', () => {
  const { fsp, ct } = buildExport(artikel, mapping);
  assert.ok(!fsp.raw.includes(artikel.ean));
  assert.ok(!ct.raw.includes(artikel.ean));
});

test('Preisformat', () => {
  assert.equal(formatPreis('59.90'), '59.9');
  assert.equal(formatPreis('60.00'), '60');
  assert.equal(formatPreis('60'), '60');
  assert.equal(formatPreis('12,05'), '12.05');
  assert.equal(formatPreis('1299.5'), '1299.5');
  assert.throws(() => formatPreis('abc'));
});

test('CSV-Escaping', () => {
  assert.equal(escapeField('normal'), 'normal');
  assert.equal(escapeField('a;b'), '"a;b"');
  assert.equal(escapeField('Zoll 6"'), '"Zoll 6"""');
  assert.equal(escapeField('a\nb'), '"a\nb"');
});

test('Windows-1252-Kodierung und CRLF', () => {
  const { fsp } = buildExport(artikel, mapping);
  const buf = encodeWin1252(fsp.raw);
  assert.ok(buf.includes(Buffer.from([0xf6]))); // ö in KonfigurationGrösse
  assert.ok(buf.includes(Buffer.from([0xe4]))); // ä in Bräter / StockwerkproGerät
  assert.ok(buf.includes(Buffer.from([0xd8]))); // Ø
  assert.ok(!buf.includes(Buffer.from([0xc3]))); // kein UTF-8
  assert.equal(buf.subarray(-2).toString('latin1'), '\r\n');
});

test('Warnung bei nicht darstellbaren Zeichen', () => {
  const { warnings } = buildExport({ ...artikel, bezeichnung: 'Topf ≈ 20 cm' }, mapping);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].chars, ['≈']);
});

test('Validierung der Pflichtfelder', () => {
  assert.equal(validateArtikel(artikel, mapping).length, 0);
  const errs = validateArtikel({ ...artikel, artikelnr: ' ', preis: 'x', gruppe: 'Unbekannt' }, mapping).map((e) => e.field);
  assert.deepEqual(errs.sort(), ['artikelnr', 'gruppe', 'preis']);
});

test('Dateinamen', () => {
  const n = fileNames(new Date(2026, 10, 18, 9, 5));
  assert.equal(n.fsp, '202611180905_FSP_Import.csv');
  assert.equal(n.ct, '202611180905_CT_Import.csv');
});

test('Hilfsfunktionen', () => {
  assert.equal(buildKeywords(['a', ' b ', '']), 'a, b');
  assert.equal(buildKurzbeschrieb(''), '');
  assert.equal(buildLangbeschrieb('A\nB\n\n\nC'), '<P>A B</P><P>C</P>');
  assert.equal(buildVerkaufstext({ intro: 'X', heading: '', merkmale: '- M1\n- M2' }), '<P>X</P><br><P><STRONG>Produktinformation</STRONG></P><UL><LI>M1</LI> <LI>M2</LI></UL>');
});

test('Agent-JSON parsen (mit Code-Fences und Vortext)', () => {
  const r = parseAgentJson('Hier:\n```json\n{"keywords":["a"],"kurzStichpunkte":["k"],"langIntro":"L","verkaufIntro":"V","verkaufMerkmale":["m"],"quellenHinweis":"generisch"}\n```');
  assert.deepEqual(r.keywords, ['a']);
  assert.equal(r.verkaufHeading, 'Produktinformation');
  assert.throws(() => parseAgentJson('kein json'), /kein JSON/);
  assert.throws(() => parseAgentJson('{kaputt}'), /kein gültiges JSON/);
});

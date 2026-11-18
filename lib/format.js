// Reine Formatierungsfunktionen für den SAP/Shop-Export.

/** Preis: Dezimalpunkt, keine überflüssigen Nachkommastellen (59.90 -> "59.9", 60.00 -> "60"). */
export function parsePreis(input) {
  if (input === null || input === undefined) return NaN;
  const s = String(input).trim().replace(/'/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function formatPreis(input) {
  const n = parsePreis(input);
  if (!Number.isFinite(n)) throw new Error('Ungültiger Preis');
  let s = n.toFixed(2);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** Zeilen aus einem mehrzeiligen Textfeld (leere Zeilen und führende Aufzählungszeichen entfernt). */
export function toLines(text) {
  if (Array.isArray(text)) text = text.join('\n');
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]\s+)/, '').trim())
    .filter((l) => l.length > 0);
}

/** Absätze, getrennt durch mindestens eine Leerzeile. Zeilenumbrüche innerhalb eines Absatzes -> Leerzeichen. */
export function toParagraphs(text) {
  return String(text ?? '')
    .split(/\r?\n[ \t]*\r?\n/)
    .map((p) => p.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Einzelnes Feld einzeilig machen (Zeilenumbrüche -> Leerzeichen). */
export function oneLine(v) {
  return String(v ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

export function buildKeywords(text) {
  // Komma- oder zeilengetrennte Eingabe akzeptieren.
  const parts = Array.isArray(text) ? text : String(text ?? '').split(/[,\r\n]+/);
  return parts.map((k) => oneLine(k)).filter(Boolean).join(', ');
}

export function buildKurzbeschrieb(text) {
  const lines = toLines(text);
  if (lines.length === 0) return '';
  return lines.join('<BR> ') + '<BR>';
}

export function buildLangbeschrieb(text) {
  return toParagraphs(text).map((p) => `<P>${p}</P>`).join('');
}

export function buildVerkaufstext({ intro, heading, merkmale }) {
  const introTxt = toParagraphs(intro).join(' ');
  const head = oneLine(heading) || 'Produktinformation';
  const items = toLines(merkmale).map((m) => `<LI>${m}</LI>`).join(' ');
  return `<P>${introTxt}</P><br><P><STRONG>${head}</STRONG></P><UL>${items}</UL>`;
}

/** YYYYMMDDHHmm in lokaler Zeit. */
export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

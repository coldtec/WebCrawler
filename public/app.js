'use strict';

const $ = (sel) => document.querySelector(sel);
const form = $('#form');
let lastArtikel = null;
let config = { outputDir: '', agentConfigured: false };

// ---------- Hilfsfunktionen ----------
async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Server nicht erreichbar. Läuft die App noch (npm start)?'), { code: 'NETWORK' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Fehler (HTTP ${res.status})`);
    err.code = data && data.code;
    err.fields = data && data.fields;
    throw err;
  }
  return data;
}

function show(el, text) {
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function setStep(n) {
  for (const i of [1, 2, 3]) {
    $(`#step${i}`).classList.toggle('hidden', i !== n);
    $(`#step-ind-${i}`).classList.toggle('active', i === n);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function collect() {
  const fd = new FormData(form);
  const a = {};
  for (const [k, v] of fd.entries()) a[k] = typeof v === 'string' ? v : '';
  return a;
}

function td(text, tag = 'td') {
  const c = document.createElement(tag);
  c.textContent = text;
  return c;
}

// ---------- Konfiguration, Mapping, Historie ----------
async function loadConfig() {
  try {
    config = await api('GET', '/api/config');
  } catch { /* ignore */ }
  $('#cfg-info').textContent = `Ausgabeordner: ${config.outputDir || '–'} · Agent: ${config.agentConfigured ? 'konfiguriert' : 'nicht konfiguriert (.env)'}`;
  $('#out-dir-2').textContent = config.outputDir || '';
  if (!config.agentConfigured) {
    $('#gen-status').textContent = 'Agent nicht konfiguriert – Texte bitte manuell eintragen.';
  }
}

async function loadMapping() {
  let mapping = {};
  try {
    mapping = await api('GET', '/api/mapping');
  } catch (e) {
    show($('#mapping-msg'), e.message);
  }
  const sel = form.elements.gruppe;
  const current = sel.value;
  sel.replaceChildren(new Option('– bitte wählen –', ''));
  for (const [g, code] of Object.entries(mapping)) sel.add(new Option(`${g} (${code})`, g));
  if (current && Object.hasOwn(mapping, current)) sel.value = current;

  const tbody = $('#tbl-mapping tbody');
  tbody.replaceChildren();
  for (const [g, code] of Object.entries(mapping)) {
    const tr = document.createElement('tr');
    tr.append(td(g), td(code));
    const cell = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'danger small';
    btn.textContent = 'Löschen';
    btn.addEventListener('click', async () => {
      if (!confirm(`Artikelgruppe „${g}" löschen?`)) return;
      try {
        await api('DELETE', `/api/mapping/${encodeURIComponent(g)}`);
        show($('#mapping-msg'), '');
        await loadMapping();
      } catch (e) { show($('#mapping-msg'), e.message); }
    });
    cell.append(btn);
    tr.append(cell);
    tbody.append(tr);
  }
}

async function loadHistory() {
  const tbody = $('#tbl-history tbody');
  tbody.replaceChildren();
  let list = [];
  try { list = await api('GET', '/api/history?limit=20'); } catch { return; }
  if (!list.length) {
    const tr = document.createElement('tr');
    const c = td('Noch keine Exporte.');
    c.colSpan = 5;
    tr.append(c);
    tbody.append(tr);
    return;
  }
  for (const h of list) {
    const tr = document.createElement('tr');
    const zeit = new Date(h.zeit).toLocaleString('de-CH');
    tr.append(td(zeit), td(h.artikelnr), td(h.bezeichnung), td(h.ean || ''), td((h.dateien || []).join(', ')));
    tbody.append(tr);
  }
}

$('#mapping-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await api('POST', '/api/mapping', { gruppe: f.gruppe.value, code: f.code.value });
    f.reset();
    show($('#mapping-msg'), '');
    await loadMapping();
  } catch (e) { show($('#mapping-msg'), e.message); }
});

// ---------- Texte generieren ----------
let genTimer = null;
$('#btn-generate').addEventListener('click', async () => {
  const a = collect();
  const btn = $('#btn-generate');
  show($('#gen-error'), '');
  if (!a.bezeichnung.trim()) {
    show($('#gen-error'), 'Bitte zuerst die Artikelbezeichnung eingeben.');
    form.elements.bezeichnung.focus();
    return;
  }
  const hasText = ['keywords', 'kurz', 'lang', 'verkaufIntro', 'verkaufMerkmale'].some((k) => a[k].trim());
  if (hasText && !confirm('Vorhandene Texte werden überschrieben. Fortfahren?')) return;

  btn.disabled = true;
  const t0 = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('#gen-status').textContent = `⏳ Agent recherchiert und schreibt … ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  genTimer = setInterval(tick, 1000);
  try {
    const r = await api('POST', '/api/generate', { ean: a.ean, artikelnr: a.artikelnr, bezeichnung: a.bezeichnung, gruppe: a.gruppe });
    const el = form.elements;
    el.keywords.value = r.keywords.join(', ');
    el.kurz.value = r.kurzStichpunkte.join('\n');
    el.lang.value = r.langIntro;
    el.verkaufIntro.value = r.verkaufIntro;
    el.verkaufHeading.value = r.verkaufHeading || 'Produktinformation';
    el.verkaufMerkmale.value = r.verkaufMerkmale.join('\n');
    el.quellenHinweis.value = r.quellenHinweis;
    showQuelle();
    $('#gen-status').textContent = `✔ Texte generiert (${Math.round((Date.now() - t0) / 1000)} s) – bitte prüfen und bei Bedarf anpassen.`;
  } catch (e) {
    $('#gen-status').textContent = '';
    show($('#gen-error'), `Textgenerierung fehlgeschlagen: ${e.message} Du kannst die Texte auch manuell eintragen.`);
  } finally {
    clearInterval(genTimer);
    btn.disabled = false;
  }
});

function showQuelle() {
  const q = form.elements.quellenHinweis.value;
  $('#quelle-text').textContent = q;
  $('#quelle-box').classList.toggle('hidden', !q);
}

// ---------- Validierung & Prüfen ----------
const REQUIRED = ['artikelnr', 'bezeichnung', 'gruppe', 'preis'];

function validateClient(a) {
  const bad = [];
  for (const k of REQUIRED) if (!String(a[k] || '').trim()) bad.push(k);
  const p = String(a.preis || '').trim().replace(/'/g, '').replace(',', '.');
  if (p && !/^\d+(\.\d+)?$/.test(p)) bad.push('preis');
  return [...new Set(bad)];
}

function markInvalid(fields) {
  for (const el of form.querySelectorAll('.invalid')) el.classList.remove('invalid');
  for (const f of fields || []) form.elements[f]?.classList.add('invalid');
}

function fillTable(sel, fields) {
  const tbody = $(`${sel} tbody`);
  tbody.replaceChildren();
  for (const [name, value] of fields) {
    const tr = document.createElement('tr');
    const v = td(value);
    if (value === '') v.classList.add('empty');
    tr.append(td(name, 'th'), v);
    tbody.append(tr);
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const a = collect();
  const bad = validateClient(a);
  markInvalid(bad);
  if (bad.length) {
    show($('#global-msg'), 'Bitte Pflichtfelder prüfen: Artikelnummer, Artikelbezeichnung, Artikelgruppe und gültiger Preis (z.B. 59.90).');
    $('#global-msg').className = 'msg error';
    form.elements[bad[0]].focus();
    return;
  }
  show($('#global-msg'), '');
  $('#review-status').textContent = 'Vorschau wird erstellt …';
  try {
    const exp = await api('POST', '/api/preview', { artikel: a });
    lastArtikel = a;
    fillTable('#tbl-fsp', exp.fsp.fields);
    fillTable('#tbl-ct', exp.ct.fields);
    $('#raw-fsp').textContent = exp.fsp.raw;
    $('#raw-ct').textContent = exp.ct.raw;
    const q = a.quellenHinweis;
    const rq = $('#review-quelle');
    rq.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = 'Quellenhinweis: ';
    rq.append(strong, q ? q : 'Texte wurden manuell erfasst (keine Agent-Generierung).');
    show($('#export-error'), '');
    if (exp.warnings && exp.warnings.length) {
      show($('#export-error'), 'Achtung – nicht in Windows-1252 darstellbare Zeichen: ' +
        exp.warnings.map((w) => `${w.field}: ${w.chars.join(' ')}`).join('; ') + '. Bitte zurück und ersetzen.');
    }
    $('#export-status').textContent = '';
    setStep(2);
  } catch (e) {
    markInvalid(e.fields);
    show($('#global-msg'), e.message);
    $('#global-msg').className = 'msg error';
  } finally {
    $('#review-status').textContent = '';
  }
});

$('#btn-back').addEventListener('click', () => setStep(1));

$('#btn-export').addEventListener('click', async () => {
  const btn = $('#btn-export');
  btn.disabled = true;
  show($('#export-error'), '');
  $('#export-status').textContent = '⏳ Dateien werden geschrieben …';
  try {
    const r = await api('POST', '/api/export', { artikel: lastArtikel });
    const ul = $('#done-files');
    ul.replaceChildren(...r.files.map((f) => { const li = document.createElement('li'); li.textContent = f; return li; }));
    $('#done-dir').textContent = r.dir;
    setStep(3);
    loadHistory();
  } catch (e) {
    show($('#export-error'), e.message);
  } finally {
    btn.disabled = false;
    $('#export-status').textContent = '';
  }
});

$('#btn-new').addEventListener('click', () => {
  form.reset(); // setzt auch die Standardwerte der erweiterten Felder zurück
  form.elements.quellenHinweis.value = '';
  showQuelle();
  markInvalid([]);
  show($('#gen-error'), '');
  $('#gen-status').textContent = config.agentConfigured ? '' : 'Agent nicht konfiguriert – Texte bitte manuell eintragen.';
  lastArtikel = null;
  setStep(1);
  form.elements.ean.focus();
});

// ---------- Start ----------
loadConfig();
loadMapping();
loadHistory();

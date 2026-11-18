import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { buildExport, validateArtikel, encodeWin1252, fileNames } from './lib/csv.js';
import { generateTexts, agentConfigured, AgentError, describeForLog } from './lib/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '\\\\srv102\\Datenaustausch\\Artikelimport';
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 180000;

const store = createStore(path.join(__dirname, 'data'));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(`[${req.method} ${req.path}] ${describeForLog(err)}: ${err?.message ?? ''}`);
  res.status(500).json({ error: 'Interner Fehler: ' + (err?.message || 'unbekannt') });
});

app.get('/api/config', (req, res) => {
  res.json({ outputDir: OUTPUT_DIR, agentConfigured: agentConfigured() });
});

// --- Artikelgruppen-Mapping ---
app.get('/api/mapping', wrap(async (req, res) => {
  res.json(await store.getMapping());
}));

app.post('/api/mapping', wrap(async (req, res) => {
  const gruppe = String(req.body?.gruppe ?? '').trim();
  const code = String(req.body?.code ?? '').trim();
  if (!gruppe || !code) return res.status(400).json({ error: 'Artikelgruppe und Google-Kat.-Code sind erforderlich.' });
  if (/[;"\r\n]/.test(code)) return res.status(400).json({ error: 'Der Google-Kat.-Code darf kein ; oder " enthalten.' });
  res.json(await store.setMapping(gruppe, code));
}));

app.delete('/api/mapping/:gruppe', wrap(async (req, res) => {
  const m = await store.deleteMapping(req.params.gruppe);
  if (!m) return res.status(404).json({ error: 'Artikelgruppe nicht gefunden.' });
  res.json(m);
}));

// --- Texte generieren ---
app.post('/api/generate', wrap(async (req, res) => {
  const { ean, artikelnr, bezeichnung, gruppe } = req.body || {};
  if (!String(bezeichnung ?? '').trim()) return res.status(400).json({ error: 'Für die Textgenerierung wird mindestens die Artikelbezeichnung benötigt.', code: 'VALIDATION' });
  const started = Date.now();
  try {
    const texts = await generateTexts({ ean, artikelnr, bezeichnung, gruppe: gruppe || 'unbekannt' }, { timeoutMs: AGENT_TIMEOUT_MS });
    console.log(`[generate] ok in ${Math.round((Date.now() - started) / 1000)}s`);
    res.json(texts);
  } catch (err) {
    const e = err instanceof AgentError ? err : new AgentError('UNKNOWN', 'Unerwarteter Fehler bei der Textgenerierung.');
    console.error(`[generate] ${e.code} nach ${Math.round((Date.now() - started) / 1000)}s`);
    const status = { NOT_CONFIGURED: 503, RATE_LIMIT: 429, TIMEOUT: 504, INVALID_JSON: 502 }[e.code] || 502;
    res.status(status).json({ error: e.message, code: e.code });
  }
}));

// --- Vorschau & Export ---
async function prepare(req, res) {
  const artikel = req.body?.artikel;
  const mapping = await store.getMapping();
  const errors = validateArtikel(artikel, mapping);
  if (errors.length) {
    res.status(400).json({ error: errors.map((e) => e.msg).join(' · '), fields: errors.map((e) => e.field) });
    return null;
  }
  return { artikel, exp: buildExport(artikel, mapping) };
}

app.post('/api/preview', wrap(async (req, res) => {
  const p = await prepare(req, res);
  if (!p) return;
  res.json(p.exp);
}));

app.post('/api/export', wrap(async (req, res) => {
  const p = await prepare(req, res);
  if (!p) return;
  const { artikel, exp } = p;
  if (exp.warnings.length) {
    const list = exp.warnings.map((w) => `${w.field}: ${w.chars.map((c) => `„${c}"`).join(' ')}`).join('; ');
    return res.status(400).json({ error: `Folgende Zeichen sind in Windows-1252 nicht darstellbar und müssen ersetzt werden – ${list}` });
  }

  try {
    await fs.access(OUTPUT_DIR);
  } catch {
    return res.status(500).json({ error: `Zielordner nicht erreichbar: ${OUTPUT_DIR} (Netzwerkverbindung/Berechtigung oder OUTPUT_DIR in .env prüfen).` });
  }

  const names = fileNames(new Date());
  const fspPath = path.join(OUTPUT_DIR, names.fsp);
  const ctPath = path.join(OUTPUT_DIR, names.ct);
  try {
    // 'wx' = nie bestehende Dateien überschreiben
    await fs.writeFile(fspPath, encodeWin1252(exp.fsp.raw), { flag: 'wx' });
    try {
      await fs.writeFile(ctPath, encodeWin1252(exp.ct.raw), { flag: 'wx' });
    } catch (err) {
      await fs.unlink(fspPath).catch(() => {});
      throw err;
    }
  } catch (err) {
    if (err.code === 'EEXIST') {
      return res.status(409).json({ error: `Für diese Minute existiert bereits eine Importdatei (${names.fsp} / ${names.ct}). Bitte kurz warten und in der nächsten Minute erneut auf „Dateien erzeugen" klicken.` });
    }
    console.error(`[export] Schreibfehler ${err.code || ''}`);
    return res.status(500).json({ error: `Dateien konnten nicht geschrieben werden (${err.code || err.message}).` });
  }

  const entry = {
    zeit: new Date().toISOString(),
    artikelnr: String(artikel.artikelnr).trim(),
    bezeichnung: String(artikel.bezeichnung).trim(),
    ean: String(artikel.ean ?? '').trim(),
    dateien: [names.fsp, names.ct],
    ordner: OUTPUT_DIR,
  };
  try {
    await store.addHistory(entry);
  } catch (err) {
    console.error(`[export] Historie konnte nicht geschrieben werden: ${err.code || err.message}`);
  }
  console.log(`[export] ${names.fsp}, ${names.ct}`);
  res.json({ dir: OUTPUT_DIR, files: [names.fsp, names.ct] });
}));

app.get('/api/history', wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
  res.json(await store.getHistory(limit));
}));

app.listen(PORT, HOST, () => {
  console.log(`Coldtec Artikelstammdaten läuft auf http://localhost:${PORT}`);
  console.log(`Ausgabeordner: ${OUTPUT_DIR}`);
  console.log(`Agent konfiguriert: ${agentConfigured() ? 'ja' : 'nein (.env prüfen)'}`);
});

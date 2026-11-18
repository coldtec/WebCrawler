// Lokale Persistenz: Artikelgruppen-Mapping (JSON) und Export-Historie (JSON-Lines).
import fs from 'node:fs/promises';
import path from 'node:path';

const SEED = { 'Kühl-Gefrierkombi': '686', 'Kochtopf': '10' };

export function createStore(dataDir) {
  const mappingFile = path.join(dataDir, 'mapping.json');
  const historyFile = path.join(dataDir, 'history.jsonl');

  async function ensureDir() {
    await fs.mkdir(dataDir, { recursive: true });
  }

  async function writeAtomic(file, content) {
    await ensureDir();
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, file);
  }

  async function getMapping() {
    try {
      const raw = await fs.readFile(mappingFile, 'utf8');
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : {};
    } catch (err) {
      if (err.code === 'ENOENT') {
        await writeAtomic(mappingFile, JSON.stringify(SEED, null, 2));
        return { ...SEED };
      }
      throw err;
    }
  }

  async function setMapping(gruppe, code) {
    const m = await getMapping();
    m[gruppe] = code;
    const sorted = Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b, 'de')));
    await writeAtomic(mappingFile, JSON.stringify(sorted, null, 2));
    return sorted;
  }

  async function deleteMapping(gruppe) {
    const m = await getMapping();
    if (!Object.hasOwn(m, gruppe)) return null;
    delete m[gruppe];
    await writeAtomic(mappingFile, JSON.stringify(m, null, 2));
    return m;
  }

  async function addHistory(entry) {
    await ensureDir();
    await fs.appendFile(historyFile, JSON.stringify(entry) + '\n', 'utf8');
  }

  async function getHistory(limit = 20) {
    let raw;
    try {
      raw = await fs.readFile(historyFile, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const entries = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch { /* defekte Zeile überspringen */ }
    }
    return entries.slice(-limit).reverse();
  }

  return { getMapping, setMapping, deleteMapping, addHistory, getHistory };
}

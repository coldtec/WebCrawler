// Anbindung an den Anthropic Managed Agent (nur serverseitig!).
// Secrets kommen ausschliesslich aus process.env und werden nie geloggt oder ans Frontend geschickt.
import Anthropic from '@anthropic-ai/sdk';

export class AgentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function agentConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AGENT_ID && process.env.ANTHROPIC_ENVIRONMENT_ID);
}

export function buildPrompt({ ean, bezeichnung, gruppe }) {
  return `Du schreibst Shop-Texte für einen Schweizer Haushaltswaren-Online-Shop (Coldtec), im Duz-Stil, werblich aber sachlich, Deutsch (Schweiz). Falls du Websuche oder andere Tools zur Verfügung hast, recherchiere zuerst kurz anhand der EAN ${ean || '(keine EAN angegeben)'} und der Artikelbezeichnung „${bezeichnung}" nach echten Produktfakten (Material, Masse, Besonderheiten). Nutze reale gefundene Fakten wo möglich; wo nichts Verlässliches gefunden wird, schreibe plausiblen, aber als solchen erkennbaren Standardtext. Artikelgruppe: ${gruppe}. Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, keine Erklärungen, keine Code-Fences: {"keywords":[3-5 kurze Suchbegriffe],"kurzStichpunkte":[2-4 kurze Stichpunkte],"langIntro":"werblicher Absatz, 3-5 Sätze","verkaufIntro":"weiterer werblicher Absatz, 3-5 Sätze, anders formuliert als langIntro","verkaufHeading":"Produktinformation","verkaufMerkmale":[5-8 kurze Stichpunkte, je max. 6 Wörter],"quellenHinweis":"kurzer Hinweis ob Fakten recherchiert oder generisch sind"}.`;
}

/** JSON aus der Agent-Antwort extrahieren und normalisieren. */
export function parseAgentJson(text) {
  if (!text || !text.trim()) throw new AgentError('INVALID_JSON', 'Der Agent hat keine Antwort geliefert.');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AgentError('INVALID_JSON', 'Die Antwort des Agenten enthielt kein JSON-Objekt.');
  let obj;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new AgentError('INVALID_JSON', 'Die Antwort des Agenten war kein gültiges JSON.');
  }
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : []);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const result = {
    keywords: arr(obj.keywords),
    kurzStichpunkte: arr(obj.kurzStichpunkte),
    langIntro: str(obj.langIntro),
    verkaufIntro: str(obj.verkaufIntro),
    verkaufHeading: str(obj.verkaufHeading) || 'Produktinformation',
    verkaufMerkmale: arr(obj.verkaufMerkmale),
    quellenHinweis: str(obj.quellenHinweis) || 'Kein Quellenhinweis vom Agenten geliefert.',
  };
  if (!result.keywords.length && !result.kurzStichpunkte.length && !result.langIntro && !result.verkaufIntro && !result.verkaufMerkmale.length) {
    throw new AgentError('INVALID_JSON', 'Das JSON des Agenten enthielt keine verwertbaren Texte.');
  }
  return result;
}

function translateError(err) {
  if (err instanceof AgentError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AgentError('TIMEOUT', 'Zeitüberschreitung bei der Verbindung zu Anthropic.');
  if (err instanceof Anthropic.APIUserAbortError) return new AgentError('TIMEOUT', 'Zeitüberschreitung: Der Agent hat nicht rechtzeitig geantwortet.');
  if (err instanceof Anthropic.APIConnectionError) return new AgentError('NETWORK', 'Anthropic ist nicht erreichbar (Netzwerk/Proxy prüfen).');
  if (err instanceof Anthropic.APIError) {
    const st = err.status;
    if (st === 401) return new AgentError('AUTH', 'API-Key ungültig (ANTHROPIC_API_KEY prüfen).');
    if (st === 403) return new AgentError('AUTH', 'Keine Berechtigung für Managed Agents mit diesem API-Key.');
    if (st === 404) return new AgentError('NOT_FOUND', 'Agent oder Environment nicht gefunden (ANTHROPIC_AGENT_ID / ANTHROPIC_ENVIRONMENT_ID prüfen).');
    if (st === 400) return new AgentError('BAD_REQUEST', 'Anfrage von Anthropic abgelehnt (Konfiguration prüfen).');
    if (st === 429) return new AgentError('RATE_LIMIT', 'Rate-Limit erreicht – bitte einen Moment warten und erneut versuchen.');
    if (st >= 500) return new AgentError('SERVER', 'Anthropic meldet einen Serverfehler – bitte später erneut versuchen.');
    return new AgentError('API', `Anthropic-Fehler (HTTP ${st}).`);
  }
  return new AgentError('UNKNOWN', 'Unerwarteter Fehler bei der Textgenerierung.');
}

/** Sichere Kurzbeschreibung eines Fehlers fürs Server-Log (ohne Header/Request-Details). */
export function describeForLog(err) {
  const name = err?.constructor?.name || 'Error';
  const status = err?.status ? ` status=${err.status}` : '';
  const code = err?.code ? ` code=${err.code}` : '';
  return `${name}${status}${code}`;
}

/**
 * Erstellt eine neue Session, sendet den Prompt und wertet den SSE-Stream aus,
 * bis der Agent fertig ist. Liefert die normalisierten Texte.
 */
export async function generateTexts(input, { timeoutMs = 180000 } = {}) {
  if (!agentConfigured()) {
    throw new AgentError('NOT_CONFIGURED', 'Agent nicht konfiguriert: ANTHROPIC_API_KEY, ANTHROPIC_AGENT_ID und ANTHROPIC_ENVIRONMENT_ID in .env setzen.');
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60000 });

  let session;
  let stream;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { stream?.controller?.abort(); } catch { /* ignore */ }
    if (session) {
      // Best effort: Agent anhalten, damit keine weitere Laufzeit anfällt.
      client.beta.sessions.events.send(session.id, { events: [{ type: 'user.interrupt' }] }).catch(() => {});
    }
  }, timeoutMs);

  try {
    // Pro Generierung eine neue Session – kein geteilter Zustand zwischen Artikeln.
    session = await client.beta.sessions.create({
      agent: { type: 'agent', id: process.env.ANTHROPIC_AGENT_ID },
      environment_id: process.env.ANTHROPIC_ENVIRONMENT_ID,
      title: `Shoptexte ${String(input.artikelnr || '').slice(0, 40)}`,
    });

    // Stream zuerst öffnen, dann senden – so geht kein Ereignis verloren.
    stream = await client.beta.sessions.events.stream(session.id);
    if (timedOut) throw new AgentError('TIMEOUT', 'Zeitüberschreitung: Der Agent hat nicht rechtzeitig geantwortet.');

    await client.beta.sessions.events.send(session.id, {
      events: [{ type: 'user.message', content: [{ type: 'text', text: buildPrompt(input) }] }],
    });

    const messages = [];
    let sessionError = null;
    let started = false;
    let stopReason = null;

    for await (const event of stream) {
      switch (event.type) {
        case 'user.message':
          if (event.processed_at) started = true; // erst "verarbeitet" zählt, nicht "eingereiht"
          break;
        case 'session.status_running':
          started = true;
          break;
        case 'agent.message': {
          started = true;
          const text = (event.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
          if (text.trim()) messages.push(text);
          break;
        }
        case 'session.error':
          sessionError = event;
          break;
        case 'session.status_idle':
          if (!started) break; // Idle-Status vor Verarbeitung unserer Nachricht ignorieren
          if (event.stop_reason?.type === 'requires_action') {
            throw new AgentError('REQUIRES_ACTION', 'Der Agent wartet auf eine Tool-Freigabe. Bitte die Berechtigungen des Agenten auf „always_allow" stellen oder Texte manuell eingeben.');
          }
          stopReason = event.stop_reason?.type || 'end_turn';
          break;
        case 'session.status_terminated':
          stopReason = 'terminated';
          break;
        default:
          if (typeof event.type === 'string' && event.type.startsWith('agent.')) started = true;
      }
      if (stopReason) break;
    }

    if (timedOut) throw new AgentError('TIMEOUT', 'Zeitüberschreitung: Der Agent hat nicht rechtzeitig geantwortet.');
    if (stopReason && stopReason !== 'end_turn' && messages.length === 0) {
      const detail = sessionError ? ' (Agent meldete einen Fehler)' : '';
      throw new AgentError('AGENT_STOPPED', `Der Agent hat ohne Ergebnis beendet: ${stopReason}${detail}.`);
    }
    if (!stopReason && messages.length === 0) {
      throw new AgentError('STREAM_ENDED', 'Die Verbindung zum Agenten wurde vorzeitig beendet.');
    }

    // Letzte Nachricht bevorzugen; falls dort kein JSON steht, alle Nachrichten zusammen versuchen.
    try {
      return parseAgentJson(messages[messages.length - 1]);
    } catch (e) {
      if (messages.length > 1) return parseAgentJson(messages.join('\n'));
      throw e;
    }
  } catch (err) {
    if (timedOut && !(err instanceof AgentError && err.code !== 'UNKNOWN')) {
      throw new AgentError('TIMEOUT', 'Zeitüberschreitung: Der Agent hat nicht rechtzeitig geantwortet.');
    }
    throw translateError(err);
  } finally {
    clearTimeout(timer);
  }
}

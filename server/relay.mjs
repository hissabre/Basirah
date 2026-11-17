// Relais Basirah : le navigateur/l'application parle au relais ; seul le relais détient la clé du fournisseur de reconnaissance.
//   npm i ws   puis   RELAY_SECRET=… PROVIDER=mock|deepgram [DEEPGRAM_API_KEY=…] [PORT=8787] node server/relay.mjs
// Jetons courts : node server/token.mjs  (signés HMAC-SHA256, expiration). NE PAS exposer la clé fournisseur au client.
// ÉTAT : adaptateur `mock` testé (jeu de mots scripté, PAS de la reconnaissance). Adaptateur `deepgram` NON testé (pas d'accès réseau / de clé) ;
// le format de messages utilisé suit la documentation du fournisseur telle que connue et DOIT être vérifié ; la prise en charge de l'arabe
// coranique n'est pas établie (aucune mesure).
import { WebSocketServer, WebSocket } from 'ws';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.RELAY_SECRET; if (!SECRET) { console.error('RELAY_SECRET requis'); process.exit(1); }
const PROVIDER = process.env.PROVIDER ?? 'mock', PORT = +(process.env.PORT ?? 8787);
const b64 = s => Buffer.from(s).toString('base64url');
export function mintToken(ttlSec = 3600, secret = SECRET) { const p = b64(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSec })); return p + '.' + createHmac('sha256', secret).update(p).digest('base64url'); }
export function verifyToken(t, secret = SECRET) {
  const [p, sig] = String(t).split('.'); if (!p || !sig) return false;
  const good = createHmac('sha256', secret).update(p).digest('base64url');
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now() / 1000; } catch { return false; }
}

/** Adaptateur de test : émet des mots scripté selon la quantité d'audio reçue. */
function mockAdapter(send) {
  const words = (process.env.MOCK_WORDS ?? 'بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين').split(' ');
  let bytes = 0, i = 0, line = [], segStart = 0;
  return { audio(buf) { bytes += buf.length; const t = bytes / 32000;
      while (i < words.length && i * 0.4 + 0.4 <= t) { line.push(words[i++]); const end = i * 0.4, fin = line.length >= 4 || i === words.length;
        send({ type: 'result', text: line.join(' '), isFinal: fin, start: segStart, end, confidence: null }); if (fin) { line = []; segStart = end; } } }, close() {} };
}
/** Adaptateur Deepgram (NON TESTÉ). */
function deepgramAdapter(send, language) {
  const url = `wss://api.deepgram.com/v1/listen?model=${process.env.DEEPGRAM_MODEL ?? 'nova-3'}&language=${language}&encoding=linear16&sample_rate=16000&channels=1&interim_results=true`;
  const up = new WebSocket(url, { headers: { Authorization: 'Token ' + process.env.DEEPGRAM_API_KEY } });
  const q = []; up.on('open', () => q.splice(0).forEach(b => up.send(b)));
  up.on('message', d => { try { const j = JSON.parse(d.toString()); if (j.type === 'Results') { const a = j.channel?.alternatives?.[0]; if (a) send({ type: 'result', text: a.transcript ?? '', isFinal: !!j.is_final, start: j.start ?? 0, end: (j.start ?? 0) + (j.duration ?? 0), confidence: a.confidence ?? null }); } } catch {} });
  up.on('error', e => send({ type: 'error', message: 'fournisseur : ' + e.message }));
  return { audio(b) { up.readyState === 1 ? up.send(b) : q.push(b); }, close() { try { up.close(); } catch {} } };
}

export function startRelay(port = PORT) {
  const wss = new WebSocketServer({ port, maxPayload: 1 << 20 });
  wss.on('connection', ws => {
    let ad = null; const send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
    const timer = setTimeout(() => ws.close(4001, 'auth requise'), 5000);
    ws.on('message', (d, isBin) => {
      if (!ad) { // le premier message DOIT être l'authentification
        try { const j = JSON.parse(d.toString()); if (j.type !== 'auth' || !verifyToken(j.token)) throw 0;
          clearTimeout(timer); ad = PROVIDER === 'deepgram' ? deepgramAdapter(send, j.language ?? 'ar') : mockAdapter(send); send({ type: 'ready' }); }
        catch { ws.close(4003, 'jeton invalide'); } return; }
      if (isBin) ad.audio(d);
    });
    ws.on('close', () => { clearTimeout(timer); ad?.close(); });
  });
  return wss;
}
if (import.meta.url === `file://${process.argv[1]}`) { startRelay(); console.log(`relais ${PROVIDER} sur :${PORT}`); }

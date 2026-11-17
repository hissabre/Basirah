import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { PhonemeDB, standInLexicon } from '../src/quran/phoneme-db.ts';
import { Session } from '../src/session/session.ts';
import { OnlineEngine, type StreamingProvider, type ProviderMessage, type CloseInfo } from '../src/engine/online.ts';
import { WebSocketProvider } from '../src/engine/ws-provider.ts';
import { ReplayEngine } from '../src/engine/replay.ts';
import { TranslationPipeline, UnavailableTranslator, type Translator } from '../src/translation/pipeline.ts';
import type { RecognitionResult, RecognizerState } from '../src/types.ts';
import { rng, corrupt } from './sim.ts';

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
const q = new QuranDB(JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
const ph = new PhonemeDB(standInLexicon(q));
const chunk = (s: number) => new Float32Array(Math.round(16000 * s));

// ── Moteur en ligne : faux fournisseur contrôlable ───────────────────────────────────────────────
class FakeProv implements StreamingProvider {
  static all: FakeProv[] = []; static failOpen = 0;
  id = 'fake'; sent: Int16Array[] = []; mcb: (m: ProviderMessage) => void = () => {}; ccb: (i: CloseInfo) => void = () => {}; closed = false;
  constructor() { FakeProv.all.push(this); }
  async open() { if (FakeProv.failOpen > 0) { FakeProv.failOpen--; throw new Error('réseau coupé'); } }
  send(p: Int16Array) { this.sent.push(p); } close() { this.closed = true; }
  onMessage(cb: (m: ProviderMessage) => void) { this.mcb = cb; } onClose(cb: (i: CloseInfo) => void) { this.ccb = cb; }
}
console.log('\n[OnlineEngine — flux, coupure, reprise, abandon]');
{
  FakeProv.all = []; FakeProv.failOpen = 0;
  const st: string[] = [], res: RecognitionResult[] = [];
  const e = new OnlineEngine(() => new FakeProv(), { sleep: async () => {}, maxRetries: 3 });
  e.on('state', (s, w) => st.push(s + ':' + w)); e.on('result', r => res.push(r));
  await e.load();
  for (let i = 0; i < 10; i++) e.pushAudio(chunk(0.1), i * 0.1); // 1 s
  const p1 = FakeProv.all[0];
  t('audio envoyé en continu à la connexion', p1.sent.length === 10 && p1.sent.every(x => x.length === 1600));
  p1.mcb({ text: 'بسم الله', isFinal: true, start: 0, end: 0.6, confidence: 0.9 });
  p1.mcb({ text: 'الرحمن', isFinal: false, start: 0.6, end: 1.0, confidence: null });
  t('résultats : provisoire + final, confiance transmise ou null', res.length === 2 && res[0].isFinal && res[0].confidence === 0.9 && res[1].confidence === null);
  // coupure réseau : l'audio non confirmé (après 0,6 s) est renvoyé, les temps sont recalés
  p1.ccb({ clean: false, code: 1006, reason: '' });
  await e.flush(); await new Promise(r => setTimeout(r, 5));
  const p2 = FakeProv.all[1];
  t('reconnexion automatique, une seule nouvelle connexion', FakeProv.all.length === 2 && e.reconnects === 1, st.slice(-3).join(' | '));
  t('seul l\'audio NON confirmé est renvoyé (pas de ré-envoi complet)', p2.sent.length > 0 && p2.sent.length <= 5, `${p2.sent.length} blocs sur 10`);
  p2.mcb({ text: 'الرحمن الرحيم', isFinal: true, start: 0.0, end: 0.5, confidence: null });
  const last = res[res.length - 1];
  t('horloge audio de session conservée après reconnexion (début ≈ 0,6 s)', Math.abs(last.audioStart - 0.6) < 0.11, last.audioStart.toFixed(2));
  p1.mcb({ text: 'fantôme', isFinal: true, start: 0, end: 1, confidence: null });
  t('message d\'une ancienne connexion ignoré', !res.some(r => r.text === 'fantôme'));
  // échec définitif
  FakeProv.failOpen = 99; p2.ccb({ clean: false, code: 1006, reason: 'x' }); await new Promise(r => setTimeout(r, 20));
  t('après 3 échecs : état error, pas de boucle infinie', st.some(s => s.startsWith('error:service injoignable')) && FakeProv.failOpen === 99 - 3, st.at(-1));
  FakeProv.failOpen = 0; await e.resume(); await new Promise(r => setTimeout(r, 5));
  t('reprise manuelle possible', st.at(-1)!.startsWith('listening'), st.at(-1));
  await e.dispose();
}
console.log('\n[WebSocketProvider + relais réel (adaptateur de TEST, pas de reconnaissance)]');
{
  process.env.RELAY_SECRET = 'secret-de-test'; process.env.PROVIDER = 'mock';
  const { startRelay, mintToken } = await import('../server/relay.mjs');
  const port = 18787, wss = startRelay(port); await new Promise(r => setTimeout(r, 100));
  const res: RecognitionResult[] = [], st: string[] = [];
  const e = new OnlineEngine(() => new WebSocketProvider(`ws://127.0.0.1:${port}`, async () => mintToken(60)), { sleep: async () => {}, maxRetries: 2, id: 'relay-test' });
  e.on('result', r => res.push(r)); e.on('state', (s, w) => st.push(s + ':' + w));
  await e.load(); for (let i = 0; i < 40; i++) e.pushAudio(chunk(0.1), i * 0.1);
  await new Promise(r => setTimeout(r, 300));
  t('connexion authentifiée et résultats reçus du relais', res.length >= 4 && res.some(r => r.isFinal), `${res.length} résultats`);
  const bad = new OnlineEngine(() => new WebSocketProvider(`ws://127.0.0.1:${port}`, async () => 'jeton.invalide'), { sleep: async () => {}, maxRetries: 1 }); const bst: string[] = []; bad.on('state', (s, w) => bst.push(s));
  await bad.load(); await new Promise(r => setTimeout(r, 200));
  t('jeton invalide REFUSÉ par le relais', !bst.includes('listening') && bst.includes('error'), bst.join(','));
  const before = st.length; for (const c of wss.clients) c.terminate(); await new Promise(r => setTimeout(r, 400));
  t('coupure côté serveur → reconnexion automatique au relais', e.reconnects >= 1 && st.slice(before).some(s => s.startsWith('listening')), st.slice(before).map(s => s.split(':')[0]).join(','));
  await e.dispose(); await bad.dispose(); wss.close();
}

// ── Session : 4 modes, changement de moteur, Hifz ────────────────────────────────────────────────
const words = (s: number, a: number, a2: number) => { const o: { t: string; idx: number }[] = []; for (let k = q.indexOf(s, a); k <= q.indexOf(s, a2) + q.verseOf(q.indexOf(s, a2)).words.length - 1 - q.words[q.indexOf(s, a2)].j; k++) o.push({ t: q.words[k].t, idx: k }); return o; };
function scriptFor(ws: string[], t0 = 0, step = 0.4, per = 3) { const sc: any[] = []; let clock = t0; for (let i = 0; i < ws.length; i += per) { clock += step * Math.min(per, ws.length - i); sc.push({ at: clock, result: { text: ws.slice(0, 0).concat(ws.slice(i, i + per)).join(' '), unit: 'text', language: 'ar', audioStart: clock - step * per, audioEnd: clock, isFinal: true, confidence: null } }); } return { sc, end: clock }; }
async function drive(engine: ReplayEngine, from: number, to: number) { for (let c = from; c < to; c += 0.1) engine.pushAudio(chunk(0.1), c); }

console.log('\n[Session — Prière, Lecture, changement de moteur]');
{
  const r = rng(3), ws = words(67, 1, 5).flatMap(w => corrupt(w.t, r, 0.08));
  const { sc, end } = scriptFor(ws); const eng = new ReplayEngine(sc, 'rejeu-texte');
  const s = new Session({ quran: q, phoneme: ph }); s.setMode('prayer'); s.attachEngine(eng, 'text'); await eng.load();
  await drive(eng, 0, end + 0.5);
  const v = s.view();
  t('Prière : position suivie (67:5)', !!v.position && v.position.surah === 67 && v.position.ayah >= 4, v.position ? `${v.position.surah}:${v.position.ayah}` : '-');
  // bascule vers un moteur PHONÉMIQUE (ex. hors ligne) : la position n'est pas perdue
  const before = s.view().position!;
  const pw = ph.words.slice(ph.unitIndexOf(67, 5), ph.unitIndexOf(67, 8)).map(u => u.t);
  const psc: any[] = []; let c = end + 1; for (let i = 0; i < pw.length; i += 6) { c += 0.35; psc.push({ at: c, result: { text: '', tokens: pw.slice(i, i + 6), unit: 'phoneme', language: 'ar', audioStart: c - 0.35, audioEnd: c, isFinal: true, confidence: null } }); }
  const eng2 = new ReplayEngine(psc, 'rejeu-phonèmes'); s.attachEngine(eng2, 'phoneme'); await eng2.load();
  await drive(eng2, end + 1, c + 0.5);
  const a = s.view().position!;
  t('Changement texte → phonèmes sans perdre la position', a.surah === 67 && a.ayah >= before.ayah && a.ayah <= 8, `${before.surah}:${before.ayah} → ${a.surah}:${a.ayah}`);
  t('le changement est journalisé', s.log.some(l => l.msg.includes('changement de moteur')));
  s.setMode('reading'); t('Lecture : navigation manuelle', s.goto(2, 255) && s.view().position!.ayah === 255 && s.view().position!.surah === 2);
  t('navigation vers un verset inexistant refusée', !s.goto(2, 999));
  t('lexique phonémique cohérent avec le texte', s.compat!.mismatchedVerses === 0, JSON.stringify(s.compat));
}
console.log('\n[Session — Hifz : mots omis, répétition, blocage, continuation]');
{
  // récitation de Mulk 67:2 SANS erreur de reconnaissance, avec 2 mots réellement omis
  const w = words(67, 1, 2), omitted = new Set([w.length - 6, w.length - 3]);
  const ws = w.filter((_, i) => !omitted.has(i)).map(x => x.t);
  const { sc, end } = scriptFor(ws); const eng = new ReplayEngine(sc);
  const s = new Session({ quran: q }); s.setMode('hifz'); s.attachEngine(eng, 'text'); await eng.load(); await drive(eng, 0, end + 0.5);
  const sum = s.view().hifz!, missedIdx = [...s.hifz.status].filter(([, v]) => v === 'missed').map(([k]) => k);
  t('2 mots réellement omis → détectés comme « manqués »', sum.missed === 2, JSON.stringify(sum));
  t('les mots manqués sont les bons', missedIdx.length === 2 && missedIdx.every(k => omitted.has(w.findIndex(x => x.idx === k))));
  t('versets terminés comptés', s.hifz.verses.length >= 1);
  // blocage + indice : récitation interrompue au milieu d'un verset
  const w2 = words(67, 3, 3), half = w2.slice(0, 5).map(x => x.t); const { sc: sc2, end: end2 } = scriptFor(half);
  const eng3 = new ReplayEngine(sc2), s3 = new Session({ quran: q }); s3.setMode('hifz'); s3.goto(67, 3); s3.attachEngine(eng3, 'text'); await eng3.load(); await drive(eng3, 0, end2 + 0.5);
  s3.tick(end2 + 3); const early = s3.view().stuck; s3.tick(end2 + 10);
  t('pas de blocage signalé avant 6 s', early === null);
  t('blocage détecté après 6 s sans progrès, avec la suite correcte', !!s3.view().stuck && s3.view().stuck!.hint.length === 3, JSON.stringify(s3.view().stuck));
  const p = s3.view().position!;
  t('indice à la demande = suite du verset (texte original)', s.hint(2).every(x => q.verseOf(p.index).words.includes(x)));
}
{
  // FAUSSES ALARMES : récitation correcte, bruit de reconnaissance seul (aucun mot omis)
  let flagged = 0, total = 0;
  for (const noise of [0.1, 0.25]) { let f = 0, n = 0;
    for (let seed = 1; seed <= 15; seed++) { const r = rng(seed * 31), w = words(36, 1, 12).flatMap(x => corrupt(x.t, r, noise));
      const { sc, end } = scriptFor(w); const eng = new ReplayEngine(sc); const s = new Session({ quran: q }); s.setMode('hifz'); s.attachEngine(eng, 'text'); await eng.load(); await drive(eng, 0, end + 0.5);
      for (const v of s.hifz.status.values()) { n++; if (v === 'missed' || v === 'wrong') f++; } }
    console.log(`    bruit de reconnaissance simulé ${noise * 100} % (récitation CORRECTE) : ${(100 * f / n).toFixed(1)} % des mots faussement signalés manqués/remplacés`); flagged += f; total += n; }
  t('mesure des fausses alarmes disponible (à afficher comme « peut-être »)', total > 0);
}
console.log('\n[Traduction — pipeline général]');
{
  const ok: Translator = { id: 'fake-mt', kind: 'online', targets: () => ['fr', 'en'], available: async () => ({ ok: true }), translate: async (x, f, to) => `[${to}] ${x}` };
  const p = new TranslationPipeline(ok, { sourceLang: 'ar', targetLang: 'fr' });
  const mk = (text: string, fin: boolean): RecognitionResult => ({ text, unit: 'text', language: 'ar', audioStart: 0, audioEnd: 1, receivedAt: 0, isFinal: fin, confidence: null, engine: 'online', engineId: 'x' });
  p.push(mk('مرحبا', false)); p.push(mk('مرحبا بكم', false));
  t('un provisoire remplace la ligne en cours (une seule ligne)', p.subtitles.length === 1 && p.subtitles[0].source === 'مرحبا بكم' && p.subtitles[0].status === 'partial');
  p.push(mk('مرحبا بكم جميعا', true)); await p.idle();
  t('définitif → traduit, ligne suivante indépendante', p.subtitles[0].status === 'translated' && p.subtitles[0].target === '[fr] مرحبا بكم جميعا');
  p.push(mk('الحمد لله', true)); await p.idle(); t('deuxième phrase = deuxième sous-titre', p.subtitles.length === 2);
  p.setTranslator(new UnavailableTranslator('offline', 'offline-mt', 'aucun modèle de traduction hors ligne installé')); p.push(mk('سلام', true)); await p.idle();
  t('traducteur indisponible : erreur explicite, jamais de fausse traduction', p.subtitles.at(-1)!.status === 'error' && p.subtitles.at(-1)!.error!.includes('aucun modèle') && p.subtitles.at(-1)!.target === null);
  const s = new Session({ quran: q, translation: p }); s.setMode('translation'); const n = p.subtitles.length;
  s.onResult(mk('نص عام ليس من القرآن', true)); await p.idle();
  t('mode Traduction : texte non coranique accepté (aucun filtre Coran)', p.subtitles.length === n + 1 && s.view().position === null);
}
console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);

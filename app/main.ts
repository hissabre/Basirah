import { QuranDB, type RawQuran } from '../src/quran/db.ts';
import { Session, type Mode, type SessionView } from '../src/session/session.ts';
import { AudioCapture } from '../src/audio/capture.ts';
import { OnlineEngine } from '../src/engine/online.ts';
import { WebSocketProvider } from '../src/engine/ws-provider.ts';
import { WebSpeechEngine, speechSupported } from '../src/engine/webspeech.ts';
import { TajweedFormerEngine } from '../src/engine/tajweedformer.ts';
import { WhisperEngine, spawnWhisperWorker } from '../src/engine/whisper.ts';
import { WHISPER_WORKER_SRC } from '../src/engine/whisper-worker-src.ts';
import { skeleton } from '../src/quran/normalize.ts';
import { TranslationPipeline, UnavailableTranslator } from '../src/translation/pipeline.ts';
import type { RecognitionEngine } from '../src/types.ts';
import { runBench, benchReport } from '../src/app/bench.ts';

declare const QURAN: RawQuran;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new QuranDB(QURAN);
const tr = new TranslationPipeline(new UnavailableTranslator('offline', 'aucun', 'Aucun traducteur n\'est branché : la traduction reste indisponible (rien n\'est inventé).'), { sourceLang: 'ar', targetLang: 'fr' });
const session = new Session({ quran: q, translation: tr });
const cap = new AudioCapture({ onChunk: (p, t) => engine?.pushAudio(p, t), onStatus: (s, w) => diagLog(`micro : ${s} — ${w}`) });
let engine: RecognitionEngine | null = null, running = false, engineKind = 'offline-zipformer', lastText = '', finals: string[] = [];
const tl: string[] = []; let tStart = performance.now(); let lastKey = '', lastLive = '';
const tlog = (m: string) => { tl.push(((performance.now() - tStart) / 1000).toFixed(1).padStart(6) + ' s  ' + m); if (tl.length > 400) tl.shift(); };
const dl: string[] = []; const diagLog = (m: string) => { dl.push(new Date().toLocaleTimeString() + ' ' + m); if (dl.length > 300) dl.shift(); };
const err = (m: string | null) => { const e = $('err'); e.hidden = !m; e.textContent = m ?? ''; if (m) diagLog('ERREUR : ' + m); };

// ── Moteurs ───────────────────────────────────────────────────────────────────
const speechOk = speechSupported();
const adv = new URLSearchParams(location.search).has('avance'); // ?avance=1 : moteurs en attente de configuration (clé, modèle)
$<HTMLSelectElement>('engine').innerHTML =
  `<option value="offline-whisper">Hors ligne — Whisper dans le navigateur (modèle téléchargé une fois ; retard de quelques secondes)</option>
   <option value="online-test"${speechOk ? '' : ' disabled'}>En ligne — TEST navigateur (Chrome/Edge, Google)${speechOk ? '' : ' — non supporté ici'}</option>` +
  (adv ? `<option value="offline-zipformer">[avancé] Hors ligne — Zipformer Quran-Lab (modèle non installé)</option>
   <option value="online-relay">[avancé] En ligne — relais Basirah (clé fournisseur requise)</option>
   <option value="quranlab-sdk">[avancé] TajweedFormer V4 (SDK Quran-Lab, clé requise, NON TESTÉ)</option>` : '');
$<HTMLSelectElement>('engine').value = 'offline-whisper';
engineKind = $<HTMLSelectElement>('engine').value;
const refreshEngineHelp = () => {
  engineKind = $<HTMLSelectElement>('engine').value;
  $('relayBox').hidden = engineKind !== 'online-relay'; $('sdkBox').hidden = engineKind !== 'quranlab-sdk';
  $('engineHelp').textContent = ({
    'offline-zipformer': 'Le moteur hors ligne attend le modèle Quran-Lab (non présent). Démarrer affichera l\'erreur exacte.',
    'online-relay': 'Renseignez l\'adresse du relais et celle du jeton (serveur Basirah). Sans eux, Démarrer refuse.',
    'offline-whisper': 'Whisper (transformers.js, modèle whisper-base) : tourne dans votre navigateur ; le modèle se télécharge à la première utilisation, puis fonctionne sans réseau. Whisper n\'est pas un modèle en flux : attendez quelques secondes de retard. Même moteur que l\'ancienne version.',
    'quranlab-sdk': 'SDK Quran-Lab : créez une clé web sur sdk.quranlab.ai (connexion Hugging Face) pour l\'adresse https de cette page, collez-la ci-dessous. Le SDK ouvre lui-même le micro. La sortie brute s\'affiche dans Diagnostic.',
    'online-test': 'Moteur de TEST du navigateur : l\'audio part chez Google ; précision sur le Coran inconnue ; il s\'arrête de lui-même (relancer à la main). Ce n\'est pas le moteur Basirah.' } as Record<string, string>)[engineKind];
};
$('engine').onchange = refreshEngineHelp; refreshEngineHelp();


// Modèle Whisper embarqué ? (dossier models/Xenova/whisper-base/ publié avec l'application). Sinon : téléchargement externe à la 1re utilisation.
let whisperLocal = false;
(async () => { try { const r = await fetch('models/Xenova/whisper-base/config.json', { cache: 'no-store' }); if (r.ok) { await r.json(); whisperLocal = true; } } catch {} })();

async function makeEngine(engineKind_: string = engineKind): Promise<RecognitionEngine> {
  const engineKind = engineKind_;
  if (engineKind === 'offline-zipformer') throw new Error('Moteur hors ligne Zipformer : le modèle Quran-Lab (.onnx, tokens, lexique) et le runtime sherpa-onnx WebAssembly ne sont pas installés dans cette page. Rien n\'a été simulé.');
  if (engineKind === 'online-relay') {
    const url = $<HTMLInputElement>('relayUrl').value.trim(), tok = $<HTMLInputElement>('tokenUrl').value.trim();
    if (!url || !tok) throw new Error('Mode en ligne (relais) : adresse du relais et adresse du jeton non renseignées. Aucun moteur en ligne n\'est configuré.');
    return new OnlineEngine(() => new WebSocketProvider(url, async () => (await (await fetch(tok)).json()).token, { language: 'ar' }), { maxRetries: 3 });
  }
  if (engineKind === 'offline-whisper') {
    const known = new Set(q.words.map(w => w.sk));
    return new WhisperEngine({ spawn: () => spawnWhisperWorker(WHISPER_WORKER_SRC), localBase: whisperLocal ? new URL('models/', location.href).href : undefined, knownSkeletons: known, holdback: $<HTMLSelectElement>('react').value === 'fast' ? 2 : undefined });
  }
  if (engineKind === 'quranlab-sdk') {
    const key = $<HTMLInputElement>('sdkKey').value.trim(); try { localStorage.setItem('qlkey', key); } catch {}
    return new TajweedFormerEngine({ key, sdkUrl: $<HTMLInputElement>('sdkUrl').value.trim(), onRaw: c => { $('raw').textContent = JSON.stringify(c, null, 1).slice(0, 3000); } });
  }
  return new WebSpeechEngine();
}
async function start() {
  err(null); if (running) return;
  try {
    const e = await makeEngine(); finals = []; lastText = ''; if (mode !== 'reading') session.reset();
    session.attachEngine(e, 'text'); e.on('state', (s, w) => { if (s === 'loading-model') $('engineHelp').textContent = w; diagLog(`moteur ${e.id} : ${s} — ${w}`); if (s === 'error' || s === 'network-disconnected') err(`Moteur ${e.id} : ${w}`); if ((e instanceof WebSpeechEngine || e instanceof TajweedFormerEngine) && (s === 'idle' || s === 'error') && running) { running = false; if (s === 'idle' && /JAMAIS|aucun son/.test(w)) err(w); } setBtn(); });
    e.on('result', r => { lastText = r.text; tlog(`résultat ${r.isFinal ? 'FINAL' : 'provisoire'} · ${r.text.trim().split(/\s+/).filter(Boolean).length} mots`); if (r.isFinal) { finals.push(r.text); if (finals.length > 6) finals.shift(); } });
    engine = e; tStart = performance.now(); lastKey = ''; tl.length = 0; await e.load(); running = true; setBtn();
    if (e instanceof WebSpeechEngine) e.begin(); else if (e instanceof TajweedFormerEngine) { void e.begin(); } else await cap.start();
  } catch (x) { running = false; engine = null; err((x as Error).message); setBtn(); }
}
async function stop() { running = false; try { await engine?.flush(); await engine?.dispose(); } catch {} if (!(engine instanceof WebSpeechEngine) && !(engine instanceof TajweedFormerEngine)) await cap.stop().catch(() => {}); engine = null; setBtn(); }
const setBtn = () => { $('go').textContent = running ? 'Arrêter' : 'Démarrer'; $('go').classList.toggle('on', running); };
$('go').onclick = () => running ? stop() : start();

// ── Modes ─────────────────────────────────────────────────────────────────────
let mode: Mode = 'prayer';
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => {
  mode = b.dataset.mode as Mode; session.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('sel', x === b));
  $('hifzBox').hidden = mode !== 'hifz'; $('gotoBox').hidden = mode !== 'reading'; $('trBox').hidden = mode !== 'translation';
  render(session.view());
});
$('gotoBtn').onclick = () => { const s = +$<HTMLInputElement>('gs').value, a = +$<HTMLInputElement>('ga').value; if (!session.goto(s, a)) err(`${s}:${a} n'existe pas`); else err(null); };
$<HTMLSelectElement>('react').onchange = () => { const f = $<HTMLSelectElement>('react').value === 'fast'; session.setReactivity(f); if (engine instanceof WhisperEngine) engine.setHoldback(f ? 2 : undefined); };
$('hintBtn').onclick = () => { $('hint').textContent = session.hint(3).join(' ') || '—'; };

// ── Rendu ─────────────────────────────────────────────────────────────────────
const STATUS: Record<string, string> = { idle: 'En attente', searching: 'Recherche…', tracking: 'Suivi', lost: 'Position perdue', ambiguous: 'Ambigu' };
function render(v: SessionView) {
  $('state').textContent = (v.engine ? `${v.engine.state}` : 'aucun moteur') + ' · ' + (STATUS[v.status] ?? v.status);
  const p = v.position, box = $('verse');
  if (mode === 'translation') { box.innerHTML = ''; }
  else if (!p) box.innerHTML = '<span class="mut">Position non confirmée — récitez pour commencer.</span>';
  else {
    const verse = q.verses.find(x => x.s === p.surah && x.a === p.ayah)!;
    const hs = mode === 'hifz' ? v.hifz : null;
    box.innerHTML = `<div class="ref">${p.surah}:${p.ayah}</div><div class="ar">` + verse.words.map((w, i) => `<span class="${i < p.word ? 'done' : i === p.word ? 'cur' : (v.live && v.live.surah === p.surah && v.live.ayah === p.ayah && i === v.live.word ? 'lv' : '')}">${w}</span>`).join(' ') + '</div>' + (hs ? '' : '');
  }
  $('heard').textContent = lastText ? (lastText.length > 160 ? '… ' + lastText.slice(-160) : lastText) : '—';
  $('conf').textContent = `confiance ${v.confidence.toFixed(2)} · marge ${v.margin.toFixed(2)}`;
  const h = v.hifz; if (h) $('hifz').textContent = `ok ${h.ok} · incertain ${h.uncertain} · peut-être omis ${h.missed} · à vérifier ${h.wrong} · répétitions ${h.repeats}` + (v.stuck ? ` — Bloqué ? Indice : ${v.stuck.hint.join(' ')}` : '');
  $('events').textContent = v.recentEvents.map(e => `${e.at.toFixed(1)}s ${e.kind}`).join(' · ') || '—';
  if (mode === 'translation') { const s = tr.subtitles.slice(-6); $('sub').innerHTML = (tr.info().kind, '<div class="mut">' + (s.length ? '' : 'En attente de parole…') + '</div>') + s.map(x => `<div>${x.source}<br><span class="mut">${x.target ?? (x.error ?? 'traduction indisponible')}</span></div>`).join(''); }
}
session.onUpdate(v => { const lk = v.live ? `${v.live.surah}:${v.live.ayah}/${v.live.word}` : '-'; if (lk !== lastLive) { lastLive = lk; tlog(`live → ${lk}`); } const k = v.position ? `${v.position.surah}:${v.position.ayah}/${v.position.word}` : '-'; if (k !== lastKey) { lastKey = k; tlog(`POSITION → ${k} (${v.status})`); } render(v); }); tr.onUpdate(() => render(session.view()));
setInterval(() => { if (running) session.tick((performance.now()) / 1000 - t0); }, 1000); const t0 = performance.now() / 1000;

// ── Diagnostic ────────────────────────────────────────────────────────────────
$('tabDiag').onclick = () => { $('diag').hidden = !$('diag').hidden; };
$('micTest').onclick = async () => { try { err(null); await cap.start(); diagLog('test micro seul démarré'); } catch (x) { err('Micro : ' + (x as Error).message); } };
$('micStop').onclick = () => cap.stop();
setInterval(() => {
  cap.pull(16000 * 5);
  const s = cap.stats(); $('lvl').style.width = Math.min(100, s.rms * 600) + '%';
  const zero = s.status === 'running' && s.maxPeak === 0 && s.silentMs > 4000;
  $('stats').textContent = (zero ? '⚠ SILENCE NUMÉRIQUE EXACT depuis ' + (s.silentMs / 1000).toFixed(0) + ' s : le micro choisi n\'envoie aucun signal (muet, mauvais périphérique, ou bloqué par Windows/Chrome). Choisissez un autre micro ci-dessus.\n' : '') + `piste : ${s.track ? `${s.track.label} · muet=${s.track.muted} · actif=${s.track.enabled} · ${s.track.readyState} · ${s.track.settings}` : '—'}\ncrête maximale depuis le début : ${s.maxPeak.toFixed(4)}\nmicro ${s.status} · niveau ${s.rms.toFixed(4)} · crête ${s.peak.toFixed(3)} · silence ${(s.silentMs / 1000).toFixed(1)} s · fréquence ${s.sampleRate ?? '—'} Hz · autorisations ${s.permissionRequests} · flux ${s.streams} · abandonné ${s.dropped}`;
  const v = session.view(); const es = (() => { try { return JSON.stringify(engine?.stats?.()); } catch { return ''; } })(); $('dlog').textContent = ['Moteur : ' + (v.engine ? `${v.engine.id} (${v.engine.state})` : 'aucun'), 'Navigateur : ' + navigator.userAgent, 'Statistiques du moteur : ' + es, 'Reconnaissance vocale navigateur : ' + (speechOk ? 'oui' : 'non'), '', ...dl.slice(-40), '', 'CHRONOLOGIE (temps depuis le démarrage)', ...tl.slice(-80), '', ...session.log.slice(-15).map(l => l.msg)].join('\n');
}, 500);
$('copy').onclick = () => navigator.clipboard.writeText($('benchOut').textContent + '\n\n' + $('stats').textContent + '\n' + $('dlog').textContent).then(() => diagLog('rapport copié'));


// ── Banc d'essai : vrais fichiers audio → Whisper → même session que le micro ──────────────────────────────────
const decodeTo16k = async (f: File): Promise<Float32Array> => {
  const ac = new AudioContext(); let buf: AudioBuffer;
  try { buf = await ac.decodeAudioData(await f.arrayBuffer()); } finally { void ac.close(); }
  const oc = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000), src = oc.createBufferSource();
  src.buffer = buf; src.connect(oc.destination); src.start(); return (await oc.startRendering()).getChannelData(0).slice();
};
let benching = false;
$('benchGo').onclick = async () => {
  if (benching || running) { err(running ? 'Arrêtez d\'abord l\'écoute avant le banc d\'essai.' : null); return; }
  const files = Array.from($<HTMLInputElement>('benchFiles').files ?? []); const out = $('benchOut'); err(null);
  if (!files.length) { out.textContent = 'Choisissez des fichiers audio (mp3/wav…). Nom attendu : 067001.mp3 = sourate 67, verset 1.'; return; }
  benching = true; $('benchGo').setAttribute('disabled', ''); let e: RecognitionEngine | null = null;
  try {
    const pace = +$<HTMLSelectElement>('benchPace').value;
    const pcms: { name: string; pcm: Float32Array }[] = [];
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) { out.textContent = 'Lecture de ' + f.name + '…'; pcms.push({ name: f.name, pcm: await decodeTo16k(f) }); }
    diagLog(`banc : ${pcms.length} fichier(s) décodé(s), ${(pcms.reduce((x, p) => x + p.pcm.length, 0) / 16000).toFixed(1)} s d'audio à 16 kHz`);
    out.textContent = 'Chargement du moteur Whisper…';
    e = await makeEngine('offline-whisper'); session.attachEngine(e, 'text'); e.on('state', (st, w) => { if (st === 'loading-model') out.textContent = w; diagLog(`banc : ${st} — ${w}`); if (st === 'error') err('Moteur : ' + w); }); await e.load();
    const rows = await runBench(pcms, { engine: e, session, quran: q, pace, now: () => performance.now(), sleep: ms => new Promise(r => setTimeout(r, ms)), onProgress: m => { out.textContent = 'En cours : ' + m; } });
    out.textContent = benchReport(rows, { engine: e.id + (e instanceof WhisperEngine ? ` (${e.dev === 'webgpu' ? 'GPU' : 'processeur'})` : ''), pace }) + '\nStatistiques du moteur : ' + JSON.stringify(e.stats());
  } catch (x) { out.textContent = 'Échec du banc d\'essai : ' + (x as Error).message; err((x as Error).message); }
  finally { try { await e?.dispose(); } catch {} benching = false; $('benchGo').removeAttribute('disabled'); }
};

const FEATS: [boolean, string, string][] = [
  [true, 'Texte du Coran, 6236 versets (Tanzil, licence à vérifier)', 'chargé dans la page'],
  [true, 'Suivi de position (alignement mots) et modes Prière / Hifz / Lecture', 'code testé en simulation ; pas encore sur voix réelle'],
  [true, 'Capture micro (une autorisation, un flux)', 'testé avec un micro factice ; à valider avec votre micro'],
  [speechOk, 'Moteur TEST du navigateur (Google)', speechOk ? 'disponible — ce n\'est pas le moteur Basirah ; précision Coran inconnue' : 'non supporté par ce navigateur'],
  [true, 'Banc d\'essai : fichiers audio réels → Whisper → suivi (dans Diagnostic)', 'logique testée avec un moteur FACTICE ; premier vrai passage = chez vous'],
  [false, 'Décodeur contraint par le texte (millisecondes)', 'écrit et testé en SIMULATION seulement ; pas branché : il attend un modèle en flux (TajweedFormer/le nôtre)'],
  [false, 'TajweedFormer V4 (SDK Quran-Lab)', 'IMPLÉMENTÉ MAIS NON TESTÉ : clé web + premier essai requis ; alignement sur ses sons à écrire après avoir vu la sortie brute'],
  [false, 'Hors ligne : Whisper dans le navigateur', 'IMPLÉMENTÉ, NON EXÉCUTÉ ICI : reprend le moteur de l\'ancienne version (qui fonctionnait chez vous) ; retard de quelques secondes ; modèle téléchargé par votre navigateur à la première utilisation'],
  [false, 'Hors ligne : Zipformer Quran-Lab', 'EN ATTENTE : modèle + runtime sherpa-onnx WebAssembly (voir MODEL-SETUP-QURANLAB.md)'],
  [false, 'En ligne : relais Basirah', 'EN ATTENTE : serveur relais + clé fournisseur (voir ONLINE-PROVIDERS.md)'],
  [false, 'Traduction arabe → français', 'EN ATTENTE : aucun traducteur branché ; rien n\'est inventé'],
  [false, 'Reconnaissance par phonèmes', 'EN ATTENTE : lexique phonémique Quran-Lab']];
$('feat').innerHTML = FEATS.map(([ok, n, d]) => `<div><span class="${ok ? 'ok' : 'wait'}">${ok ? '● opérationnel' : '○ en attente'}</span> — ${n}<br><small class="mut">${d}</small></div>`).join('');

async function listMics() {
  const sel = $<HTMLSelectElement>('micSel');
  try { const d = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'audioinput'); sel.innerHTML = d.map(x => `<option value="${x.deviceId}">${x.label || '(autoriser le micro pour voir les noms)'}</option>`).join(''); diagLog(`${d.length} micro(s) détecté(s)`); }
  catch (x) { err('Liste des micros : ' + (x as Error).message); }
}
$('micList').onclick = listMics;
$<HTMLSelectElement>('micSel').onchange = async () => { cap.deviceId = $<HTMLSelectElement>('micSel').value || null; if (cap.stats().status === 'running') { await cap.stop(); await cap.start().catch(x => err('Micro : ' + (x as Error).message)); } };
$('micTest').addEventListener('click', () => setTimeout(listMics, 800));

try { const k = localStorage.getItem('qlkey'); if (k) $<HTMLInputElement>('sdkKey').value = k; } catch {}

try { if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').then(() => diagLog('hors ligne : page mise en cache (service worker actif)')).catch(e => diagLog('service worker impossible : ' + e.message)); } catch {}

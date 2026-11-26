/**
 * BASIRAH — application pour lunettes (INMO Air 2, 640×400 par œil, anneau + pavé tactile).
 * Fond noir = transparent dans les lunettes. Tout se pilote avec 5 gestes : haut, bas, gauche, droite, valider (+ retour).
 * Moteur : quran-asr-tiny + localisation par lettres (hors ligne, fichiers fournis avec l'application).
 */
import { QuranDB, type RawQuran } from '../../src/quran/db.ts';
import { Session, type Mode, type SessionView } from '../../src/session/session.ts';
import { AudioCapture } from '../../src/audio/capture.ts';
import { QuranCtcEngine, spawnClassicWorker } from '../../src/engine/quran-ctc.ts';
import { QURAN_CTC_WORKER_SRC } from '../../src/engine/quran-ctc-worker-src.ts';

declare const QURAN: RawQuran; declare const SURAHS: [string, string][]; declare const TR: Record<string, string[]>;
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const q = new QuranDB(QURAN);
const session = new Session({ quran: q });

// ── Réglages (gardés sur l'appareil) ─────────────────────────────────────────
interface Settings { lang: 'fr' | 'en'; mode: Mode; tr: 'en' | 'fr'; size: number; color: string; dim: number; start: 'auto' | 'pick'; showHeard: boolean }
const DEF: Settings = { lang: 'fr', mode: 'prayer', tr: 'en', size: 1, color: '#ffffff', dim: 1, start: 'auto', showHeard: false };
let S: Settings = { ...DEF };
try { S = { ...DEF, ...JSON.parse(localStorage.getItem('basirah-glasses') || '{}') }; } catch { /* */ }
const save = () => { try { localStorage.setItem('basirah-glasses', JSON.stringify(S)); } catch { /* */ } apply(); };
const COLORS = [['#ffffff', 'Blanc', 'White'], ['#7dffa8', 'Vert', 'Green'], ['#ffd36b', 'Ambre', 'Amber'], ['#7fe3ff', 'Cyan', 'Cyan']];
const SIZES = [0.85, 1, 1.2, 1.45];
function apply() {
  const r = document.documentElement.style; r.setProperty('--fg', S.color); r.setProperty('--k', String(SIZES[S.size])); r.setProperty('--dim', String(S.dim));
  document.documentElement.lang = S.lang;
}

// ── Textes ───────────────────────────────────────────────────────────────────
const T = {
  fr: { recite: 'Réciter', mode: 'Mode', start: 'Départ', settings: 'Réglages', help: 'Aide', auto: 'Détection auto', pick: 'Choisir la sourate',
    modes: { prayer: 'Prière', hifz: 'Hifz', reading: 'Lecture', translation: 'Traduction' } as Record<Mode, string>,
    modeHelp: { prayer: 'Discret : le verset en cours, le mot récité.', hifz: 'Texte caché, révélé au fil de la récitation. Indice si vous bloquez.', reading: 'Le verset en cours et le suivant.', translation: 'Traduction du verset en cours.' } as Record<Mode, string>,
    loading: 'Préparation du modèle…', ready: 'Prêt — hors ligne', listening: 'J\'écoute… commencez à réciter', searching: 'Recherche de la position…', tracking: 'Suivi',
    paused: 'En pause — valider pour reprendre', micErr: 'Micro indisponible', lang: 'Langue', trl: 'Traduction', size: 'Taille du texte', color: 'Couleur', dim: 'Luminosité', heard: 'Lettres entendues', yes: 'oui', no: 'non', about: 'Modèle',
    back: 'Retour', surah: 'Sourate', ayah: 'Verset', choose: 'Valider pour commencer ici', hint: 'Indice', stuck: 'Bloqué ? Suite :',
    helpText: ['Haut / bas : se déplacer', 'Gauche / droite : changer une valeur', 'Valider (appui) : choisir · pause', 'Retour : revenir'],
    reciteHelp: 'Valider : pause · Bas : indice · Gauche/droite : verset · Retour : menu', firstRun: 'Premier lancement : le modèle se prépare une seule fois.' },
  en: { recite: 'Recite', mode: 'Mode', start: 'Start', settings: 'Settings', help: 'Help', auto: 'Auto-detect', pick: 'Choose surah',
    modes: { prayer: 'Prayer', hifz: 'Hifz', reading: 'Reading', translation: 'Translation' } as Record<Mode, string>,
    modeHelp: { prayer: 'Discreet: current verse, word being recited.', hifz: 'Text hidden, revealed as you recite. Hint when you are stuck.', reading: 'Current verse and the next one.', translation: 'Translation of the current verse.' } as Record<Mode, string>,
    loading: 'Preparing the model…', ready: 'Ready — offline', listening: 'Listening… start reciting', searching: 'Finding your place…', tracking: 'Tracking',
    paused: 'Paused — select to resume', micErr: 'Microphone unavailable', lang: 'Language', trl: 'Translation', size: 'Text size', color: 'Colour', dim: 'Brightness', heard: 'Letters heard', yes: 'on', no: 'off', about: 'Model',
    back: 'Back', surah: 'Surah', ayah: 'Ayah', choose: 'Select to start here', hint: 'Hint', stuck: 'Stuck? Next:',
    helpText: ['Up / down: move', 'Left / right: change a value', 'Select (press): choose · pause', 'Back: go back'],
    reciteHelp: 'Select: pause · Down: hint · Left/right: verse · Back: menu', firstRun: 'First launch: the model is prepared once.' },
};
const t = () => T[S.lang];

// ── Moteur ───────────────────────────────────────────────────────────────────
const base = document.baseURI;
const engine = new QuranCtcEngine({ spawn: () => spawnClassicWorker(QURAN_CTC_WORKER_SRC),
  models: ['model.int8.onnx', 'model.int8.parts.json'].map(f => new URL('models/quran-asr-tiny/' + f, base).href).concat(['https://huggingface.co/Abdou/quran-asr-tiny/resolve/main/model.int8.onnx']),
  tokens: [new URL('models/quran-asr-tiny/tokens.txt', base).href, 'https://huggingface.co/Abdou/quran-asr-tiny/resolve/main/tokens.txt'],
  ort: [new URL('vendor/ort/', base).href, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'] });
let engineReady = false, engineErr = '', loadMsg = '';
const cap = new AudioCapture({ onChunk: (p, at) => { if (listening) engine.pushAudio(p, at); level = Math.max(level * 0.8, rms(p)); }, onStatus: (s, w) => { if (s === 'interrupted') { micErr = w; render(); } } });
let listening = false, micErr = '', level = 0;
const rms = (p: Float32Array) => { let s = 0; for (let i = 0; i < p.length; i += 4) s += p[i] * p[i]; return Math.sqrt(s / (p.length / 4)); };
session.attachEngine(engine, 'ctc');
engine.on('state', (s, w) => { if (s === 'loading-model') loadMsg = w; if (s === 'error') engineErr = w; render(); });
engine.load().then(() => { engineReady = true; render(); }).catch(e => { engineErr = (e as Error).message; render(); });

// ── Écrans ───────────────────────────────────────────────────────────────────
type Screen = 'home' | 'recite' | 'settings' | 'pick' | 'help';
let screen: Screen = 'home', sel = 0, pickS = 1, pickA = 1, pickStage: 's' | 'a' = 's', showHint = false;
interface Item { label: () => string; value?: () => string; left?: () => void; right?: () => void; go?: () => void }
const MODES: Mode[] = ['prayer', 'hifz', 'reading', 'translation'];
const cyc = <X,>(arr: X[], cur: X, d: number) => arr[(arr.indexOf(cur) + d + arr.length) % arr.length];
const homeItems: Item[] = [
  { label: () => '▶  ' + t().recite, go: () => startRecite() },
  { label: () => t().mode, value: () => t().modes[S.mode], left: () => { S.mode = cyc(MODES, S.mode, -1); save(); }, right: () => { S.mode = cyc(MODES, S.mode, 1); save(); }, go: () => { S.mode = cyc(MODES, S.mode, 1); save(); } },
  { label: () => t().start, value: () => S.start === 'auto' ? t().auto : t().pick, left: () => { S.start = S.start === 'auto' ? 'pick' : 'auto'; save(); }, right: () => { S.start = S.start === 'auto' ? 'pick' : 'auto'; save(); }, go: () => { S.start = S.start === 'auto' ? 'pick' : 'auto'; save(); } },
  { label: () => t().settings, go: () => nav('settings') },
  { label: () => t().help, go: () => nav('help') },
];
const setItems: Item[] = [
  { label: () => t().lang, value: () => S.lang === 'fr' ? 'Français' : 'English', left: () => { S.lang = S.lang === 'fr' ? 'en' : 'fr'; save(); }, right: () => { S.lang = S.lang === 'fr' ? 'en' : 'fr'; save(); } },
  { label: () => t().trl, value: () => S.tr === 'en' ? 'English (Sahih Intl.)' : 'Français (Hamidullah)', left: () => { S.tr = S.tr === 'en' ? 'fr' : 'en'; save(); }, right: () => { S.tr = S.tr === 'en' ? 'fr' : 'en'; save(); } },
  { label: () => t().size, value: () => ['S', 'M', 'L', 'XL'][S.size], left: () => { S.size = Math.max(0, S.size - 1); save(); }, right: () => { S.size = Math.min(3, S.size + 1); save(); } },
  { label: () => t().color, value: () => COLORS.find(c => c[0] === S.color)?.[S.lang === 'fr' ? 1 : 2] ?? '', left: () => { S.color = cyc(COLORS.map(c => c[0]), S.color, -1); save(); }, right: () => { S.color = cyc(COLORS.map(c => c[0]), S.color, 1); save(); } },
  { label: () => t().dim, value: () => Math.round(S.dim * 100) + ' %', left: () => { S.dim = Math.max(0.4, +(S.dim - 0.2).toFixed(1)); save(); }, right: () => { S.dim = Math.min(1, +(S.dim + 0.2).toFixed(1)); save(); } },
  { label: () => t().heard, value: () => S.showHeard ? t().yes : t().no, left: () => { S.showHeard = !S.showHeard; save(); }, right: () => { S.showHeard = !S.showHeard; save(); }, go: () => { S.showHeard = !S.showHeard; save(); } },
  { label: () => t().about, value: () => engineReady ? `${(engine.stats() as unknown as { passeMediane: number | null }).passeMediane ?? '–'} ms` : (engineErr ? '⚠' : '…') },
  { label: () => '← ' + t().back, go: () => nav('home') },
];
function nav(s: Screen) { screen = s; sel = 0; render(); }

async function startRecite() {
  if (S.start === 'pick' && screen !== 'pick') { pickStage = 's'; nav('pick'); return; }
  screen = 'recite'; showHint = false; micErr = ''; session.setMode(S.mode); render();
  try { await cap.start(); listening = true; } catch (e) { micErr = (e as Error).message; }
  try { await (navigator as unknown as { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* */ }
  render();
}
async function stopRecite() { listening = false; try { await cap.stop(); } catch { /* */ } nav('home'); }

// ── Rendu ────────────────────────────────────────────────────────────────────
function menu(items: Item[], title: string) {
  const MAX = title ? 5 : 6, from = Math.max(0, Math.min(sel - Math.floor(MAX / 2), items.length - MAX));
  return `<div class="title">${esc(title)}</div><ul class="menu">${items.map((it, i) => i < from || i >= from + MAX ? '' : `<li class="${i === sel ? 'sel' : ''}" data-i="${i}"><span>${esc(it.label())}</span>${it.value ? `<b>${it.left ? '‹ ' : ''}${esc(it.value())}${it.right ? ' ›' : ''}</b>` : ''}</li>`).join('')}</ul>${items.length > MAX ? `<div class="more">${from > 0 ? '▲' : ''} ${sel + 1}/${items.length} ${from + MAX < items.length ? '▼' : ''}</div>` : ''}`;
}
function statusLine(): string {
  if (engineErr) return `<span class="warn">⚠ ${esc(engineErr.slice(0, 140))}</span>`;
  if (!engineReady) return `${esc(t().loading)} <small>${esc(loadMsg)}</small>`;
  return esc(t().ready);
}
function verseHtml(v: SessionView, which: 'cur' | 'next'): string {
  const p = v.position ?? v.live; if (!p) return '';
  const vi = q.words[p.index].v + (which === 'next' ? 1 : 0); const ve = q.verses[vi]; if (!ve) return '';
  return ve.words.map((w, j) => {
    let c = which === 'next' ? 'nx' : j < p.word ? 'done' : j === p.word ? (v.position ? 'cur' : 'prov') : 'todo';
    if (S.mode === 'hifz' && which === 'cur' && j > p.word) return `<span class="hid">${'•'.repeat(Math.min(4, Math.max(2, Math.round(w.length / 2))))}</span>`;
    return `<span class="${c}">${esc(w)}</span>`;
  }).join(' ');
}
function recite(): string {
  const v = session.view(), p = v.position ?? v.live, L = t();
  const ref = p ? `<b>${p.surah}</b> ${esc(SURAHS[p.surah - 1][1])} · ${p.ayah}` : '';
  const st = micErr ? `<span class="warn">⚠ ${esc(L.micErr)} : ${esc(micErr.slice(0, 80))}</span>` : !listening ? esc(L.paused) : !engineReady ? esc(L.loading) : v.position && v.status === 'tracking' ? `<span class="ok">●</span> ${esc(L.tracking)}` : p ? `<span class="mid">◐</span> ${esc(L.searching)}` : `<span class="mid">◌</span> ${esc(L.listening)}`;
  let body = '';
  if (p) {
    if (S.mode === 'translation') {
      const vi = q.words[p.index].v; body = `<div class="ar small">${verseHtml(v, 'cur')}</div><div class="tr">${esc(TR[S.tr][vi] ?? '')}</div>`;
    } else if (S.mode === 'reading') body = `<div class="ar">${verseHtml(v, 'cur')}</div><div class="ar small dimmed">${verseHtml(v, 'next')}</div>`;
    else body = `<div class="ar">${verseHtml(v, 'cur')}</div>`;
    const hint = v.stuck?.hint ?? (showHint ? session.hint(3) : null);
    if (hint && hint.length) body += `<div class="hint">${esc(v.stuck ? L.stuck : L.hint)} <span class="ar">${esc(hint.join(' '))}</span></div>`;
  } else body = `<div class="idle">${esc(S.start === 'pick' ? '' : L.listening)}</div>`;
  const heard = S.showHeard ? `<div class="heard">${esc(v.heard || '')}</div>` : '';
  const lv = `<i class="lv" style="width:${Math.min(100, Math.round(level * 900))}%"></i>`;
  return `<div class="top"><span class="ref">${ref}</span><span class="mode">${esc(L.modes[S.mode])}</span></div>${body}${heard}<div class="bot"><span>${st}</span><span class="meter">${lv}</span></div>`;
}
function pick(): string {
  const L = t(), nA = q.verses.filter(v => v.s === pickS).length;
  return `<div class="title">${esc(L.start)}</div><div class="pick"><div class="${pickStage === 's' ? 'sel' : ''}">${esc(L.surah)} <b>‹ ${pickS} · ${esc(SURAHS[pickS - 1][1])} ›</b> <span class="ar">${esc(SURAHS[pickS - 1][0])}</span></div>
    <div class="${pickStage === 'a' ? 'sel' : ''}">${esc(L.ayah)} <b>‹ ${pickA} / ${nA} ›</b></div></div><div class="foot">${esc(L.choose)}</div>`;
}
function render() {
  const L = t(); let h = '';
  if (screen === 'home') h = `<div class="brand">بصيرة <span>Basirah</span></div>${menu(homeItems, '')}<div class="foot">${statusLine()} · ${esc(L.modeHelp[S.mode])}</div>`;
  else if (screen === 'settings') h = menu(setItems, L.settings);
  else if (screen === 'help') h = `<div class="title">${esc(L.help)}</div><ul class="plain">${L.helpText.map(x => `<li>${esc(x)}</li>`).join('')}<li>${esc(L.reciteHelp)}</li></ul><div class="foot">${lastKey ? esc((S.lang === 'fr' ? 'Dernière touche : ' : 'Last key: ') + lastKey) + ' · ' : ''}← ${esc(L.back)}</div>`;
  else if (screen === 'pick') h = pick();
  else h = recite();
  $('app').className = 'scr-' + screen; $('app').innerHTML = h;
}
session.onUpdate(() => { if (screen === 'recite') render(); });
const t0 = performance.now();
setInterval(() => { if (screen === 'recite' && listening) session.tick((performance.now() - t0) / 1000); }, 1000);
setInterval(() => { if (screen === 'recite') { level *= 0.85; render(); } else if (screen === 'home' && !engineReady) render(); }, 400);

// ── Commandes : anneau, pavé tactile, clavier, toucher ───────────────────────
function items() { return screen === 'home' ? homeItems : screen === 'settings' ? setItems : []; }
function act(k: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back') {
  if (screen === 'recite') {
    if (k === 'back') { void stopRecite(); return; }
    if (k === 'ok') { listening = !listening; if (listening) session.reset(); render(); return; }
    if (k === 'down' || k === 'up') { showHint = k === 'down' ? !showHint : false; render(); return; }
    const v = session.view(), p = v.position ?? v.live; if (!p) return;
    const vi = q.words[p.index].v + (k === 'right' ? 1 : -1), ve = q.verses[vi]; if (ve) session.goto(ve.s, ve.a, 0); return;
  }
  if (screen === 'pick') {
    const nA = q.verses.filter(v => v.s === pickS).length;
    if (k === 'back') { if (pickStage === 'a') pickStage = 's'; else nav('home'); render(); return; }
    if (k === 'up' || k === 'down') pickStage = pickStage === 's' ? 'a' : 's';
    if (k === 'left' || k === 'right') { const d = k === 'right' ? 1 : -1; if (pickStage === 's') { pickS = ((pickS - 1 + d + 114) % 114) + 1; pickA = 1; } else pickA = ((pickA - 1 + d + nA) % nA) + 1; }
    if (k === 'ok') { if (pickStage === 's') pickStage = 'a'; else { const s = pickS, a = pickA; screen = 'recite'; void startRecite().then(() => session.goto(s, a, 0)); return; } }
    render(); return;
  }
  if (screen === 'help') { if (k === 'back' || k === 'ok') nav('home'); return; }
  const its = items(); if (!its.length) return;
  if (k === 'up') sel = (sel - 1 + its.length) % its.length;
  else if (k === 'down') sel = (sel + 1) % its.length;
  else if (k === 'left') its[sel].left?.();
  else if (k === 'right') its[sel].right?.();
  else if (k === 'ok') its[sel].go?.();
  else if (k === 'back' && screen !== 'home') nav('home');
  render();
}
const KEYS: Record<string, Parameters<typeof act>[0]> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', ' ': 'ok', NumpadEnter: 'ok', Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back' };
addEventListener('keydown', e => { const k = KEYS[e.key]; if (k) { e.preventDefault(); act(k); } });
// Retour matériel (application Android) : renvoie true si géré
let lastKey = '';
(window as unknown as { basirahKey: (k: string) => void }).basirahKey = (k: string) => { lastKey = k; if (k.startsWith('touche')) { if (screen === 'help') render(); return; } act(k as Parameters<typeof act>[0]); };
(window as unknown as { basirahBack: () => boolean }).basirahBack = () => { if (screen === 'home') return false; act('back'); return true; };
// Toucher (pavé tactile en mode souris, téléphone) : glisser = flèches, appui = valider
// Téléphone : barre de boutons (application téléphone, ou écran tactile hors lunettes)
const params = new URLSearchParams(location.search);
if (params.get('phone') === '1' || (params.get('glasses') !== '1' && matchMedia('(pointer: coarse)').matches)) document.body.classList.add('touch');
document.querySelectorAll<HTMLButtonElement>('#pad button').forEach(b => b.addEventListener('pointerup', e => { e.stopPropagation(); const k = b.dataset.k as Parameters<typeof act>[0]; if (k === 'back' && screen === 'home') return; act(k); }));
let tx = 0, ty = 0, tt = 0;
addEventListener('pointerdown', e => { tx = e.clientX; ty = e.clientY; tt = performance.now(); });
addEventListener('pointerup', e => {
  const dx = e.clientX - tx, dy = e.clientY - ty, ad = Math.max(Math.abs(dx), Math.abs(dy));
  if (ad < 18 && performance.now() - tt < 600) { const li = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null; if (li) sel = +li.dataset.i!; act('ok'); return; }
  if (ad >= 18) act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
addEventListener('wheel', e => { if (Math.abs(e.deltaY) > 8) act(e.deltaY > 0 ? 'down' : 'up'); }, { passive: true });
apply(); render();

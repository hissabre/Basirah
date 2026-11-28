/**
 * PONT : l'interface Basirah (basirah-ui.html : logo, animation, modes, mushaf, traductions, réglages, thèmes) garde tout,
 * seule la reconnaissance change : moteur Basirah hors ligne (quran-asr-tiny + localisation par lettres).
 * Le texte du Coran utilisé par le moteur est celui déjà chargé par l'interface (V), donc les positions correspondent.
 * Le mode Khutbah (traduction de la parole libre) et le choix « Navigateur, en ligne » gardent l'ancien chemin (en ligne).
 */
import { QuranDB } from '../../src/quran/db.ts';
import { Session, type Mode } from '../../src/session/session.ts';
import { AudioCapture } from '../../src/audio/capture.ts';
import { QuranCtcEngine, spawnClassicWorker } from '../../src/engine/quran-ctc.ts';
import { QURAN_CTC_WORKER_SRC } from '../../src/engine/quran-ctc-worker-src.ts';

// Globales de l'interface (scripts classiques de la page)
declare let V: { n: number; a: number; ar: string; w: string[] }[];
declare let W: { k: number; j: number }[];
declare let last: number;
declare function render(e: number): void;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const st = (t: string) => { const e = $('st'); if (e) e.textContent = t; };
const params = new URLSearchParams(location.search);
const GLASSES = params.get('glasses') === '1';
const base = document.baseURI;
const MODE: Record<string, Mode> = { salah: 'prayer', study: 'reading', hifz: 'hifz', trad: 'translation' };

let q: QuranDB | null = null, session: Session | null = null, engine: QuranCtcEngine | null = null;
let loadP: Promise<void> | null = null, on = false, ourLast = -1, firstOf = new Map<string, number>();
const cap = new AudioCapture({ onChunk: (p, t) => { if (on) engine?.pushAudio(p, t); }, onStatus: (s, w) => { if (s === 'interrupted' && on) st('Micro interrompu : ' + w); } });

function waitQuran(): Promise<void> {
  return new Promise(res => { const t = setInterval(() => { try { if (V.length === 6236 && W.length) { clearInterval(t); res(); } } catch { /* pas encore */ } }, 150); });
}
function eOf(s: number, a: number, j: number): number {
  if (!firstOf.size) W.forEach((w, i) => { const v = V[w.k], k = v.n + ':' + v.a; if (!firstOf.has(k)) firstOf.set(k, i); });
  const e0 = firstOf.get(s + ':' + a); if (e0 === undefined) return -1;
  return e0 + Math.max(0, Math.min(j, V[W[e0].k].w.length - 1));
}
function load(): Promise<void> {
  if (loadP) return loadP;
  return loadP = (async () => {
    await waitQuran();
    q = new QuranDB({ riwaya: 'hafs', source: 'Tanzil (texte de l\'interface)', verses: V.map(v => [v.n, v.a, v.ar] as [number, number, string]) });
    session = new Session({ quran: q });
    engine = new QuranCtcEngine({ spawn: () => spawnClassicWorker(QURAN_CTC_WORKER_SRC),
      models: ['model.int8.onnx', 'model.int8.parts.json'].map(f => new URL('models/quran-asr-tiny/' + f, base).href).concat(['https://huggingface.co/Abdou/quran-asr-tiny/resolve/main/model.int8.onnx']),
      tokens: [new URL('models/quran-asr-tiny/tokens.txt', base).href, 'https://huggingface.co/Abdou/quran-asr-tiny/resolve/main/tokens.txt'],
      ort: [new URL('vendor/ort/', base).href, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'] });
    session.attachEngine(engine, 'ctc');
    engine.on('state', (s, w) => { if (s === 'loading-model') st('Moteur Basirah : ' + w); if (s === 'error') st('Erreur moteur : ' + w); });
    session.onUpdate(v => {
      if (!on) return;
      const p = v.position;
      if (p) {
        const e = eOf(p.surah, p.ayah, p.word);
        if (e >= 0 && e !== last) { ourLast = e; render(e); }
        st('');
      } else st(v.live ? 'Recherche de la position…' : 'À l’écoute… récitez');
    });
    await engine.load();
    syncMode(); st('Moteur Basirah prêt (hors ligne).');
  })();
}
function syncMode() { if (session) session.setMode(MODE[document.body.dataset.mode || 'salah'] ?? 'prayer'); }

async function start() {
  const wb = $('wb');
  try {
    await load(); syncMode();
    // reprend à la position affichée si l'utilisateur en a choisi une (Lecture, Hifz, mushaf, reprise)
    if (last >= 0 && session) { const w = W[last], v = V[w.k]; session.reset(); session.goto(v.n, v.a, w.j); ourLast = last; } else session?.reset();
    await cap.start(); on = true; wb.classList.add('rec'); wb.setAttribute('aria-label', 'Arrêter');
    st('À l’écoute… récitez');
    try { await (navigator as unknown as { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* */ }
  } catch (e) { on = false; wb.classList.remove('rec'); st('Micro refusé ou moteur indisponible : ' + ((e as Error).message || e)); }
}
async function stop() { on = false; try { await cap.stop(); } catch { /* */ } const wb = $('wb'); wb.classList.remove('rec'); wb.setAttribute('aria-label', 'Écouter'); st(''); }

function install() {
  const hudCss = document.createElement('style');
  hudCss.textContent = 'body.sg #bn,body.sg #wb,body.sg #ts{display:none!important}' + (GLASSES ? 'html:has(body.sg),body.sg{background:#000!important}' : '')
    + 'body.sg #st{background:none!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;height:auto!important;min-height:0!important;padding:0 4vw!important;top:3vh!important;bottom:auto!important;left:0!important;right:0!important;width:auto!important;max-width:none!important;text-align:center!important;transform:none!important}'
    + 'body.sg #hud .idle{font-size:0!important}body.sg #hud .idle::after{content:var(--idle);display:block;font-size:3vh;line-height:1.6;white-space:pre-line}'
    + 'body.sg{cursor:pointer}';
  document.head.appendChild(hudCss);
  const wb = $('wb'); if (!wb) { setTimeout(install, 200); return; }
  const orig = wb.onclick as ((this: GlobalEventHandlers, ev: MouseEvent) => unknown) | null;
  const eng = $('eng') as HTMLSelectElement | null;
  if (eng) {
    eng.innerHTML = '<option value="basirah">Basirah, hors ligne (recommandé)</option><option value="browser">Navigateur, en ligne</option>';
    let v = 'basirah'; try { v = localStorage.getItem('eng2') || 'basirah'; } catch { /* */ } eng.value = v === 'browser' ? 'browser' : 'basirah';
    eng.addEventListener('change', () => { try { localStorage.setItem('eng2', eng.value); localStorage.setItem('eng', eng.value === 'browser' ? 'browser' : 'auto'); } catch { /* */ } });
    try { localStorage.setItem('eng', eng.value === 'browser' ? 'browser' : 'auto'); } catch { /* */ }
    for (const id of ['wm', 'wg', 'dg', 'dgo']) { const x = $(id); if (x) { x.style.display = 'none'; const pk = x.nextElementSibling as HTMLElement | null; if (pk?.classList.contains('pk')) pk.style.display = 'none'; } }
    document.querySelectorAll('#dr2 h4').forEach(h => { if (/Whisper/.test(h.textContent || '')) (h as HTMLElement).style.display = 'none'; });
    const css = document.createElement('style'); css.textContent = '#wm,#wm+.pk,#wg,#wg+.pk,#dg,#dgo{display:none!important}'; document.head.appendChild(css);
  }
  const setEg = () => { (window as unknown as { __eg: string }).__eg = 'Basirah hors ligne'; const e = $('engs'); if (e) e.textContent = '🔒 Moteur Basirah : reconnaissance sur l’appareil, hors ligne. Aucun son n’est envoyé.'; (window as unknown as { __paint?: () => void }).__paint?.(); };
  wb.onclick = (ev: MouseEvent) => {
    const mode = document.body.dataset.mode || 'salah', online = mode === 'trad' || eng?.value === 'browser';
    if (on) { void stop(); return; }
    if (online || (wb.classList.contains('rec'))) return orig?.call(wb, ev); // parole libre (Khutbah) ou moteur en ligne choisi
    setEg(); void start();
  };
  // changement de mode
  new MutationObserver(() => { syncMode(); }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
  // l'utilisateur choisit une position (flèches, mushaf, reprise) : le moteur repart de là
  setInterval(() => { try { if (on && session && last >= 0 && last !== ourLast) { const w = W[last], v = V[w.k]; ourLast = last; session.goto(v.n, v.a, w.j); } } catch { /* */ } }, 400);
  setEg(); void load();
  if (GLASSES) {
    setTimeout(() => (window as unknown as { __hud?: (on: number) => void }).__hud?.(1), 4500);
    // lunettes : pas d'écran de choix de langue (invisible dans le HUD) — français par défaut, modifiable dans les réglages
    const t = setInterval(() => { const fr = document.getElementById('fr'); if (!fr) return; clearInterval(t);
      const bs = [...fr.querySelectorAll<HTMLButtonElement>('button')]; (bs.find(b => /^fr/.test(b.dataset.v || '')) ?? bs[0])?.click(); }, 300);
    setTimeout(() => clearInterval(t), 20000);
  }
}

// ── Commandes communes (lunettes, émulateur Android XR, téléphone) ──
const MODES_ORDER = ['salah', 'study', 'hifz', 'trad'];
const MODE_NAME: Record<string, string> = { salah: 'Prière', study: 'Lecture', hifz: 'Hifz', trad: 'Khutbah' };
function toggleListen() { $('wb')?.click(); }
function verse(d: number) { $(d > 0 ? 'nx3' : 'pv2')?.click(); }
function nextMode(d = 1) {
  const cur = document.body.dataset.mode || 'salah', m = MODES_ORDER[(MODES_ORDER.indexOf(cur) + d + MODES_ORDER.length) % MODES_ORDER.length];
  (document.querySelector(`#tabs button[data-m="${m}"]`) as HTMLElement | null)?.click(); st('Mode : ' + MODE_NAME[m]); flash('Mode : ' + MODE_NAME[m]);
}
let flashT = 0;
function flash(t: string) { const e = $('st'); if (!e) return; e.textContent = t; clearTimeout(flashT); flashT = window.setTimeout(() => { if (e.textContent === t) e.textContent = ''; }, 1800); }
// Aide affichée dans l'affichage tête haute quand rien n'est encore reconnu
function idleHelp() {
  const listening = $('wb')?.classList.contains('rec');
  const t = (listening ? 'À l’écoute… récitez, le verset s’affichera ici.\n' : 'Prêt (hors ligne).\n')
    + 'Cliquer · Entrée · Volume + : ' + (listening ? 'arrêter' : 'écouter') + '\n← → : verset · ↑ ↓ ou Volume − : mode (' + MODE_NAME[document.body.dataset.mode || 'salah'] + ')\nRetour (◁ ou Échap) : menu et réglages';
  document.body.style.setProperty('--idle', '"' + t.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\A ') + '"');
}
setInterval(idleHelp, 500);
// Clic / toucher dans l'affichage tête haute = écouter / arrêter
document.addEventListener('click', e => {
  if (!e.isTrusted || !document.body.classList.contains('sg') || document.getElementById('splash')) return; // clics réels seulement (pas ceux que l'app déclenche elle-même)
  e.stopPropagation(); e.preventDefault(); toggleListen();
}, true);

// ── Anneau / pavé tactile / télécommande (lunettes, application Android) ──
function focusables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('button, [tabindex="0"], input, select')].filter(e => e.offsetParent !== null && !(e as HTMLButtonElement).disabled && getComputedStyle(e).visibility !== 'hidden');
}
function moveFocus(d: number) {
  const f = focusables(); if (!f.length) return; const i = f.indexOf(document.activeElement as HTMLElement);
  const n = f[(i + d + f.length) % f.length]; n.focus(); n.scrollIntoView?.({ block: 'nearest' });
}
function key(k: string) {
  const b = document.body, hud = b.classList.contains('sg');
  if ($('splash')) { (window as unknown as { __splashClose?: () => void }).__splashClose?.(); return; }
  if (k === 'listen') { toggleListen(); return; }
  if (k === 'mode') { nextMode(1); return; }
  if (hud) {
    if (k === 'ok') toggleListen();
    else if (k === 'left') verse(-1); else if (k === 'right') verse(1);
    else if (k === 'up') nextMode(-1); else if (k === 'down') nextMode(1);
    else if (k === 'back') (window as unknown as { __hud?: (on: number) => void }).__hud?.(0);
    return;
  }
  if (k === 'up' || k === 'left') moveFocus(-1);
  else if (k === 'down' || k === 'right') moveFocus(1);
  else if (k === 'ok') (document.activeElement as HTMLElement | null)?.click();
}
(window as unknown as { basirahKey: (k: string) => void }).basirahKey = k => { if (!k.startsWith('touche')) key(k); };
(window as unknown as { basirahBack: () => boolean }).basirahBack = () => {
  const b = document.body;
  if (document.getElementById('pks')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; }
  const dr = $('dr2'); if (dr?.classList.contains('o')) { $('dx2')?.click(); return true; }
  // lunettes : Retour bascule entre l'affichage tête haute et l'interface complète (réglages) ; on quitte par le bouton Accueil du système
  if (GLASSES) { (window as unknown as { __hud?: (on: number) => void }).__hud?.(b.classList.contains('sg') ? 0 : 1); return true; }
  return false;
};
// Clavier (navigateur, émulateur) : mêmes commandes
addEventListener('keydown', e => {
  const m: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', ' ': 'ok' };
  if (document.body.classList.contains('sg')) {
    if (m[e.key]) { e.preventDefault(); key(m[e.key]); }
    else if (e.key === 'Escape') { e.preventDefault(); (window as unknown as { basirahBack: () => boolean }).basirahBack(); }
  } else if (GLASSES && e.key === 'Escape' && !document.getElementById('pks')) { (window as unknown as { basirahBack: () => boolean }).basirahBack(); }
});
install();

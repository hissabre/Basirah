// Moteur Whisper : logique de fenêtres glissantes, accord entre passes, déduplication, silence. SIMULÉ : faux worker qui « entend » un calendrier de mots.
// Ce test mesure le retard DE LA LOGIQUE pour une durée de passe donnée ; il ne dit rien de la qualité réelle de Whisper.
import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { Session } from '../src/session/session.ts';
import { norm } from '../src/quran/normalize.ts';
import { WhisperEngine, type WorkerLike } from '../src/engine/whisper.ts';

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
const raw = JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8'));
const q = new QuranDB(raw);
const vs: any[] = raw.verses; const words: string[] = vs.find(v => v[0] === 2 && v[1] === 255)[2].split(' ').filter(w => norm(w)).slice(0, 24); // sans les signes de pause isolés
const WPS = 2; // mots par seconde de récitation

/** Faux Whisper : renvoie les mots entièrement prononcés dans la fenêtre reçue, après `delay` secondes d'audio (durée simulée de la passe). */
function fakeWorker(delay: number, ctl: { now: number; heard: (end: number, len: number) => string }) {
  const pend: { at: number; text: string }[] = [];
  const w: WorkerLike & { tick(now: number): void } = {
    onmessage: null,
    postMessage(m: any) {
      if (m.init) { setTimeout(() => w.onmessage?.({ data: { ready: 1, dev: 'wasm' } }), 0); return; }
      pend.push({ at: ctl.now + delay, text: ctl.heard(ctl.now, m.audio.length / 16000) });
    },
    tick(now: number) { while (pend.length && pend[0].at <= now) w.onmessage?.({ data: { text: pend.shift()!.text } }); },
  };
  return w;
}
async function run(delay: number, holdback: number | undefined, speakSec = 12, silenceSec = 0) {
  const ctl = { now: 0, heard: (end: number, len: number) => words.filter((_, i) => (i + 1) / WPS <= Math.min(end, speakSec) && i / WPS >= end - len - 0.05).join(' ') };
  const w = fakeWorker(delay, ctl); const eng = new WhisperEngine({ spawn: () => w, holdback, windowSec: 8, minHopSec: 0.5 });
  const se = new Session({ quran: q }); se.setMode('prayer'); se.attachEngine(eng, 'text'); await eng.load();
  let firstPos = -1; const reach: Record<number, number> = {}; let results = 0, dupWords = 0, seen: string[] = [];
  eng.on('result', r => { results++; for (const x of r.text.split(' ')) { seen.push(x); } });
  for (let s = 0; s < (speakSec + silenceSec + delay + 6) * 10; s++) {
    ctl.now = s / 10; const blk = new Float32Array(1600).fill(ctl.now < speakSec ? 0.1 : 0.0001); eng.pushAudio(blk, ctl.now); w.tick(ctl.now + 0.1);
    const v = se.view(); if (firstPos < 0 && v.position) firstPos = ctl.now;
    if (v.position) { const i = v.position.word; for (let k = 0; k <= i; k++) if (reach[k] === undefined) reach[k] = ctl.now; }
  }
  const lags = Object.entries(reach).filter(([k]) => +k >= 6 && +k < words.length - 3).map(([k, at]) => at - (+k + 1) / WPS);
  const med = lags.length ? [...lags].sort((a, b) => a - b)[lags.length >> 1] : NaN;
  const uniq = new Set(seen).size; dupWords = seen.length - words.length;
  return { firstPos, med, results, seen: seen.length, dup: dupWords, runs: eng.runs, misses: eng.overlapMisses, finalWord: se.view().position?.word ?? -1, uniq };
}
console.log('\n[Whisper — flux glissant (simulation)]');
for (const [delay, hb] of [[1, undefined], [1, 2], [3, undefined], [3, 2]] as const) {
  const r = await run(delay, hb);
  console.log(`   passe ${delay} s · ${hb == null ? 'accord entre passes' : 'retenue ' + hb + ' mots'} → premier verrouillage ${r.firstPos.toFixed(1)} s · retard médian ${r.med.toFixed(1)} s · mots transmis ${r.seen}/${words.length} (doublons ${r.dup}) · ratés de recouvrement ${r.misses}`);
  t(`passe ${delay} s / ${hb == null ? 'accord' : 'retenue'} : suivi jusqu'au dernier mot parlé`, r.finalWord >= 8, `mot ${r.finalWord}`);
  t(`passe ${delay} s / ${hb == null ? 'accord' : 'retenue'} : peu de doublons (≤ 25 % du texte)`, r.dup <= words.length * 0.25, `${r.dup} doublons`);
}
{
  const r = await run(1, undefined, 8, 4);
  t('silence prolongé : les derniers mots en attente sont validés', r.finalWord >= 14, `mot ${r.finalWord}`);
  t('aucune passe pendant le silence (pas d\'hallucination)', r.runs < (8 + 4) * 10, `${r.runs} passes`);
}
console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);

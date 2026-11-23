/** Test de la LOGIQUE du banc d'essai avec un moteur FACTICE (simulé) : il émet les mots du verset avec un retard fixe. Aucun vrai moteur ni vraie voix. */
import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { Session } from '../src/session/session.ts';
import { TranslationPipeline, UnavailableTranslator } from '../src/translation/pipeline.ts';
import { runBench, benchReport, parseVerseName } from '../src/app/bench.ts';
import type { RecognitionEngine, RecognitionResult, RecognizerEvents } from '../src/types.ts';

const q = new QuranDB(JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
console.log('\n[Banc d\'essai — moteur FACTICE]');
t('nom EveryAyah 067001.mp3 → 67:1', JSON.stringify(parseVerseName('067001.mp3')) === '{"s":67,"a":1}');
t('nom sans numéro → null', parseVerseName('recording.wav') === null);
t('verset impossible 115001 → null', parseVerseName('115001.mp3') === null);

class Fake implements RecognitionEngine {
  readonly kind = 'offline' as const; readonly id = 'FACTICE'; fns: ((r: RecognitionResult) => void)[] = [];
  script: { w: string; at: number }[] = []; sent = 0; startClock = 0;
  constructor(private delay: number, private wps: number) {}
  /** Le verset commence à `startClock` (horloge audio) : mots à 2,5 mots/s, vus par le moteur avec `delay` s de retard. */
  setVerse(words: string[], startClock: number) { this.script = words.map((w, i) => ({ w, at: startClock + 0.3 + i / this.wps })); this.sent = 0; }
  async load() {} dispose = async () => {}; flush = async () => {}; stats() { return { queued: 0, lastLatencyMs: this.delay * 1000 }; }
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { if (ev === 'result') this.fns.push(fn as never); }
  pushAudio(pcm: Float32Array, start: number) {
    const clock = start + pcm.length / 16000;
    while (this.sent < this.script.length && this.script[this.sent].at + this.delay <= clock) {
      const w = this.script[this.sent++]; const r: RecognitionResult = { text: w.w, unit: 'text', language: 'ar', audioStart: clock, audioEnd: clock, receivedAt: 0, isFinal: true, confidence: null, engine: 'offline', engineId: 'FACTICE' };
      this.fns.forEach(f => f(r));
    }
  }
}
const VERSES: [number, number][] = [[67, 1], [112, 1], [67, 2]];
const durOf = ([a, b]: [number, number]) => 0.3 + q.verses.find(x => x.s === a && x.a === b)!.words.length / 2.5 + 0.2;
async function go(delay: number) {
  const e = new Fake(delay, 2.5), s = new Session({ quran: q, translation: new TranslationPipeline(new UnavailableTranslator('offline', 'aucun', 'x'), { sourceLang: 'ar', targetLang: 'fr' }) });
  s.attachEngine(e, 'text');
  const files = VERSES.map(([a, b]) => ({ name: String(a).padStart(3, '0') + String(b).padStart(3, '0') + '.mp3', pcm: new Float32Array(Math.round(16000 * durOf([a, b]))) }));
  let clock = 0, base = 0, k = 0; const now = () => clock * 1000, sleep = async (ms: number) => { clock += ms / 1000; };
  const orig = s.reset.bind(s);
  s.reset = () => { orig(); const [a, b] = VERSES[k++]; const v = q.verses.find(x => x.s === a && x.a === b)!; e.setVerse(v.words, base); base += durOf([a, b]) + 3 + 1; };
  const rows = await runBench(files, { engine: e, session: s, quran: q, pace: 1, now, sleep });
  return { rows, report: benchReport(rows, { engine: 'FACTICE (simulé)', pace: 1 }) };
}
const a = await go(0.8), b = await go(2.5);
console.log(a.report.split('\n').map(l => '    ' + l).join('\n'));
t('retrouve le bon verset pour 3/3 fichiers', a.rows.every(r => r.firstCorrectSec !== null), a.rows.map(r => r.finalPos).join(' '));
t('un retard de moteur plus grand → retard de fin plus grand (la mesure est sensible)', (b.rows[0].endLagSec ?? 0) > (a.rows[0].endLagSec ?? 0), `${a.rows[0].endLagSec?.toFixed(1)} s → ${b.rows[0].endLagSec?.toFixed(1)} s`);
t('le rapport contient le bilan', /Verset trouvé : 3\/3/.test(a.report));
console.log(`\n${pass} réussis, ${fail} échoués  (moteur FACTICE : valide la logique de mesure, pas un moteur réel)`);
process.exit(fail ? 1 : 0);

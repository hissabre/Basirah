import type { RecognitionEngine } from '../types.ts';
import type { Session } from '../session/session.ts';
import type { QuranDB } from '../quran/db.ts';

/** Nom de fichier → verset attendu. Convention EveryAyah : « 067001.mp3 » = sourate 67, verset 1 (6 chiffres consécutifs). */
export function parseVerseName(name: string): { s: number; a: number } | null {
  const m = /(?:^|[^0-9])(\d{3})(\d{3})(?:[^0-9]|$)/.exec(name);
  if (!m) return null; const s = +m[1], a = +m[2];
  return s >= 1 && s <= 114 && a >= 1 ? { s, a } : null;
}

export interface BenchFile { name: string; pcm: Float32Array }
export interface BenchRow {
  name: string; expected: { s: number; a: number } | null; audioSec: number;
  /** Secondes d'horloge depuis le début de l'audio jusqu'à la première position dans le bon verset. */
  firstCorrectSec: number | null;
  /** Secondes d'horloge APRÈS la fin de l'audio avant d'atteindre le dernier mot (0 = déjà atteint à la fin). null = jamais. */
  endLagSec: number | null;
  reachedEnd: boolean; finalPos: string; engineMs: number | null;
}
export interface BenchDeps {
  engine: RecognitionEngine; session: Session; quran: QuranDB;
  /** 1 = temps réel (mesure la vraie latence) ; 4 = 4× plus vite (précision seulement, la latence n'est plus représentative). */
  pace: number;
  now: () => number; sleep: (ms: number) => Promise<void>;
  /** Silence ajouté après chaque fichier pour que le moteur valide la fin, puis attente maximale de la fin (secondes). */
  tailSilenceSec?: number; maxEndWaitSec?: number;
  onProgress?: (msg: string) => void;
}

/**
 * Fait passer de vrais fichiers audio dans le moteur ET la session de l'application, au rythme du temps réel,
 * et mesure : verset trouvé ? au bout de combien de temps ? combien de temps après la fin de la récitation le dernier mot est-il atteint ?
 */
export async function runBench(files: BenchFile[], d: BenchDeps): Promise<BenchRow[]> {
  const rows: BenchRow[] = [], BLK = 0.1, tail = d.tailSilenceSec ?? 3, maxWait = d.maxEndWaitSec ?? 12;
  let base = 0;
  for (const f of files) {
    const exp = parseVerseName(f.name), verse = exp ? d.quran.verses.find(v => v.s === exp.s && v.a === exp.a) : undefined;
    d.session.reset(); d.onProgress?.(`${f.name} (${(f.pcm.length / 16000).toFixed(1)} s) …`);
    const n = Math.round(16000 * BLK), t0 = d.now(), audioSec = f.pcm.length / 16000;
    let first: number | null = null, endAt: number | null = null, tEnd = 0;
    const inVerse = () => { const p = d.session.view().position; return !!(exp && p && p.surah === exp.s && p.ayah === exp.a); };
    const atEnd = () => {
      const p = d.session.view().position; if (!exp || !verse || !p) return false;
      return (p.surah === exp.s && p.ayah === exp.a && p.word >= verse.words.length - 1) || (p.surah === exp.s && p.ayah > exp.a) || p.surah > exp.s;
    };
    const check = () => { const t = (d.now() - t0) / 1000; if (first === null && inVerse()) first = t; if (endAt === null && atEnd()) endAt = t; };
    const feed = async (pcm: Float32Array, off: number) => {
      for (let i = 0; i < pcm.length; i += n) {
        d.engine.pushAudio(pcm.subarray(i, Math.min(pcm.length, i + n)), base + off + i / 16000);
        d.session.tick(base + off + i / 16000); await d.sleep(1000 * BLK / d.pace); check();
      }
    };
    await feed(f.pcm, 0); tEnd = (d.now() - t0) / 1000;
    await feed(new Float32Array(Math.round(tail * 16000)), audioSec);
    for (let w = 0; w < maxWait * 10 && endAt === null; w++) { await d.sleep(100); d.session.tick(base + audioSec + tail + w / 10); check(); }
    await d.engine.flush(); await d.sleep(50); check();
    const p = d.session.view().position, st = d.engine.stats();
    rows.push({ name: f.name, expected: exp, audioSec, firstCorrectSec: first, endLagSec: endAt === null ? null : Math.max(0, endAt - tEnd), reachedEnd: endAt !== null,
      finalPos: p ? `${p.surah}:${p.ayah}/${p.word}` : '—', engineMs: st.lastLatencyMs });
    base += audioSec + tail + 1;
  }
  return rows;
}

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
export function benchReport(rows: BenchRow[], meta: { engine: string; pace: number }): string {
  const withExp = rows.filter(r => r.expected), ok = withExp.filter(r => r.firstCorrectSec !== null), end = withExp.filter(r => r.reachedEnd);
  const f = (x: number | null) => (x === null ? '—' : x.toFixed(1) + ' s');
  const L = [`BANC D'ESSAI — moteur ${meta.engine} · ${meta.pace === 1 ? 'temps réel' : 'x' + meta.pace + ' (latence non représentative)'} · ${rows.length} fichier(s)`, ''];
  for (const r of rows) L.push(`${r.name.padEnd(22)} attendu ${r.expected ? r.expected.s + ':' + r.expected.a : '?'} · durée ${r.audioSec.toFixed(1)} s · bon verset après ${f(r.firstCorrectSec)} · dernier mot ${r.reachedEnd ? 'atteint, ' + f(r.endLagSec) + ' après la fin' : 'NON atteint'} · position finale ${r.finalPos}`);
  L.push('', `Verset trouvé : ${ok.length}/${withExp.length} · fin du verset atteinte : ${end.length}/${withExp.length}`,
    `Médiane « bon verset après » : ${f(med(ok.map(r => r.firstCorrectSec!)))} · médiane « retard de fin » : ${f(med(end.map(r => r.endLagSec!)))}`);
  if (rows.some(r => !r.expected)) L.push('(Fichiers sans numéro de verset 6 chiffres dans leur nom : non évalués — ex. 067001.mp3)');
  return L.join('\n');
}

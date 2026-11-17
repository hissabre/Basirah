/**
 * Évaluateur : manifeste + résultats d'un moteur (JSONL par enregistrement) → rapport JSON/Markdown.
 *   node --experimental-transform-types src/eval/cli.ts --manifest dataset/manifest.json --hyps out/whisper-quran --engine whisper-quran
 *        [--lexicon data/quranlab-lexicon.json] [--profile prayer] [--out reports] [--purpose internal-evaluation]
 * Les enregistrements dont la licence n'autorise pas l'usage demandé sont EXCLUS et listés (jamais traités en silence).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { QuranDB } from '../quran/db.ts';
import { PhonemeDB, type PhonemeLexicon } from '../quran/phoneme-db.ts';
import { can, validate, type Manifest, type Recording, type Purpose } from './manifest.ts';
import { wer, cer, per, pool, type EditCounts } from './metrics.ts';
import { replayTracking, summarize, type HypLine, type TrackReport } from './tracking.ts';
import type { ProfileName } from '../align/aligner.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const manifestPath = arg('manifest')!, hypDir = arg('hyps')!, engine = arg('engine', 'engine')!, outDir = arg('out', 'reports')!;
const profile = arg('profile', 'prayer') as ProfileName, purpose = arg('purpose', 'internal-evaluation') as Purpose, lexPath = arg('lexicon');
if (!manifestPath || !hypDir) { console.error('--manifest et --hyps requis'); process.exit(2); }

const q = new QuranDB(JSON.parse(readFileSync(new URL('../../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
const man: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const errs = validate(man, q); if (errs.length) { console.error('Manifeste invalide :\n' + errs.join('\n')); process.exit(2); }
const lex: PhonemeLexicon | null = lexPath && existsSync(lexPath) ? JSON.parse(readFileSync(lexPath, 'utf8')) : null;
const pdb = lex ? new PhonemeDB(lex) : null;

const excluded: string[] = [], rows: any[] = [];
const wers: EditCounts[] = [], cers: EditCounts[] = [], pers: EditCounts[] = [];
const groups: Record<string, { acc: number[]; lag: number[]; fj: number; n: number }> = {};

function refText(r: Recording): string | null {
  const parts: string[] = [];
  for (const s of r.reference.segments) { if (s.kind === 'non-quran') return null; if (s.kind !== 'quran') continue;
    for (const v of q.verses) if (v.s === s.surah && v.a >= s.ayahFrom! && v.a <= s.ayahTo!) parts.push(v.words.join(' ')); }
  return parts.join(' ');
}
function refUnits(r: Recording): string[] | null {
  if (!lex) return null; const out: string[] = [];
  for (const s of r.reference.segments) { if (s.kind !== 'quran') continue; for (const v of lex.verses) if (v.s === s.surah && v.a >= s.ayahFrom! && v.a <= s.ayahTo!) out.push(...v.words.flat()); }
  return out;
}

for (const r of man.recordings) {
  const c = can(r, purpose); if (!c.ok) { excluded.push(`${r.id} : ${c.why}`); continue; }
  const f = `${hypDir}/${r.id}.jsonl`; if (!existsSync(f)) { excluded.push(`${r.id} : pas de résultats du moteur (${f})`); continue; }
  const hyps: HypLine[] = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l: string) => JSON.parse(l));
  const finals = hyps.filter(h => h.isFinal), row: any = { id: r.id, reciter: r.reciter.name, env: r.conditions.environment, noise: r.conditions.noise, speed: r.conditions.speed };
  const phon = hyps.some(h => h.unit === 'phoneme');
  const rt = refText(r);
  if (!phon && rt !== null) { const h = finals.map(x => x.text).join(' '); const w = wer(rt, h), cc = cer(rt, h); wers.push(w); cers.push(cc); row.wer = w.rate; row.cer = cc.rate; }
  if (phon) { const ru = refUnits(r); if (ru) { const e = per(ru, finals.flatMap(x => x.tokens ?? [])); pers.push(e); row.per = e.rate; } else row.per = null; }
  let tr: TrackReport | null = null;
  const hasTimes = r.reference.segments.some(s => s.ayahTimes?.length);
  if (hasTimes) {
    if (phon && pdb) tr = replayTracking(pdb, r, hyps, 'phoneme', p => ({ s: p.surah, a: p.ayah }));
    else if (!phon) tr = replayTracking(q, r, hyps, profile);
  }
  if (tr) { row.track = { ...tr, recoveries: summarize(tr.recoveries), lagSec: summarize(tr.lagSec) };
    for (const k of [`env:${r.conditions.environment}`, `noise:${r.conditions.noise}`, `speed:${r.conditions.speed}`, `reciter:${r.reciter.name}`, 'ALL']) {
      const g = (groups[k] ??= { acc: [], lag: [], fj: 0, n: 0 }); if (tr.ayahAccuracy !== null) g.acc.push(tr.ayahAccuracy); g.lag.push(...tr.lagSec); g.fj += tr.falseJumps; g.n++; } }
  rows.push(row);
}
const rate = (x: EditCounts[]) => x.length ? pool(x) : null;
const med = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;
const report = { engine, profile, purpose, recordings: rows.length, excluded,
  wer: rate(wers), cer: rate(cers), per: rate(pers),
  tracking: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { recordings: g.n, ayahAccuracyMean: g.acc.length ? g.acc.reduce((a, b) => a + b, 0) / g.acc.length : null, lagMedianSec: med(g.lag), falseJumps: g.fj }])), rows };
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/${engine}.json`, JSON.stringify(report, null, 2));
const pc = (x: number | null | undefined) => x == null ? 'n/a' : (100 * x).toFixed(1) + ' %';
const md = [`# ${engine} — ${rows.length} enregistrements (profil ${profile}, usage ${purpose})`, '',
  `WER ${pc(report.wer?.rate)} · CER ${pc(report.cer?.rate)} · PER ${pc(report.per?.rate)}`, '',
  '| Groupe | Enreg. | Verset correct | Retard médian | Sauts erronés |', '|---|---|---|---|---|',
  ...Object.entries(report.tracking).map(([k, g]: any) => `| ${k} | ${g.recordings} | ${pc(g.ayahAccuracyMean)} | ${g.lagMedianSec == null ? 'n/a' : g.lagMedianSec.toFixed(2) + ' s'} | ${g.falseJumps} |`),
  '', excluded.length ? '## Exclus\n' + excluded.map(x => '- ' + x).join('\n') : ''].join('\n');
writeFileSync(`${outDir}/${engine}.md`, md); console.log(md);

/**
 * Essai bout en bout sur UN fichier WAV 16 kHz mono : Zipformer (sherpa-onnx-node) → Stabilizer → alignement phonémique → position.
 *   npm i sherpa-onnx-node
 *   npm run try:zipformer -- --wav audio.wav --model quran_phoneme_zipformer.int8.onnx --tokens tokens.txt --lexicon data/quranlab-lexicon.json [--mode prayer]
 * NON EXÉCUTÉ par l'auteur (pas de modèle ni de paquet disponibles) : c'est VOTRE premier test réel. Il affiche chaque changement de position
 * confirmé, le facteur temps réel (RTF) et l'état du moteur. Il ne prétend rien : s'il échoue, copiez le message exact.
 */
import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { PhonemeDB, lexiconCompat } from '../src/quran/phoneme-db.ts';
import { ZipformerEngine } from '../src/engine/zipformer.ts';
import { nodeBackend } from '../src/engine/sherpa.ts';
import { Session, type Mode } from '../src/session/session.ts';
import { runPcm, readWav } from '../src/app/run-pcm.ts';

const a = (k: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const need = (k: string) => { const v = a(k); if (!v) { console.error(`--${k} requis`); process.exit(2); } return v; };
const q = new QuranDB(JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
const lex = JSON.parse(readFileSync(need('lexicon'), 'utf8')); const ph = new PhonemeDB(lex);
const cm = lexiconCompat(q, ph); if (cm.mismatchedVerses) console.warn(`ATTENTION : ${cm.mismatchedVerses}/${cm.total} versets du lexique n'ont pas la même segmentation en mots que le texte.`);
const eng = new ZipformerEngine(nodeBackend({ model: need('model'), tokens: need('tokens'), numThreads: +(a('threads') ?? 2) }));
const s = new Session({ quran: q, phoneme: ph }); s.setMode((a('mode') ?? 'prayer') as Mode); s.attachEngine(eng, 'phoneme');
let last = ''; s.onUpdate(v => { const k = v.position ? `${v.position.surah}:${v.position.ayah}/${v.position.word}` : '-'; if (k !== last) { last = k; console.log(`position ${k}  état ${v.status}  confiance ${v.confidence.toFixed(2)}`); } });
eng.on('state', (st, why) => console.log(`[moteur] ${st} — ${why}`));
await eng.load();
const r = await runPcm(eng, readWav(new Uint8Array(readFileSync(need('wav')))));
console.log(`\nAudio ${r.audioSec.toFixed(1)} s · calcul ${r.wallSec.toFixed(1)} s · RTF ${r.rtf.toFixed(2)} (doit rester < 1)  ·  latence max ${eng.maxLat.toFixed(0)} ms · audio abandonné ${eng.droppedSec.toFixed(1)} s`);
console.log('Journal :'); s.log.slice(-15).forEach(l => console.log('  ' + l.msg));
await eng.dispose();

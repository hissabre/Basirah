import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { Aligner } from '../src/align/aligner.ts';
import { Stabilizer } from '../src/align/stabilizer.ts';
import { RecognizerFSM } from '../src/engine/state-machine.ts';
import { RingBuffer } from '../src/audio/ringbuffer.ts';
import { rng, transcribe, verseSpan, play, corrupt } from './sim.ts';

const raw = JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8'));
const db = new QuranDB(raw);
let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { (ok ? pass++ : fail++); console.log((ok ? '  ✓ ' : '  ✗ ') + name + (info ? '  — ' + info : '')); };
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) : '0') + ' %';

console.log('\n[Base du Coran]');
t('6236 versets', db.verses.length === 6236);
t('114 sourates', db.surahStarts.length === 114);
t('mots indexés', db.words.length > 77000, db.words.length + ' mots');
t('texte original intact (Fatiha 1:2)', db.verses[1].text === raw.verses[1][2]);

console.log('\n[Machine d\'états]');
{
  let now = 0; const f = new RecognizerFSM(() => now, 3, 60000);
  t('idle → requesting-mic → initializing → listening', f.to('requesting-mic', 'test') && f.to('initializing', 'x') && f.to('listening', 'x'));
  t('transition interdite refusée et journalisée', f.to('loading-model', 'x') === false && f.log.at(-1)!.reason.includes('refusée'));
  f.to('network-disconnected', 'wifi'); f.to('recovering', 'r1'); f.to('listening', 'ok');
  f.to('mic-interrupted', 'm'); f.to('recovering', 'r2'); f.to('listening', 'ok');
  f.to('mic-interrupted', 'm'); f.to('recovering', 'r3'); f.to('listening', 'ok');
  f.to('mic-interrupted', 'm'); f.to('recovering', 'r4');
  t('boucle de reprises stoppée (3 max / 60 s) → error', f.state === 'error', f.log.at(-1)!.reason);
}

console.log('\n[Tampon circulaire borné]');
{
  const r = new RingBuffer(100); r.write(new Float32Array(80).fill(1)); r.write(new Float32Array(50).fill(2));
  t('taille bornée', r.size === 100); t('débordement compté', r.dropped === 30);
  const o = r.read(100); t('lecture dans l\'ordre (les plus anciens abandonnés)', o[0] === 1 && o[99] === 2 && r.size === 0);
}

console.log('\n[Stabilisateur de transcription]');
{
  const s = new Stabilizer(2);
  const a = s.push({ text: 'الحمد لله', isFinal: false, audioStart: 0 });
  const b = s.push({ text: 'الحمد لله رب', isFinal: false, audioStart: 0 });
  const c = s.push({ text: 'الحمد لله رب العالمين', isFinal: true, audioStart: 0 });
  t('rien de validé au 1er provisoire', a.length === 0);
  t('mots communs aux 2 hypothèses validés', b.join(' ') === 'الحمد لله', b.join(' '));
  t('final valide le reste, sans doublon', c.join(' ') === 'رب العالمين', c.join(' '));
}

console.log('\n[Alignement — suivi continu avec bruit de reconnaissance]');
const passages: [string, number, number, number, string][] = [
  ['Al-Fātiḥa 1:2-7', 1, 2, 7, 'prayer'], ['Al-Ikhlāṣ 112', 112, 1, 4, 'prayer'], ['Al-Mulk 67:1-12', 67, 1, 12, 'prayer'],
  ['Yā-Sīn 36:1-20', 36, 1, 20, 'prayer'], ['Ar-Raḥmān 55:13-30 (refrain répété)', 55, 13, 30, 'prayer'], ['Al-Baqara 2:255 (Ayat al-Kursi)', 2, 255, 255, 'prayer'],
];
for (const noise of [0.10, 0.25, 0.40]) {
  let ok = 0, tot = 0, fj = 0, lockSum = 0, lockN = 0, runs = 0, startOK = 0;
  for (const [, s, a, a2, prof] of passages) for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed * 7919 + s), span = verseSpan(db, s, a, a2);
    // vérité terrain : pour chaque mot reconnu, le mot source correspondant
    const words: string[] = [], truth: number[] = [];
    for (let i = span.from; i <= span.to; i++) { const w = corrupt(db.words[i].t, r, noise); for (const x of w) { words.push(x); truth.push(i); } }
    const al = new Aligner(db, prof as 'prayer');
    const st = play(al, db, words, i => truth[i]);
    ok += st.ayahOK; tot += st.ayahTotal; fj += st.falseJumps; runs++;
    if (st.wordsToLock !== null) { lockSum += st.wordsToLock; lockN++; }
    const fin = al.push([]).position; if (fin && Math.abs(fin.index - span.to) <= 4) startOK++;
  }
  console.log(`  bruit ${Math.round(noise * 100)} % : verset correct ${pct(ok, tot)} · sauts erronés ${fj} sur ${runs} passages · verrouillage après ${(lockSum / Math.max(1, lockN)).toFixed(1)} mots · fin atteinte ${pct(startOK, runs)}`);
  if (noise === 0.10) { t('≥ 93 % de versets corrects à 10 % de bruit', ok / tot >= 0.93); t('0 saut erroné à 10 % de bruit', fj === 0, String(fj)); }
  if (noise === 0.25) { t('≥ 85 % de versets corrects à 25 % de bruit', ok / tot >= 0.85); }
}

console.log('\n[Alignement — répétition, saut, retour, nouvel emplacement]');
{
  const r = rng(42);
  const T = (s: number, a: number, a2 = a, p = 0.12) => transcribe(db, verseSpan(db, s, a, a2), r, p);
  // 1) l'imam répète un verset
  let al = new Aligner(db, 'hifz'); let ev: string[] = [];
  const feed = (w: string[]) => { for (let i = 0; i < w.length; i += 2) { const s = al.push(w.slice(i, i + 2)); s.events.forEach(e => ev.push(e.kind)); } return al.push([]); };
  const rp = feed([...T(67, 1, 2), ...T(67, 2), ...T(67, 3, 4)]);
  t('répétition de verset (11 mots) détectée en hifz', ev.includes('repeat'), [...new Set(ev)].join(','));
  t('… et la progression reprend ensuite (67:4)', !!rp.position && rp.position.surah === 67 && rp.position.ayah >= 4, rp.position ? rp.position.surah + ':' + rp.position.ayah : '-');
  // 2) mot(s) omis -> skip sans perdre le suivi
  al = new Aligner(db, 'prayer'); ev = [];
  const sp = verseSpan(db, 67, 1, 3), omit: string[] = []; for (let i = sp.from; i <= sp.to; i++) if (i % 7 !== 3) omit.push(db.words[i].t);
  let s2 = feed(omit);
  t('mots omis : position finale correcte', !!s2.position && Math.abs(s2.position.index - sp.to) <= 2 && s2.position.surah === 67, JSON.stringify(s2.position));
  // 3) transcription courte et erronée en pleine récitation : pas de saut
  al = new Aligner(db, 'prayer'); ev = [];
  feed(T(67, 1, 4, 0.05)); const before = al.push([]).position!;
  al.push(['الله', 'اكبر']); al.push(['بسم']); const after = al.push(['الله']).position!;
  t('mots parasites/courts : pas de saut', after.surah === 67 && Math.abs(after.index - before.index) <= 3, `${before.surah}:${before.ayah} → ${after.surah}:${after.ayah}`);
  // 4) vrai changement d'emplacement : récupération
  al = new Aligner(db, 'prayer'); ev = [];
  feed(T(67, 1, 5, 0.1)); const fromS = al.push([]).position!;
  const w = T(55, 13, 20, 0.1); let at = -1;
  for (let i = 0; i < w.length; i += 2) { const s = al.push(w.slice(i, i + 2)); if (s.position && s.position.surah === 55 && at < 0) at = i + 2; }
  const fin = al.push([]).position!;
  t('nouvel emplacement (67 → 55) retrouvé', fin.surah === 55 && fin.ayah >= 18, `${fromS.surah}:${fromS.ayah} → ${fin.surah}:${fin.ayah}`);
  console.log(`    temps de récupération : ${at} mots reconnus`);
  // 5) fin de sourate -> sourate suivante différente (prière : Fatiha puis autre sourate)
  al = new Aligner(db, 'prayer'); ev = [];
  const basm = ['بسم', 'الله', 'الرحمن', 'الرحيم'];
  feed([...basm, ...transcribe(db, verseSpan(db, 1, 2, 7), r, 0.08), ...transcribe(db, verseSpan(db, 112, 1, 4), r, 0.08)]);
  const f5 = al.push([]).position!;
  t('Fatiha puis Ikhlas : transition de sourate suivie', f5.surah === 112, `${f5.surah}:${f5.ayah}`);
}

console.log('\n[Vitesse]');
{
  const r = rng(5), sp = verseSpan(db, 2, 255), w = transcribe(db, sp, r, 0.2), al = new Aligner(db, 'prayer');
  const t0 = performance.now(); for (let i = 0; i < 20; i++) { al.reset(); for (let j = 0; j < w.length; j++) al.push([w[j]]); }
  const per = (performance.now() - t0) / (20 * w.length);
  t('< 5 ms par mot reconnu', per < 5, per.toFixed(2) + ' ms/mot');
}
console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);

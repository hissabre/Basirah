// Tests de la composition (Basirah), des ports, de la config et des garde-fous de licence. TOUT est simulé : moteurs de rejeu, source audio en tableau.
import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { Basirah } from '../src/app/basirah.ts';
import { ReplayEngine } from '../src/engine/replay.ts';
import type { Platform, AudioSourcePort } from '../src/platform/ports.ts';
import { openQuran, type QuranSourceDescriptor } from '../src/licensing/quran-source.ts';
import { commercialBlockers, type Inventory } from '../src/licensing/inventory.ts';
import { validateConfig, unresolved, PLACEHOLDER } from '../src/config.ts';

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
const raw = JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8'));
const q = new QuranDB(raw);
const vs: any[] = raw.verses ?? raw; const words: string[] = vs.find((v: any) => v[0] === 2 && v[1] === 255)[2].split(' ').slice(0, 12);

class ArraySource implements AudioSourcePort {
  cb: (p: Float32Array, t: number) => void = () => {}; st: (s: any, w: string) => void = () => {};
  async start() {} async stop() {} onChunk(cb: any) { this.cb = cb; } onStatus(cb: any) { this.st = cb; }
  feed(sec: number, at: number) { this.cb(new Float32Array(Math.round(16000 * sec)), at); }
}
const script = (_at: number, ws: string[]) => [4, 6, 8, 10, 12].map((n, i) => ({ at: i + 1, result: { text: ws.slice(0, n).join(' '), unit: 'text' as const, language: 'ar', audioStart: 0, audioEnd: i + 1, isFinal: i === 4, confidence: null } }));

console.log('\n[Basirah — sélection explicite, pas de bascule silencieuse]');
{
  const src = new ArraySource(); const sugg: string[] = [], errs: string[] = [];
  const off = new ReplayEngine(script(2, words), 'off'), on = new ReplayEngine([], 'on');
  const p: Platform = { audio: src, engines: { offline: async () => ({ engine: off, unit: 'text' }), online: async () => ({ engine: on, unit: 'text' }) } };
  const b = new Basirah(p, { quran: q }, { suggestion: m => sugg.push(m), error: m => errs.push(m) });
  b.setMode('prayer');
  t('aucun moteur au départ', b.activeKind === null);
  t('sélection hors ligne OK', await b.selectEngine('offline') && b.activeKind === 'offline');
  await b.start(); for (let i = 0; i < 6; i++) src.feed(1, i);
  const v1 = b.session.view();
  t('l’audio atteint le moteur actif et la position avance', !!v1.position && v1.position.surah === 2, JSON.stringify(v1.position));
  const pos = v1.position;
  t('passage en ligne explicite : position conservée', await b.selectEngine('online') && b.activeKind === 'online' && JSON.stringify(b.session.view().position) === JSON.stringify(pos));
  t('aucune suggestion ni erreur sans panne', sugg.length === 0 && errs.length === 0);
  const p2: Platform = { audio: new ArraySource(), engines: {} };
  const b2 = new Basirah(p2, { quran: q }, { error: m => errs.push(m) });
  t('moteur absent sur la plateforme → refus clair, pas de repli', !(await b2.selectEngine('online')) && errs.length === 1 && b2.activeKind === null);
  const bad: Platform = { audio: new ArraySource(), engines: { offline: async () => ({ engine: { ...off, load: async () => { throw new Error('modèle introuvable'); } } as any, unit: 'text' }) } };
  const b3 = new Basirah(bad, { quran: q }, { error: m => errs.push(m) });
  t('échec de chargement → erreur dite, aucun moteur actif', !(await b3.selectEngine('offline')) && b3.activeKind === null && /modèle introuvable/.test(errs[errs.length - 1]));
}

console.log('\n[Moteur du navigateur — la position doit avancer PENDANT les résultats provisoires]');
{
  const { WebSpeechEngine } = await import('../src/engine/webspeech.ts');
  const { Session } = await import('../src/session/session.ts');
  let inst: any; (globalThis as any).window = globalThis;
  (globalThis as any).webkitSpeechRecognition = class { constructor() { inst = this; } start() { this.onstart?.(); } stop() {} abort() {} };
  const realNow = performance.now.bind(performance); let fake = 5000; (performance as any).now = () => fake;
  const eng = new WebSpeechEngine(); const sess = new Session({ quran: q }); sess.setMode('prayer'); sess.attachEngine(eng, 'text'); await eng.load(); eng.begin();
  const w = words; let firstPosAt = -1, finals = 0;
  for (let n = 3; n <= w.length; n++) {
    fake += 400;
    inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: w.slice(0, n).join(' '), confidence: 0.9 }], { isFinal: false })] });
    if (firstPosAt < 0 && sess.view().position) firstPosAt = n;
  }
  (performance as any).now = realNow;
  t('position confirmée AVANT tout résultat final', firstPosAt > 0 && finals === 0, `dès ${firstPosAt} mots sur ${w.length}, 0 résultat final`);
}

console.log('\n[Réactivité rapide : verrouille plus tôt que la sûre]');
{
  const { Session } = await import('../src/session/session.ts');
  const lock = (fast: boolean) => { const se = new Session({ quran: q }); se.setMode('prayer'); se.setReactivity(fast); let at = -1, liveAt = -1;
    for (let n = 3; n <= words.length; n++) { se.onResult({ text: words.slice(0, n).join(' '), unit: 'text', language: 'ar', audioStart: 1, audioEnd: n * 0.4, receivedAt: 0, isFinal: false, confidence: null, engine: 'online', engineId: 'x' });
      const v = se.view(); if (at < 0 && v.position) at = n; if (liveAt < 0 && v.live) liveAt = n; } return { at, liveAt }; };
  const s = lock(false), f = lock(true);
  t('mode rapide : position confirmée au plus tard aussi tôt que le mode sûr', f.at > 0 && f.at <= s.at, `rapide ${f.at} mots · sûr ${s.at} mots`);
  t('hypothèse provisoire (live) disponible dès les premiers mots', f.liveAt > 0 && f.liveAt <= 4, `dès ${f.liveAt} mots`);
}

console.log('\n[Licences — garde-fous]');
{
  const d: QuranSourceDescriptor = { id: 'x', riwaya: 'hafs', origin: 'o', status: 'unverified', commercialOk: null, evidence: null, attribution: '' };
  t('texte non vérifié : build interne autorisé', !!openQuran(raw, d, 'internal'));
  let msg = ''; try { openQuran(raw, d, 'commercial'); } catch (e) { msg = (e as Error).message; }
  t('texte non vérifié : build commercial REFUSÉ', /non autorisée/.test(msg));
  try { openQuran(raw, { ...d, status: 'cleared', commercialOk: true, evidence: null }, 'commercial'); msg = ''; } catch (e) { msg = (e as Error).message; }
  t('« cleared » sans preuve : refusé', /non autorisée/.test(msg));
  t('cleared + commercialOk + preuve : accepté', !!openQuran(raw, { ...d, status: 'cleared', commercialOk: true, evidence: 'lettre du 2026-11-20' }, 'commercial'));
  const inv: Inventory = { components: [{ id: 'a', kind: 'k', origin: 'o', status: 'cleared', evidence: 'e', needs: ['commercial'], notes: '' }, { id: 'b', kind: 'k', origin: 'o', status: 'unverified', evidence: null, needs: ['commercial'], notes: '' }, { id: 'c', kind: 'k', origin: 'o', status: 'cleared', evidence: null, needs: ['commercial'], notes: '' }] };
  t('inventaire : bloque non vérifié et « cleared » sans preuve', commercialBlockers(inv).map(c => c.id).sort().join() === 'b,c');
}

console.log('\n[Config]');
{
  const ex = JSON.parse(readFileSync(new URL('../config/basirah.config.example.json', import.meta.url), 'utf8'));
  t('l’exemple contient des placeholders à renseigner', unresolved(ex).length > 0, unresolved(ex).slice(0, 3).join(', '));
  t('placeholder reconnu', unresolved({ a: { b: PLACEHOLDER } }).join() === 'a.b');
  const bad = JSON.parse(JSON.stringify(ex)); (bad.behaviour ??= {}).autoFallbackToOffline = true;
  t('autoFallbackToOffline=true refusé', validateConfig(bad).length > 0);
}
console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);

import { ZipformerEngine } from '../src/engine/zipformer.ts';
import type { SherpaBackend, SherpaChunkResult } from '../src/engine/sherpa.ts';
import type { RecognitionResult, RecognizerState } from '../src/types.ts';
import { assertBuild, type Permission } from '../src/licensing/gate.ts';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Faux backend : un jeton de plus à chaque bloc, fin d'énoncé tous les `every` blocs ; enregistre l'ordre et la concurrence. */
class Fake implements SherpaBackend {
  calls = 0; inflight = 0; maxInflight = 0; sizes: number[] = []; resets = 0; toks: string[] = []; failAt = -1;
  constructor(private delay = 0, private every = 0) {}
  async init() {}
  async process(pcm: Float32Array): Promise<SherpaChunkResult> {
    this.calls++; this.inflight++; this.maxInflight = Math.max(this.maxInflight, this.inflight); this.sizes.push(pcm.length);
    if (this.delay) await sleep(this.delay);
    this.inflight--;
    if (this.calls === this.failAt) throw new Error('boom');
    this.toks = [...this.toks, 'u' + this.calls];
    return { tokens: this.toks, text: '', endpoint: this.every > 0 && this.calls % this.every === 0 };
  }
  async reset() { this.resets++; this.toks = []; }
  async dispose() {}
}
const blk = (sec = 0.1) => new Float32Array(Math.round(16000 * sec));

console.log('\n[ZipformerEngine — flux, contre-pression, erreurs]');
{
  const be = new Fake(0, 4), e = new ZipformerEngine(be), res: RecognitionResult[] = [], st: string[] = [];
  e.on('result', r => res.push(r)); e.on('state', (s, w) => st.push(s + ':' + w));
  await e.load();
  for (let i = 0; i < 8; i++) e.pushAudio(blk(), i * 0.1);
  await e.flush();
  t('chaque bloc est traité tel quel (aucun regroupement)', be.calls === 8 && be.sizes.every(n => n === 1600), be.sizes.join(','));
  t('un seul traitement à la fois', be.maxInflight === 1);
  t('résultats provisoires + définitifs, unité = phonème', res.length === 8 && res.filter(r => r.isFinal).length === 2 && res.every(r => r.unit === 'phoneme' && r.tokens!.length > 0));
  t('flux remis à zéro après chaque fin d\'énoncé', be.resets === 2);
  t('audioStart reste celui du début du segment', res[0].audioStart === 0 && res[4].audioStart === 0.4, `${res[0].audioStart}, ${res[4].audioStart}`);
  t('confiance jamais inventée', res.every(r => r.confidence === null));
}
{
  const be = new Fake(30, 0), e = new ZipformerEngine(be, { maxBacklogSec: 0.5 }), st: string[] = [];
  e.on('state', (s, w) => st.push(s + ':' + w)); await e.load();
  for (let i = 0; i < 20; i++) e.pushAudio(blk(), i * 0.1); // 2 s d'audio d'un coup, traitement lent
  await e.flush();
  t('file bornée : retard excessif → blocs abandonnés ET comptés', e.droppedSec > 0 && be.calls < 20, `${e.droppedSec.toFixed(1)} s abandonnées, ${be.calls}/20 traités`);
  t('l\'abandon est signalé (jamais silencieux)', st.some(s => s.startsWith('recovering:retard de traitement')));
  t('toujours un seul traitement simultané', be.maxInflight === 1);
}
{
  const be = new Fake(); be.failAt = 3; const e = new ZipformerEngine(be), st: string[] = []; e.on('state', (s, w) => st.push(s + ':' + w)); await e.load();
  for (let i = 0; i < 6; i++) e.pushAudio(blk(), i * 0.1); await e.flush();
  t('erreur backend → état error, aucune relance automatique', st.some(s => s.startsWith('error:erreur du moteur')) && be.calls === 3, `${be.calls} appels`);
}
{
  const bad: SherpaBackend = { async init() { throw new Error('modèle absent'); }, async process() { throw 0; }, async reset() {}, async dispose() {} };
  const e = new ZipformerEngine(bad), st: string[] = []; e.on('state', s => st.push(s));
  let thrown = false; try { await e.load(); } catch { thrown = true; }
  t('échec de chargement signalé', thrown && st.includes('error'));
}

console.log('\n[Garde-fou de licences]');
{
  const p: Permission = JSON.parse(readFileSync(new URL('../permissions/quranlab-zipformer.json', import.meta.url), 'utf8'));
  const c = assertBuild('commercial', [p]);
  t('construction commerciale REFUSÉE tant que la permission n\'est pas enregistrée', c.length > 0, c[0]);
  const ok: Permission = { ...p, evidence: 'courriel Quran-Lab (réf. fictive de test)', grants: { ...p.grants, 'commercial-use': true, 'redistribution-weights': true } };
  t('autorisée quand usage commercial + redistribution des poids sont explicitement accordés', assertBuild('commercial', [ok]).length === 0);
  t('un droit non mentionné reste « non confirmé »', assertBuild('commercial', [{ ...ok, grants: { ...ok.grants, 'redistribution-weights': null } }]).length === 1);
}
console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);

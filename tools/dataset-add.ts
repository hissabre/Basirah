/**
 * Ajoute un enregistrement au manifeste, en validant tout et en n'autorisant que ce que la licence permet.
 *   npm run dataset:add -- --manifest dataset/manifest.json --id mulk-001 --audio reciterA/mulk.wav --reciter "Nom" --riwaya hafs \
 *       --surah 67 --from 1 --to 12 --env home --noise clean --speed medium --style murattal \
 *       --licence own --licence-name "enregistrement propre" --evidence "accord écrit du 2026-11-20" [--eval yes] [--train no] [--source youtube --url …] [--times times.json]
 * Sans --evidence, AUCUN usage n'est autorisé (internal-evaluation = null). Les liens YouTube sont enregistrés mais l'audio n'est jamais téléchargé ici.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { validate, type Manifest, type Recording } from '../src/eval/manifest.ts';
const a = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const req = (k: string) => { const v = a(k); if (!v) { console.error(`--${k} requis`); process.exit(2); } return v; };
const mp = req('manifest');
const man: Manifest = existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf8')) : { version: 1, name: 'manifest', recordings: [] };
const q = new QuranDB(JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
const ev = a('evidence') ?? null, lic = req('licence') as Recording['licence']['status'];
const yes = (k: string) => (ev && a(k) === 'yes') ? true : (a(k) === 'no' ? false : null);
const times = a('times') ? JSON.parse(readFileSync(a('times')!, 'utf8')).ayahTimes : undefined;
const rec: Recording = {
  id: req('id'), audio: req('audio'), durationSec: a('duration') ? +a('duration')! : null,
  source: { type: (a('source') ?? 'own') as any, url: a('url') },
  reciter: { id: req('reciter').toLowerCase().replace(/\s+/g, '-'), name: req('reciter') }, riwaya: req('riwaya') as any,
  reference: { segments: [{ kind: 'quran', surah: +req('surah'), ayahFrom: +req('from'), ayahTo: +req('to'), ayahTimes: times }] },
  licence: { status: lic, name: a('licence-name') ?? lic, evidence: ev, uses: { 'internal-evaluation': yes('eval'), training: yes('train'), redistribution: yes('redistribute'), commercial: yes('commercial') } },
  conditions: { environment: req('env') as any, noise: req('noise') as any, speed: req('speed') as any, style: (a('style') ?? 'murattal') as any, mic: a('mic'), reverb: a('reverb') as any }, split: (a('split') ?? 'test') as any,
};
man.recordings = man.recordings.filter(r => r.id !== rec.id).concat(rec);
const errs = validate(man, q); if (errs.length) { console.error('Refusé :\n' + errs.join('\n')); process.exit(1); }
writeFileSync(mp, JSON.stringify(man, null, 2));
console.log(`ajouté : ${rec.id} · évaluation interne = ${rec.licence.uses['internal-evaluation']} · entraînement = ${rec.licence.uses.training} · commercial = ${rec.licence.uses.commercial}`);

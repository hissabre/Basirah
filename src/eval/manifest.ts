/**
 * Structure du jeu de données d'évaluation. Un enregistrement n'est utilisable pour un USAGE donné que si sa licence
 * l'autorise explicitement (`true`). `null` = non confirmé = NON. Les fichiers audio ne sont jamais dans le dépôt.
 */
export type Riwaya = 'hafs' | 'warsh';
export type SourceType = 'own' | 'youtube' | 'everyayah' | 'quranlab-benchmark' | 'archive' | 'other';
export type Environment = 'studio' | 'home' | 'mosque' | 'phone-mic' | 'broadcast';
export type Noise = 'clean' | 'light' | 'moderate' | 'heavy';
export type Purpose = 'internal-evaluation' | 'training' | 'redistribution' | 'commercial';

export interface LicenceInfo {
  status: 'own' | 'permission-granted' | 'open-licence' | 'research-gated' | 'platform-terms-only' | 'unverified' | 'denied';
  name: string;              // ex. "CC-BY-4.0", "Quran-Lab NPL-1.2", "accord écrit du récitant"
  evidence: string | null;   // référence : courriel, URL de la licence, accord ; JAMAIS le contenu
  uses: Record<Purpose, boolean | null>;
}
export interface RefSegment {
  kind: 'quran' | 'non-quran' | 'silence';
  startSec?: number; endSec?: number;
  surah?: number; ayahFrom?: number; ayahTo?: number;
  /** Heures par verset (obtenues par alignement forcé ou annotation) : requises pour mesurer le suivi. */
  ayahTimes?: { surah: number; ayah: number; startSec: number; endSec: number }[];
}
export interface Recording {
  id: string;
  audio: string;             // chemin relatif au dossier d'audio local (hors dépôt)
  durationSec: number | null;
  source: { type: SourceType; url?: string; retrievedAt?: string; note?: string };
  reciter: { id: string; name: string };
  riwaya: Riwaya;
  reference: { segments: RefSegment[] };
  licence: LicenceInfo;
  conditions: { environment: Environment; noise: Noise; reverb?: 'low' | 'medium' | 'high'; speed: 'slow' | 'medium' | 'fast'; style: 'murattal' | 'mujawwad' | 'hadr' | 'taraweeh-imam' | 'other'; mic?: string };
  split: 'dev' | 'test';
}
export interface Manifest { version: 1; name: string; recordings: Recording[] }

export function can(r: Recording, use: Purpose): { ok: boolean; why: string } {
  if (r.licence.status === 'denied') return { ok: false, why: 'licence refusée' };
  if (!r.licence.evidence) return { ok: false, why: 'aucune preuve de licence enregistrée' };
  const g = r.licence.uses[use];
  return g === true ? { ok: true, why: r.licence.name } : { ok: false, why: `« ${use} » ${g === false ? 'refusé' : 'non confirmé'} (${r.licence.name})` };
}

export function validate(m: Manifest, quran?: { verses: { s: number; a: number }[] }): string[] {
  const e: string[] = [], ids = new Set<string>();
  if (m.version !== 1) e.push('version de manifeste inconnue');
  for (const r of m.recordings) {
    const p = `[${r.id}] `;
    if (ids.has(r.id)) e.push(p + 'identifiant en double'); ids.add(r.id);
    if (!r.audio) e.push(p + 'chemin audio manquant');
    if (!r.reciter?.id) e.push(p + 'récitant non identifié');
    if (!['hafs', 'warsh'].includes(r.riwaya)) e.push(p + 'riwaya invalide');
    if (!r.licence?.status || !r.licence.name) e.push(p + 'licence incomplète');
    if (r.licence?.status === 'platform-terms-only' && r.licence.uses?.['internal-evaluation'] === true && !r.licence.evidence) e.push(p + 'usage interne marqué autorisé sans preuve');
    if (!r.reference?.segments?.length) e.push(p + 'référence absente');
    for (const s of r.reference?.segments ?? []) {
      if (s.kind !== 'quran') continue;
      if (!s.surah || !s.ayahFrom || !s.ayahTo || s.ayahTo < s.ayahFrom) e.push(p + 'segment coranique : références invalides');
      else if (quran && !(quran.verses.some(v => v.s === s.surah && v.a === s.ayahFrom) && quran.verses.some(v => v.s === s.surah && v.a === s.ayahTo))) e.push(p + `référence inexistante ${s.surah}:${s.ayahFrom}-${s.ayahTo}`);
    }
    if (!r.conditions?.environment || !r.conditions.noise) e.push(p + 'conditions d\'enregistrement incomplètes');
  }
  return e;
}

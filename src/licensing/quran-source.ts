import { QuranDB, type RawQuran } from '../quran/db.ts';
export interface QuranSourceDescriptor { id: string; riwaya: 'hafs' | 'warsh'; origin: string; status: 'cleared' | 'unverified' | 'blocked'; commercialOk: boolean | null; evidence: string | null; attribution: string; notes?: string }
/** Ouvre la base du Coran en refusant une construction commerciale si la source n'est pas explicitement autorisée par écrit. */
export function openQuran(raw: RawQuran, src: QuranSourceDescriptor, build: 'internal' | 'commercial'): QuranDB {
  if (build === 'commercial' && !(src.status === 'cleared' && src.commercialOk === true && src.evidence)) {
    throw new Error(`Source du texte « ${src.id} » non autorisée pour une construction commerciale (statut ${src.status}, commercialOk=${src.commercialOk}, preuve=${src.evidence ?? 'aucune'}).`);
  }
  if (src.riwaya !== raw.riwaya) throw new Error(`Riwaya incohérente : source ${src.riwaya}, données ${raw.riwaya}`);
  return new QuranDB(raw);
}

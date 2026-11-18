import { norm } from '../quran/normalize.ts';
import type { RecognitionResult } from '../types.ts';

/**
 * Transforme les résultats provisoires/définitifs d'un moteur en flux de mots « confirmés » en ajout seul
 * (principe « local agreement » : un mot est validé quand deux hypothèses successives s'accordent dessus).
 * Évite d'afficher des mots instables et rend l'alignement indépendant du moteur.
 */
export class Stabilizer {
  private prev: string[] = [];
  private committed = 0; // nb de mots déjà émis pour le segment courant
  private segKey = '';
  /** `fast` : on valide tous les mots sauf le DERNIER de l'hypothèse (le plus instable) sans attendre un second résultat : plus réactif, un peu moins sûr. */
  constructor(private readonly agree = 2, private readonly fast = false) {}

  /** Retourne les NOUVEAUX mots confirmés par ce résultat. */
  push(r: Pick<RecognitionResult, 'text' | 'isFinal' | 'audioStart'> & { tokens?: string[]; unit?: 'text' | 'phoneme' }): string[] {
    const key = String(r.audioStart);
    if (key !== this.segKey) { this.segKey = key; this.prev = []; this.committed = 0; }
    const cur = r.unit === 'phoneme' && r.tokens ? r.tokens : norm(r.text).split(' ').filter(Boolean);
    let upto: number;
    if (r.isFinal) upto = cur.length;
    else if (this.fast) upto = Math.max(this.committed, cur.length - 1);
    else { let m = 0; while (m < cur.length && m < this.prev.length && cur[m] === this.prev[m]) m++; upto = this.agree <= 1 ? cur.length : m; }
    const out = upto > this.committed ? cur.slice(this.committed, upto) : [];
    if (upto > this.committed) this.committed = upto;
    this.prev = r.isFinal ? [] : cur;
    if (r.isFinal) { this.segKey = ''; this.committed = 0; }
    return out;
  }
  reset() { this.prev = []; this.committed = 0; this.segKey = ''; }
}

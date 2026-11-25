/**
 * LOCALISATION DANS LE CORAN À PARTIR DES LETTRES ENTENDUES.
 *
 * 1. Lettres : à chaque image CTC (≈ 40 ms), une lettre est « entendue » dès que son pic dépasse le blanc (ou 35 %).
 * 2. Suivi local : à chaque lettre, les K dernières lettres entendues sont alignées (distance d'édition, début libre) sur le texte
 *    autour de la position courante → nouvelle position, coût = nombre d'erreurs.
 * 3. Recherche globale : les 7 (sinon 5) dernières lettres sont cherchées dans tout le Coran (index), chaque endroit candidat est
 *    noté de la même façon. On ne quitte le passage suivi que si un autre endroit explique NETTEMENT mieux les mêmes lettres,
 *    deux lettres de suite (pas de saut sur une seule erreur).
 * 4. Verrouillage (position confirmée) : au moins 8 lettres, ≤ 25 % d'erreurs, et aucun autre endroit à moins de 3 erreurs près
 *    (la basmala, présente 113 fois, n'est donc jamais confirmée seule).
 * Aucune mémoire qui s'efface avec le temps : la décision repose sur les lettres, pas sur l'horloge.
 */
export interface LocatorOptions {
  /** Lettres prises en compte pour noter un endroit. */ K?: number;
  /** Lettres minimales avant de confirmer. */ minLetters?: number;
  /** Proportion d'erreurs maximale pour confirmer. */ maxErr?: number;
  /** Avance d'un autre endroit nécessaire (en erreurs) pour confirmer / pour sauter. */ margin?: number; jumpMargin?: number;
  /** Seuil de détection d'une lettre (probabilité), en plus de « dépasse le blanc ». */ peak?: number;
  /** Bande de suivi local (lettres en arrière / en avant). */ back?: number; fwd?: number;
}
export interface LocatorOut { index: number; locked: boolean; cost: number; margin: number; letters: number; jumped: boolean }

export class LetterLocator {
  readonly o: Required<LocatorOptions>;
  private H: number[] = []; private lastEmit = -1; private sawBlank = true;
  private p = -1; private locked = false; private hinted = false; private jumpVotes: { at: number; n: number } | null = null;
  private idx7 = new Map<number, number[]>(); private idx5 = new Map<number, number[]>();
  private conf: Int8Array;
  letters = 0; jumps = 0;
  constructor(private ids: Int32Array, private blank: number, vocabSize: number, confGroups: number[][] = [], o: LocatorOptions = {}) {
    this.o = { K: 24, minLetters: 8, maxErr: 0.25, margin: 3, jumpMargin: 3, peak: 0.35, back: 12, fwd: 45, ...o };
    for (let i = 0; i < ids.length; i++) { const k7 = this.key(i, 7); if (k7 >= 0) push(this.idx7, k7, i); const k5 = this.key(i, 5); if (k5 >= 0) push(this.idx5, k5, i); }
    this.conf = new Int8Array(vocabSize * vocabSize);
    for (const g of confGroups) for (const a of g) for (const b of g) if (a !== b) this.conf[a * vocabSize + b] = 1;
    this.V = vocabSize;
  }
  private V: number;
  private key(end: number, n: number, src: ArrayLike<number> = this.ids): number {
    if (end - n + 1 < 0) return -1; let k = 0;
    for (let j = end - n + 1; j <= end; j++) { const v = src[j]; if (v < 0) return -1; k = k * 37 + v; }
    return k;
  }
  reset() { this.H = []; this.lastEmit = -1; this.sawBlank = true; this.p = -1; this.locked = false; this.hinted = false; this.jumpVotes = null; }
  /** Départ connu : la prochaine lettre attendue est `index`. */
  startAt(index: number) { this.reset(); this.p = index - 1; this.locked = true; this.hinted = true; }
  get position() { return this.p; }

  /** Une image CTC (log-probabilités). Renvoie un résultat seulement quand une nouvelle lettre a été entendue. */
  push(lp: Float32Array): LocatorOut | null {
    let b = -1, mb = -Infinity; for (let v = 0; v < lp.length; v++) if (v !== this.blank && lp[v] > mb) { mb = lp[v]; b = v; }
    const lb = lp[this.blank];
    if (!(mb > lb || mb > Math.log(this.o.peak))) { if (lb > Math.log(0.5)) this.sawBlank = true; return null; }
    if (b === this.lastEmit && !this.sawBlank) return null;
    this.lastEmit = b; this.sawBlank = false; this.H.push(b); this.letters++; if (this.H.length > 64) this.H.shift();
    return this.step();
  }
  /** Ajoute directement une lettre (tests). */
  pushLetter(id: number) { this.H.push(id); this.letters++; if (this.H.length > 64) this.H.shift(); return this.step(); }

  private sub(a: number, b: number) { return a === b || b < 0 ? 0 : this.conf[a * this.V + b] ? 0.5 : 1; }
  /**
   * Distance d'édition des L dernières lettres entendues contre le texte, fin d'alignement dans [e0, e1], début libre.
   * Renvoie la meilleure fin (à égalité : la plus proche de `pref`) et son coût.
   */
  private align(L: number, e0: number, e1: number, pref: number): { e: number; c: number } {
    const H = this.H, h0 = H.length - L, s0 = Math.max(0, e0 - L - 8), n = e1 - s0 + 1, ids = this.ids;
    if (n <= 0) return { e: -1, c: Infinity };
    let prev = new Float32Array(n + 1), cur = new Float32Array(n + 1); // prev[j] : coût avec texte se terminant à s0+j-1 (j=0 : vide)
    for (let i = 1; i <= L; i++) {
      cur[0] = i; const h = H[h0 + i - 1];
      for (let j = 1; j <= n; j++) { const t = ids[s0 + j - 1]; let c = prev[j - 1] + this.sub(h, t); const ins = prev[j] + 1; if (ins < c) c = ins; const del = cur[j - 1] + 1; if (del < c) c = del; cur[j] = c; }
      const x = prev; prev = cur; cur = x;
    }
    let be = -1, bc = Infinity;
    for (let e = Math.max(e0, s0); e <= e1; e++) { const c = prev[e - s0 + 1]; if (c < bc - 1e-6 || (Math.abs(c - bc) < 1e-6 && Math.abs(e - pref) < Math.abs(be - pref))) { bc = c; be = e; } }
    return { e: be, c: bc };
  }
  private candidates(): number[] {
    const H = this.H, out = new Set<number>();
    for (const [n, idx] of [[7, this.idx7], [5, this.idx5]] as [number, Map<number, number[]>][]) {
      for (const skip of [0, 1]) { // aussi sans la dernière lettre (si elle est fausse)
        if (H.length - skip < n) continue; const k = this.key(H.length - 1 - skip, n, H); const l = idx.get(k); if (!l) continue;
        if (l.length > 400) continue; for (const e of l) out.add(e + skip);
      }
      if (out.size) break;
    }
    return [...out];
  }
  private step(): LocatorOut {
    const o = this.o, L = Math.min(o.K, this.H.length), N = this.ids.length;
    // 1) suivi local
    let local: { e: number; c: number } | null = null;
    if (this.p >= -1 && (this.locked || this.p >= 0)) local = this.align(L, Math.max(0, this.p - o.back), Math.min(N - 1, this.p + o.fwd), this.p + 1);
    // 2) autres endroits
    const cands = this.candidates(); let g1 = { e: -1, c: Infinity }, g2c = Infinity;
    const scored: { e: number; c: number }[] = [];
    for (const c of cands) { if (local && local.e >= 0 && Math.abs(c - local.e) <= o.fwd) continue; const r = this.align(L, Math.max(0, c - 2), Math.min(N - 1, c + 2), c); if (r.e >= 0) scored.push(r); }
    scored.sort((a, b) => a.c - b.c);
    // endroits distincts (à plus de 30 lettres les uns des autres)
    const distinct: { e: number; c: number }[] = []; for (const r of scored) if (!distinct.some(d => Math.abs(d.e - r.e) < 30)) distinct.push(r);
    if (distinct[0]) g1 = distinct[0]; if (distinct[1]) g2c = distinct[1].c;
    let jumped = false;
    if (this.locked && local && local.e >= 0) {
      // suivi : on reste, sauf si un autre endroit explique nettement mieux (2 lettres de suite)
      if (g1.e >= 0 && g1.c + o.jumpMargin <= local.c && g1.c <= o.maxErr * L && L >= o.minLetters) {
        const v = this.jumpVotes && Math.abs(this.jumpVotes.at - g1.e) <= 2 ? this.jumpVotes.n + 1 : 1; this.jumpVotes = { at: g1.e, n: v };
        if (v >= 2 && g1.c + o.margin <= g2c) { this.p = g1.e; this.jumps++; jumped = true; this.jumpVotes = null; this.hinted = false; return { index: this.p, locked: true, cost: g1.c, margin: local.c - g1.c, letters: L, jumped }; }
      } else this.jumpVotes = null;
      this.p = local.e;
      const rival = Math.min(g1.c, g2c), margin = rival - local.c;
      // un départ connu (Hifz) reste confirmé tant que le passage s'explique raisonnablement ; sinon on perd le verrou si l'erreur explose
      if (!this.hinted && L >= o.minLetters && local.c > 0.5 * L) this.locked = false;
      if (this.hinted && L >= o.minLetters && local.c > 0.5 * L) { this.hinted = false; this.locked = false; }
      return { index: this.p, locked: this.locked, cost: local.c, margin, letters: L, jumped };
    }
    // 3) recherche : meilleur endroit (local ou global)
    const all = [...(local && local.e >= 0 ? [local] : []), ...distinct].sort((a, b) => a.c - b.c);
    if (!all.length) return { index: this.p, locked: false, cost: Infinity, margin: 0, letters: L, jumped };
    const best = all[0], second = all.find(r => Math.abs(r.e - best.e) >= 30)?.c ?? Infinity;
    this.p = best.e;
    if (L >= o.minLetters && best.c <= o.maxErr * L && second - best.c >= o.margin) { this.locked = true; jumped = true; }
    return { index: this.p, locked: this.locked, cost: best.c, margin: second - best.c, letters: L, jumped };
  }
}
function push(m: Map<number, number[]>, k: number, v: number) { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); }

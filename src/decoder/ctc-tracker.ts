/**
 * SUIVI CONTRAINT PAR LE TEXTE DU CORAN, image par image (modèle-agnostique).
 *
 * Entrée : les log-probabilités CTC d'UNE image (toutes les 20–80 ms selon le modèle) sur un vocabulaire d'unités + « blanc ».
 * Sortie : l'indice de l'unité du Coran où en est le récitant — mise à jour à CHAQUE image, sans fenêtre ni attente de mot complet.
 *
 * Principe : le texte est connu → au lieu de décoder du texte libre, on suit un chemin dans le graphe du Coran
 * (rester / avancer d'une unité / sauter une unité) en notant chaque image avec la probabilité du modèle.
 * Quelques hypothèses sont suivies en parallèle ; une nouvelle hypothèse est semée quand les dernières unités
 * « vues » par le modèle (meilleure sortie brute) correspondent à un n-gramme du Coran (début à froid, saut de verset, reprise).
 *
 * Ne dépend d'aucun modèle : il suffit d'une table `unité → identifiant` (voir buildTokenCorpus).
 * ÉTAT : validé UNIQUEMENT sur des sorties de modèle SIMULÉES (test/run-ctc.ts). Jamais exécuté sur un vrai modèle.
 */

export interface TokenCorpus {
  /** Identifiant d'unité pour chaque position du corpus ; -1 = unité inconnue du modèle (joker). */
  ids: Int32Array;
  blank: number;
  vocabSize: number;
  /** Index de n-grammes (identifiants joints) → positions de FIN dans le corpus. */
  ngram: Map<string, number[]>;
  n: number;
}

export function buildTokenCorpus(units: { t: string }[], vocab: Map<string, number>, blank: number, vocabSize: number, n = 4): TokenCorpus {
  const ids = new Int32Array(units.length);
  for (let i = 0; i < units.length; i++) ids[i] = vocab.get(units[i].t) ?? -1;
  const ngram = new Map<string, number[]>();
  for (let i = n - 1; i < ids.length; i++) {
    let key = '', ok = true;
    for (let k = i - n + 1; k <= i; k++) { if (ids[k] < 0) { ok = false; break; } key += ids[k] + ','; }
    if (!ok) continue;
    const l = ngram.get(key); if (l) l.push(i); else ngram.set(key, [i]);
  }
  return { ids, blank, vocabSize, ngram, n };
}

export interface TrackerOptions {
  /** Oubli exponentiel du score par image (0.96 ≈ mémoire de ~25 images). */
  decay?: number; beam?: number;
  skipPenalty?: number; insPenalty?: number; subPenalty?: number; seedPenalty?: number; /** Coût d'une semence globale quand on suit déjà un passage (plus élevé : évite de douter à chaque unité). */ seedPenaltyTracked?: number;
  /** Plancher du log-proba (une image aberrante ne tue pas une hypothèse). */
  floor?: number;
  lockMargin?: number; lockAdvances?: number; maxSeeds?: number;
  /** Bande locale autour de la meilleure hypothèse : coût d'un saut et étendue (unités en arrière / en avant). */
  bandPenalty?: number; /** Coût maximal d'une avance sans pic net (tolère les pics faibles : modèle peu confiant). -Infinity = désactivé. */ advFloor?: number; localBack?: number; localFwd?: number;
}
export interface TrackerOutput {
  /** Dernière unité du corpus que le récitant est jugé avoir prononcée. */
  index: number;
  /** Écart de score avec la meilleure hypothèse située ailleurs (Infinity = aucune concurrente). */
  margin: number;
  locked: boolean;
  hyps: number;
  tSec: number;
}
interface Hyp { i: number; ab: boolean; s: number; adv: number; hinted: boolean }

export class CtcTracker {
  private hyps: Hyp[] = [];
  private greedy: number[] = []; private lastArg = -1;
  private readonly o: Required<TrackerOptions>;
  /** Compteurs pour le diagnostic. */
  frames = 0; seeds = 0;
  constructor(private readonly c: TokenCorpus, o: TrackerOptions = {}) {
    this.o = { decay: 0.96, beam: 64, skipPenalty: -1.8, insPenalty: -2, subPenalty: -1.5, seedPenalty: 1.0, seedPenaltyTracked: 1.0, bandPenalty: 2.5, advFloor: -0.6, localBack: 6, localFwd: 30, floor: Math.log(1e-3), lockMargin: 2, lockAdvances: 3, maxSeeds: 6, ...o };
  }
  reset() { this.hyps = []; this.greedy = []; this.lastArg = -1; }
  /** Départ connu (mode Hifz, sourate choisie…) : la première unité à prononcer est `index`. */
  startAt(index: number) { this.reset(); this.hyps.push({ i: index - 1, ab: true, s: 0, adv: 0, hinted: true }); }

  push(lp: Float32Array, tSec: number): TrackerOutput | null {
    const { c, o } = this, fl = o.floor; this.frames++;
    const L = (v: number) => (v < 0 ? -2.5 : Math.max(fl, lp[v]));
    let arg = 0, mx = -Infinity;
    for (let v = 0; v < c.vocabSize; v++) if (v !== c.blank && lp[v] > mx) { mx = lp[v]; arg = v; }
    const lb = Math.max(fl, lp[c.blank]);
    const best = new Map<number, Hyp>();
    const put = (h: Hyp) => { const k = h.i * 2 + (h.ab ? 1 : 0), p = best.get(k); if (!p || h.s > p.s) best.set(k, h); };
    for (const h of this.hyps) {
      const base = h.s * o.decay;
      // rester : blanc, répétition de l'unité courante (repli CTC), ou insertion parasite
      const cur = h.i >= 0 ? c.ids[h.i] : -2;
      let stay = lb, ab = true;
      if (cur >= 0 && lp[cur] > stay) { stay = Math.max(fl, lp[cur]); ab = false; }
      const ins = mx + o.insPenalty; if (ins > stay) { stay = Math.max(fl, ins); ab = false; }
      put({ i: h.i, ab, s: base + stay, adv: h.adv, hinted: h.hinted });
      // avancer d'une unité (une unité identique à la précédente exige un blanc entre les deux)
      const j = h.i + 1;
      if (j < c.ids.length && (h.ab || c.ids[j] !== cur || cur < 0)) put({ i: j, ab: false, s: base + Math.max(L(c.ids[j]), Math.max(fl, mx + o.subPenalty), lb + o.advFloor), adv: h.adv + 1, hinted: h.hinted });
      // sauter une unité (le modèle l'a manquée)
      const j2 = h.i + 2;
      if (j2 < c.ids.length) put({ i: j2, ab: false, s: base + L(c.ids[j2]) + o.skipPenalty, adv: h.adv + 1, hinted: h.hinted });
    }
    let hs = [...best.values()];
    // semis : le modèle vient de « voir » une nouvelle unité → chercher les derniers n unités dans le Coran
    const seen = mx > Math.log(0.4) && mx > lb ? arg : -1, fresh = seen >= 0 && seen !== this.lastArg; this.lastArg = seen;
    if (fresh) {
      this.greedy.push(seen); if (this.greedy.length > 32) this.greedy.shift();
      const G = this.greedy, top0 = hs.length ? hs.reduce((a, b) => (b.s > a.s ? b : a)) : null;
      // bande locale : toute unité proche de la meilleure hypothèse devient candidate (à un coût de saut fixe) → récupération après une erreur du modèle
      if (top0) {
        const lo = Math.max(0, top0.i - o.localBack), hi = Math.min(c.ids.length - 1, top0.i + o.localFwd), have = new Set(hs.map(h => h.i));
        for (let e = lo; e <= hi; e++) if (!have.has(e)) hs.push({ i: e, ab: false, s: top0.s - o.bandPenalty, adv: top0.adv, hinted: top0.hinted });
      }
      // recherche globale : les derniers n unités vues, n'importe où dans le Coran (début à froid, saut de verset)
      if (G.length >= c.n) {
        let key = ''; for (let k = G.length - c.n; k < G.length; k++) key += G[k] + ',';
        const cand = c.ngram.get(key);
        if (cand) {
          const ref = top0 ? top0.s : 0, near = top0 ? top0.i : 0;
          // départage : les candidats dont le passé (jusqu'à 16 unités vues) concorde le mieux, puis les plus proches de la position actuelle
          const back = Math.min(16, G.length), ov = (e: number) => { let m = 0; for (let k = 1; k <= back; k++) { const p = e - k + 1; if (p >= 0 && c.ids[p] === G[G.length - k]) m++; } return m; };
          const sorted = cand.length > o.maxSeeds
            ? cand.slice(0, 600).map(e => ({ e, m: ov(e) })).sort((a, b) => b.m - a.m || Math.abs(a.e - near) - Math.abs(b.e - near)).slice(0, o.maxSeeds).map(x => x.e)
            : cand;
          for (const e of sorted) if (!hs.some(h => Math.abs(h.i - e) <= 1)) { hs.push({ i: e, ab: false, s: ref - (top0 && top0.adv >= o.lockAdvances ? o.seedPenaltyTracked : o.seedPenalty), adv: 0, hinted: false }); this.seeds++; }
        }
      }
    }
    if (!hs.length) { this.hyps = []; return null; }
    hs.sort((a, b) => b.s - a.s); if (hs.length > o.beam) hs.length = o.beam;
    this.hyps = hs;
    const t = hs[0], rival = hs.find(h => h.i < t.i - o.localBack - 1 || h.i > t.i + o.localFwd + 1); // hors de la bande locale : un autre endroit du Coran
    const margin = rival ? t.s - rival.s : Infinity;
    return { index: t.i, margin, locked: (t.hinted || t.adv >= o.lockAdvances) && margin >= o.lockMargin, hyps: hs.length, tSec };
  }
}

/** log-softmax d'un vecteur de scores (utilitaire pour les modèles qui rendent des logits). */
export function logSoftmax(logits: ArrayLike<number>, out = new Float32Array(logits.length)): Float32Array {
  let m = -Infinity; for (let i = 0; i < logits.length; i++) if (logits[i] > m) m = logits[i];
  let s = 0; for (let i = 0; i < logits.length; i++) s += Math.exp(logits[i] - m);
  const l = m + Math.log(s); for (let i = 0; i < logits.length; i++) out[i] = logits[i] - l;
  return out;
}

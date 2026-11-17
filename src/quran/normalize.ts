/**
 * Normalisation arabe POUR LA COMPARAISON UNIQUEMENT.
 * Le texte affiché reste toujours le texte original, jamais modifié.
 */
export const norm = (s: string): string =>
  s.replace(/[ً-ٰٟۖ-ۭـ]/g, '') // voyelles, signes coraniques, tatwil
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ء/g, '')
    .replace(/[^ء-ي\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Paires de lettres que les moteurs de reconnaissance confondent le plus souvent (coût de substitution réduit). */
const CONF: Record<string, string> = {};
for (const g of ['سثص', 'ذزظض', 'تط', 'كق', 'حهخ', 'عغ', 'دض']) for (const a of g) CONF[a] = g;
const sub = (a: string, b: string) => (a === b ? 0 : CONF[a] && CONF[a] === CONF[b] ? 0.45 : 1);

/** Similarité 0..1 = 1 − distance d'édition pondérée / longueur max. */
export function sim(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let p = new Float32Array(n + 1);
  for (let j = 0; j <= n; j++) p[j] = j;
  for (let i = 1; i <= m; i++) {
    const c = new Float32Array(n + 1);
    c[0] = i;
    for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + sub(a[i - 1], b[j - 1]));
    p = c;
  }
  return 1 - p[n] / Math.max(m, n);
}

/** Squelette consonantique : sert de clé d'index tolérante aux confusions de lettres et aux voyelles longues. */
export function skeleton(w: string): string {
  let o = '';
  for (const ch of w) {
    if (ch === 'ا' || ch === 'و' || ch === 'ي') continue;
    const g = CONF[ch];
    o += g ? g[0] : ch;
  }
  return o || w;
}

/**
 * Garde-fou de licences : une construction « commerciale » refuse d'embarquer un composant dont la permission écrite
 * n'est pas enregistrée pour l'usage demandé. Les valeurs `null` signifient « non confirmé » : elles comptent comme NON.
 */
export type Use = 'internal-evaluation' | 'commercial-use' | 'modification-finetuning' | 'redistribution-weights' | 'derivative-works';
export interface Permission {
  component: string; grantor: string;
  /** Référence (pas le contenu) du document : courriel, accord, date. */
  evidence: string | null;
  grants: Record<Use, boolean | null>;
  conditions: string[];
}
export function allowed(p: Permission, use: Use): { ok: boolean; why: string } {
  if (!p.evidence) return { ok: false, why: `${p.component} : aucune preuve écrite enregistrée` };
  const g = p.grants[use];
  if (g === true) return { ok: true, why: 'autorisé par ' + p.evidence };
  return { ok: false, why: `${p.component} : « ${use} » ${g === false ? 'refusé' : 'non confirmé'}` };
}
export function assertBuild(kind: 'internal' | 'commercial', perms: Permission[]): string[] {
  const need: Use[] = kind === 'commercial' ? ['commercial-use', 'redistribution-weights'] : ['internal-evaluation'];
  return perms.flatMap(p => need.map(u => allowed(p, u)).filter(r => !r.ok).map(r => r.why));
}

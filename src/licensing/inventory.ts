export interface Component { id: string; kind: string; origin: string; status: 'cleared' | 'unverified' | 'blocked'; evidence: string | null; needs: string[]; notes: string }
export interface Inventory { components: Component[] }
/** Composants qui bloquent une construction commerciale : tout ce qui n'est pas « cleared » AVEC preuve. */
export function commercialBlockers(inv: Inventory): Component[] {
  return inv.components.filter(c => c.needs.includes('commercial') || c.needs.includes('embedded-redistribution') || c.needs.includes('redistribution-weights'))
    .filter(c => !(c.status === 'cleared' && c.evidence));
}

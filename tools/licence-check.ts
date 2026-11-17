// npm run licence:check -- [--build commercial]  → liste les composants qui bloquent la construction ; code de sortie 1 s'il y en a.
import { readFileSync } from 'node:fs';
import { commercialBlockers, type Inventory } from '../src/licensing/inventory.ts';
const inv: Inventory = JSON.parse(readFileSync(new URL('../licensing/inventory.json', import.meta.url), 'utf8'));
const commercial = process.argv.includes('commercial');
if (!commercial) { console.log('Construction interne : aucun contrôle bloquant (les licences restent à régler avant tout usage commercial).'); process.exit(0); }
const b = commercialBlockers(inv);
console.log(b.length ? `CONSTRUCTION COMMERCIALE REFUSÉE — ${b.length} composant(s) non réglé(s) :\n` + b.map(c => `  ✗ ${c.id} (${c.kind}) : ${c.status}${c.evidence ? '' : ', aucune preuve'} — ${c.notes}`).join('\n') : 'Tous les composants sont réglés (preuve enregistrée).');
process.exit(b.length ? 1 : 0);

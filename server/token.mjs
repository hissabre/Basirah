// node server/token.mjs [secondes]  → imprime un jeton court pour tester le relais (RELAY_SECRET requis)
import { mintToken } from './relay.mjs'; console.log(mintToken(+(process.argv[2] ?? 3600)));

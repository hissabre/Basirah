// Vérification RÉELLE dans Chrome (GitHub Actions) : vraie page Basirah, vrai modèle, vraies récitations EveryAyah,
// via le banc d'essai de l'application. Usage : node tools/verify-engine.mjs <dossier public> <dossier audio> <sortie> [moteurs...]
import http from 'node:http'; import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'; import { join, extname } from 'node:path';
import puppeteer from 'puppeteer';
const [root, audioDir, outFile, ...engines] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); r.end(readFileSync(p)); }).listen(8765);
const files = readdirSync(audioDir).filter(f => f.endsWith('.mp3')).map(f => join(audioDir, f));
const b = await puppeteer.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const out = []; const log = s => { console.log(s); out.push(s); };
for (const eng of engines.length ? engines : ['offline-quran']) {
  const p = await b.newPage(); const net = [];
  p.on('console', m => { if (/error|erreur/i.test(m.text())) net.push('console: ' + m.text().slice(0, 300)); });
  p.on('pageerror', e => net.push('pageerror: ' + e.message));
  p.on('requestfailed', r => net.push('échec réseau: ' + r.url().slice(0, 120) + ' ' + (r.failure()?.errorText ?? '')));
  await p.goto('http://localhost:8765/', { waitUntil: 'load' });
  await p.select('#engine', eng); await p.$eval('#engine', e => e.dispatchEvent(new Event('change', { bubbles: true })));
  await (await p.$('#benchFiles')).uploadFile(...files); await p.select('#benchPace', '1');
  const t0 = Date.now(); await p.$eval('#benchGo', e => e.click());
  let txt = '';
  while (Date.now() - t0 < 40 * 60e3) { await new Promise(r => setTimeout(r, 5000)); txt = await p.$eval('#benchOut', e => e.textContent); if (/^BANC|^Échec/.test(txt)) break; }
  log(`\n===== ${eng} (${((Date.now() - t0) / 1000).toFixed(0)} s) =====\n${txt}`);
  const diag = await p.$eval('#dlog', e => e.textContent).catch(() => '');
  log('--- journal ---\n' + diag.split('\n').filter(l => /banc|ERREUR|suivi acoustique|prêt|échelle/i.test(l)).slice(0, 40).join('\n'));
  if (net.length) log('--- problèmes ---\n' + [...new Set(net)].slice(0, 30).join('\n'));
  await p.close();
}
writeFileSync(outFile, out.join('\n')); await b.close(); srv.close();

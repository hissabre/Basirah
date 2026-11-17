// Compile TypeScript → JS puis assemble une page UNIQUE (ouvrable par double-clic, sans serveur).
import { execSync } from 'node:child_process'; import { readFileSync, writeFileSync } from 'node:fs';
execSync('tsc -p tsconfig.diag.json', { stdio: 'inherit' });
const strip = s => s.replace(/^import .*$/gm, '').replace(/^export (class|const|function|interface|type) /gm, '$1 ').replace(/^export \{[^}]*\};?$/gm, '');
const code = ['ringbuffer', 'capture'].map(f => strip(readFileSync(`diag/js/${f}.js`, 'utf8'))).join('\n');
writeFileSync('diag/basirah-mic-diagnostic.html', readFileSync('diag/page.template.html', 'utf8').replace('%%CODE%%', () => code));
console.log('diag/basirah-mic-diagnostic.html écrit');

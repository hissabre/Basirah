// Compile app/main.ts (+ cœur) en UN fichier HTML autonome.  Lancé par moi, pas par l'utilisateur.
import { execFileSync } from 'node:child_process'; import { readFileSync, writeFileSync } from 'node:fs';
const ES = process.env.ESBUILD || 'esbuild';
const js = execFileSync(ES, ['app/main.ts', '--bundle', '--format=iife', '--target=es2022', '--minify'], { maxBuffer: 1 << 26 }).toString();
const q = readFileSync('data/quran-hafs-uthmani.json', 'utf8');
const html = readFileSync('app/index.template.html', 'utf8').replace('%%QURAN%%', () => q).replace('%%CODE%%', () => js.replace(/<\/script/g, '<\\/script'));
import { copyFileSync } from 'node:fs'; copyFileSync('app/sw.js', 'public/sw.js'); copyFileSync('app/manifest.webmanifest', 'public/manifest.webmanifest');
writeFileSync('public/index.html', html); console.log('public/index.html', (html.length / 1e6).toFixed(2), 'Mo');

// Application LUNETTES (INMO Air 2) : public/glasses.html, avec sourates et traductions (Sahih International, Hamidullah).
{
  const gjs = execFileSync(ES, ['app/glasses/glasses.ts', '--bundle', '--format=iife', '--target=es2020', '--minify'], { maxBuffer: 1 << 26 }).toString();
  const trOf = f => { const a = []; for (const l of readFileSync(f, 'utf8').split('\n')) { const m = /^(\d+)\|(\d+)\|(.*)$/.exec(l); if (m) a.push(m[3]); } return a; };
  const TR = { en: trOf('data/translations/en.sahih.txt'), fr: trOf('data/translations/fr.hamidullah.txt') };
  const g = readFileSync('app/glasses/glasses.template.html', 'utf8').replace('%%QURAN%%', () => q).replace('%%SURAHS%%', () => readFileSync('data/surahs.json', 'utf8'))
    .replace('%%TR%%', () => JSON.stringify(TR).replace(/<\/script/g, '<\\/script')).replace('%%CODE%%', () => gjs.replace(/<\/script/g, '<\\/script'));
  writeFileSync('public/glasses.html', g); console.log('public/glasses.html', (g.length / 1e6).toFixed(2), 'Mo');
}

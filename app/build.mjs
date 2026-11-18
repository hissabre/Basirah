// Compile app/main.ts (+ cœur) en UN fichier HTML autonome.  Lancé par moi, pas par l'utilisateur.
import { execFileSync } from 'node:child_process'; import { readFileSync, writeFileSync } from 'node:fs';
const ES = process.env.ESBUILD || 'esbuild';
const js = execFileSync(ES, ['app/main.ts', '--bundle', '--format=iife', '--target=es2022', '--minify'], { maxBuffer: 1 << 26 }).toString();
const q = readFileSync('data/quran-hafs-uthmani.json', 'utf8');
const html = readFileSync('app/index.template.html', 'utf8').replace('%%QURAN%%', () => q).replace('%%CODE%%', () => js.replace(/<\/script/g, '<\\/script'));
import { copyFileSync } from 'node:fs'; copyFileSync('app/sw.js', 'public/sw.js'); copyFileSync('app/manifest.webmanifest', 'public/manifest.webmanifest');
writeFileSync('public/index.html', html); console.log('public/index.html', (html.length / 1e6).toFixed(2), 'Mo');

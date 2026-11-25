// Calcule les fbank EXACTEMENT comme la page (StreamingFbank, par paquets de 100 ms) et les écrit à côté du fichier (.page).
import { readFileSync, writeFileSync } from 'node:fs';
import { StreamingFbank } from '../../src/audio/fbank.ts';
for (const f of process.argv.slice(2)) {
  const pcm = new Float32Array(readFileSync(f).buffer.slice(0)); const fb = new StreamingFbank(undefined, 600);
  for (let i = 0; i < pcm.length; i += 1600) fb.push(pcm.subarray(i, i + 1600));
  writeFileSync(f + '.page', Buffer.from(fb.slice(0, fb.framesDone).buffer)); console.log(f, fb.framesDone, 'images');
}

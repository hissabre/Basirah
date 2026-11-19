/** Code du worker Whisper (transformers.js 3.0.0 chargé depuis CDN, modèle Xenova/whisper-base), repris TEL QUEL de l'ancienne version Basirah-test.html qui fonctionnait chez l'utilisateur. */
export const WHISPER_WORKER_SRC = String.raw`const P=(async()=>{const er=[];for(const u of['https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js','https://unpkg.com/@huggingface/transformers@3.0.0/dist/transformers.min.js','https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0']){try{return await import(u)}catch(e){er.push(new URL(u).host+' : '+(e&&e.message||e))}}throw new Error('moteur inaccessible ('+er.join(' ; ')+')')})();P.catch(()=>{});
let p=null,M='',dev='wasm';
self.onmessage=async e=>{try{
 if(e.data.init){const T=await P;M=e.data.model||'Xenova/whisper-base';const pg=x=>self.postMessage({prog:x});
  if(e.data.local){T.env.allowLocalModels=true;T.env.allowRemoteModels=false;T.env.localModelPath=e.data.local}
  if(e.data.gpu&&self.navigator&&navigator.gpu){try{p=await T.pipeline('automatic-speech-recognition',M,{device:'webgpu',dtype:{encoder_model:'fp32',decoder_model_merged:'q4'},progress_callback:pg});dev='webgpu'}catch(x){p=null}}
  if(!p){p=await T.pipeline('automatic-speech-recognition',M,{device:'wasm',progress_callback:pg});dev='wasm'}
  self.postMessage({ready:1,dev});return}
 let r;try{r=await p(e.data.audio,{language:'arabic',task:'transcribe'})}catch(x){if(dev!=='webgpu')throw x;p=await(await P).pipeline('automatic-speech-recognition',M,{device:'wasm'});dev='wasm';self.postMessage({dev});r=await p(e.data.audio,{language:'arabic',task:'transcribe'})}
 self.postMessage({text:r.text});
}catch(err){self.postMessage({err:String(err)})}};`;

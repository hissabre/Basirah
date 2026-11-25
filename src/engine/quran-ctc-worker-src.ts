/**
 * Worker du moteur acoustique Coran : ONNX Runtime Web (WebAssembly, CDN épinglé) + modèle CTC « lettres » (quran-asr-tiny, MIT).
 * Reçoit des fbank (calculées sur le fil principal, en flux) et renvoie les log-probabilités par image. Le modèle est gardé
 * dans le cache du navigateur (Cache API) : après le premier chargement, plus aucun réseau n'est nécessaire.
 * Les noms des entrées/sorties sont lus dans le modèle lui-même (rien n'est supposé).
 */
export const QURAN_CTC_WORKER_SRC = String.raw`
const ORTV='1.27.0', CDN=['https://cdn.jsdelivr.net/npm/onnxruntime-web@'+ORTV+'/dist/','https://unpkg.com/onnxruntime-web@'+ORTV+'/dist/'];
let RT=null,S=null,inX,inL,outLP,outLen,lensI64=true,blank=0,offs=0,cal=null,B=80;
const post=(m,t)=>self.postMessage(m,t||[]);
function loadOrt(bases){const er=[];for(const b of (bases&&bases.length?bases:CDN))for(const f of['ort.wasm.min.js','ort.min.js']){try{importScripts(b+f);if(self.ort){RT=self.ort;RT.env.wasm.wasmPaths=b;return b+f}}catch(e){er.push(new URL(b).host+'/'+f+' : '+(e&&e.message||e))}}throw new Error('ONNX Runtime inaccessible ('+er.join(' ; ')+')')}
const tmo=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('délai')),ms))]);
async function bytes(url,label){
  let c=null;try{if(self.caches){c=await tmo(caches.open('basirah-models-v1'),3000);const hit=await tmo(c.match(url),3000);if(hit){post({prog:{label,pct:100,cached:true}});return new Uint8Array(await hit.arrayBuffer())}}}catch(e){c=null}
  const r=await fetch(url);if(!r.ok)throw new Error(url+' : HTTP '+r.status);
  const tot=+(r.headers.get('content-length')||0),rd=r.body&&r.body.getReader?r.body.getReader():null;let buf;
  if(rd){const parts=[];let n=0,last=0;for(;;){const{done,value}=await rd.read();if(done)break;parts.push(value);n+=value.length;if(tot&&n-last>tot/50){last=n;post({prog:{label,pct:Math.round(100*n/tot)}})}}buf=new Uint8Array(n);let o=0;for(const p of parts){buf.set(p,o);o+=p.length}}
  else buf=new Uint8Array(await r.arrayBuffer());
  try{if(c)await tmo(c.put(url,new Response(buf.slice(),{headers:{'content-type':'application/octet-stream'}})),5000)}catch(e){}
  return buf}
function lsm(a,o,V){let m=-1e30;for(let i=0;i<V;i++)if(a[o+i]>m)m=a[o+i];let s=0;for(let i=0;i<V;i++)s+=Math.exp(a[o+i]-m);return m+Math.log(s)}
async function run(x,T){
  const feeds={};feeds[inX]=new RT.Tensor('float32',x,[1,T,B]);
  if(inL)feeds[inL]=lensI64?new RT.Tensor('int64',BigInt64Array.from([BigInt(T)]),[1]):new RT.Tensor('int32',Int32Array.from([T]),[1]);
  const r=await S.run(feeds),lp=r[outLP],V=lp.dims[2];let n=lp.dims[1];
  if(outLen&&r[outLen])n=Math.min(n,Number(r[outLen].data[0]));
  const a=new Float32Array(lp.data.buffer?lp.data.slice(0,n*V):Float32Array.from(lp.data).slice(0,n*V));
  if(n&&Math.abs(lsm(a,0,V))>0.01)for(let k=0;k<n;k++){const l=lsm(a,k*V,V);for(let i=0;i<V;i++)a[k*V+i]-=l}
  return{a,n,V}}
function score(o){let s=0,c=0;for(let k=0;k<o.n;k++){let m=-1e30,g=0;for(let i=0;i<o.V;i++)if(o.a[k*o.V+i]>m){m=o.a[k*o.V+i];g=i}c+=Math.exp(m);if(g!==blank&&m>Math.log(0.7))s++}return s+0.2*c/Math.max(1,o.n)}
self.onmessage=async e=>{const d=e.data;try{
 if(d.init){
  const lib=loadOrt(d.ort);RT.env.wasm.numThreads=self.crossOriginIsolated?Math.max(1,Math.min(4,(self.navigator&&navigator.hardwareConcurrency||2)-1)):1;
  let tok=null,tokUrl='',er=[];for(const u of d.tokens){try{tok=new TextDecoder().decode(await bytes(u,'jetons'));tokUrl=u;break}catch(x){er.push(String(x&&x.message||x))}}
  if(!tok)throw new Error('liste des jetons introuvable : '+er.join(' ; '));
  const lines=tok.split(/\r?\n/).filter(l=>l.trim());const bl=lines.findIndex(l=>/^<(blk|blank)>/.test(l));blank=bl>=0?+lines[bl].trim().split(/\s+/).pop():0;
  let url='';er=[];for(const u of d.models){try{const b=await bytes(u,'modèle');post({prog:{label:'préparation du modèle',pct:100}});S=await RT.InferenceSession.create(b,{executionProviders:['wasm'],graphOptimizationLevel:'all'});url=u;break}catch(x){er.push(u.split('/').slice(-3).join('/')+' : '+String(x&&x.message||x))}}
  if(!S)throw new Error('modèle impossible à charger : '+er.join(' ; '));
  inX=S.inputNames.find(n=>!/len/i.test(n));inL=S.inputNames.find(n=>/len/i.test(n));outLP=S.outputNames.find(n=>!/len/i.test(n));outLen=S.outputNames.find(n=>/len/i.test(n));
  const z=new Float32Array(100*B).fill(-10);let t0=performance.now(),w;
  try{w=await run(z,100)}catch(x){if(!inL)throw x;lensI64=false;w=await run(z,100)}
  post({ready:1,tokens:tok,tokUrl,url,lib,threads:RT.env.wasm.numThreads,io:{inputs:S.inputNames,outputs:S.outputNames,V:w.V,framesPerSec:w.n/1},warmMs:Math.round(performance.now()-t0)});return}
 if(d.run){
  const t=performance.now();let x=d.x;
  if(cal===null&&d.voiced){const x2=new Float32Array(x.length);for(let i=0;i<x.length;i++)x2[i]=x[i]+20.7944;const a=await run(x,d.T),b=await run(x2,d.T),sa=score(a),sb=score(b);cal={scale:sb>sa*1.5&&sb>3?32768:1,s1:+sa.toFixed(2),s32768:+sb.toFixed(2)};offs=cal.scale===1?0:20.7944;post({cal})}
  if(offs){const y=new Float32Array(x.length);for(let i=0;i<x.length;i++)y[i]=x[i]+offs;x=y}
  const o=await run(x,d.T);post({lp:o.a,n:o.n,V:o.V,t0:d.t0,t1:d.t1,id:d.id,ms:performance.now()-t},[o.a.buffer]);return}
}catch(err){post({err:String(err&&err.message||err),id:d&&d.id})}};`;

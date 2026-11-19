/**
 * Capture audio persistante (navigateur). NON TESTÉE de bout en bout dans l'environnement de développement actuel
 * (pas de micro réel) : voir docs/TESTS.md pour le protocole de test de 30 min à exécuter sur appareil.
 *
 * - Une seule demande de permission, un seul MediaStream, un seul AudioContext, tant que `stop()` n'est pas appelé.
 * - AudioWorklet (pas de ScriptProcessorNode) ; rééchantillonnage à 16 kHz dans le worklet si le contexte ne le permet pas.
 * - Les moteurs de reconnaissance ne touchent jamais au micro : ils reçoivent les blocs via `onChunk`.
 */
import { RingBuffer } from "./ringbuffer.js";
const WORKLET = `
class Cap extends AudioWorkletProcessor {
  constructor(o){super();this.ratio=sampleRate/16000;this.acc=[];this.pos=0;this.n=0;this.sumsq=0;this.peak=0;this.cnt=0;}
  process(inp){
    const x=inp[0]&&inp[0][0]; if(!x) return true;
    for(let i=0;i<x.length;i++){const v=x[i];this.sumsq+=v*v;const a=Math.abs(v);if(a>this.peak)this.peak=a;this.cnt++;}
    // rééchantillonnage linéaire vers 16 kHz
    for(let p=this.pos;p<x.length;p+=this.ratio){const i=Math.floor(p),f=p-i,y=(x[i]*(1-f))+((x[i+1]!==undefined?x[i+1]:x[i])*f);this.acc.push(y);}
    this.pos=((this.pos+ (Math.ceil((x.length-this.pos)/this.ratio))*this.ratio) - x.length);
    if(this.acc.length>=1600){const out=Float32Array.from(this.acc);this.acc=[];
      const rms=Math.sqrt(this.sumsq/Math.max(1,this.cnt));this.port.postMessage({pcm:out,rms,peak:this.peak},[out.buffer]);this.sumsq=0;this.peak=0;this.cnt=0;}
    return true;}
}
registerProcessor('basirah-capture',Cap);`;
export class AudioCapture {
    ev;
    stream = null;
    ctx = null;
    node = null;
    ring = new RingBuffer(16000 * 30); // 30 s max
    t = 0;
    status = 'stopped';
    rms = 0;
    peak = 0;
    lastVoice = 0;
    permissionRequests = 0;
    streamsOpened = 0;
    silenceRms = 0.0015;
    constructor(ev = {}) {
        this.ev = ev;
    }
    set(s, why) { if (s !== this.status) {
        this.status = s;
        this.ev.onStatus?.(s, why);
    } }
    async start() {
        if (this.status === 'running' || this.status === 'requesting')
            return; // jamais de second flux
        this.set('requesting', 'demande du micro');
        this.permissionRequests++;
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        }
        catch (e) {
            this.set('stopped', 'micro refusé ou indisponible : ' + e.name);
            throw e;
        }
        this.streamsOpened++;
        this.ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
        await this.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.node = new AudioWorkletNode(this.ctx, 'basirah-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
        this.node.port.onmessage = e => {
            const { pcm, rms, peak } = e.data;
            this.rms = rms;
            this.peak = peak;
            if (rms > this.silenceRms)
                this.lastVoice = performance.now();
            const start = this.t;
            this.t += pcm.length / 16000;
            this.ring.write(pcm);
            this.ev.onChunk?.(pcm, start);
        };
        this.ctx.createMediaStreamSource(this.stream).connect(this.node);
        this.lastVoice = performance.now();
        // interruptions : micro débranché / repris par une autre application
        this.stream.getAudioTracks().forEach(tr => {
            tr.onended = () => this.set('interrupted', 'piste micro terminée (débranché ou pris par une autre application)');
            tr.onmute = () => this.set('interrupted', 'micro coupé par le système');
            tr.onunmute = () => { if (this.status === 'interrupted')
                this.set('running', 'micro rétabli'); };
        });
        const ctx = this.ctx;
        ctx.onstatechange = () => { if (ctx.state === 'suspended')
            this.set('suspended', 'contexte audio suspendu');
        else if (ctx.state === 'running')
            this.set('running', 'contexte audio actif'); };
        document.addEventListener('visibilitychange', this.vis);
        this.set('running', 'capture démarrée');
    }
    /** Reprise après veille / onglet masqué : on réutilise le MÊME flux quand c'est possible, sans nouvelle permission. */
    vis = async () => {
        if (document.visibilityState !== 'visible' || !this.ctx)
            return;
        try {
            if (this.ctx.state === 'suspended')
                await this.ctx.resume();
        }
        catch { /* reste suspended, signalé */ }
        const live = this.stream?.getAudioTracks().some(t => t.readyState === 'live');
        if (!live)
            this.set('interrupted', 'flux micro perdu pendant la mise en veille — relancer');
    };
    /** Lecture bornée du tampon (le moteur tire à son rythme ; en cas de retard, les plus anciens sont abandonnés et comptés). */
    pull(maxSamples) { return this.ring.read(maxSamples); }
    stats() {
        return { status: this.status, rms: this.rms, peak: this.peak, silentMs: this.status === 'running' ? performance.now() - this.lastVoice : 0,
            buffered: this.ring.size, dropped: this.ring.dropped, permissionRequests: this.permissionRequests, streams: this.streamsOpened, sampleRate: this.ctx?.sampleRate ?? null };
    }
    async stop() {
        document.removeEventListener('visibilitychange', this.vis);
        if (this.ctx)
            this.ctx.onstatechange = null;
        this.stream?.getAudioTracks().forEach(t => { t.onended = null; t.onmute = null; t.onunmute = null; });
        this.node?.disconnect();
        this.stream?.getTracks().forEach(t => t.stop());
        try {
            await this.ctx?.close();
        }
        catch { /* déjà fermé */ }
        this.node = null;
        this.stream = null;
        this.ctx = null;
        this.ring.clear();
        this.set('stopped', 'arrêt demandé');
    }
}

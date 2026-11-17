import type { CloseInfo, ProviderMessage, StreamingProvider } from './online.ts';

/**
 * Fournisseur WebSocket vers le RELAIS Basirah (voir server/relay.mjs). Protocole défini par Basirah (pas par un tiers) :
 *   client → relais : 1er message texte {"type":"auth","token":"…","language":"ar"} ; ensuite des trames binaires PCM16 mono 16 kHz.
 *   relais → client : {"type":"ready"} puis {"type":"result","text","isFinal","start","end","confidence"} ; {"type":"error","message"}.
 * Le jeton est envoyé dans le premier message, jamais dans l'URL. La clé du fournisseur de reconnaissance reste sur le serveur.
 */
export interface WsLike { binaryType: string; readyState: number; send(d: string | ArrayBufferLike | ArrayBufferView): void; close(): void; onopen: any; onmessage: any; onclose: any; onerror: any }
export class WebSocketProvider implements StreamingProvider {
  readonly id: string;
  private ws: WsLike | null = null; private msgCb: (m: ProviderMessage) => void = () => {}; private closeCb: (i: CloseInfo) => void = () => {};
  constructor(private url: string, private token: () => Promise<string>, private o: { language?: string; readyTimeoutMs?: number; WS?: new (u: string) => WsLike } = {}) { this.id = 'relay:' + url; }
  onMessage(cb: (m: ProviderMessage) => void) { this.msgCb = cb; }
  onClose(cb: (i: CloseInfo) => void) { this.closeCb = cb; }
  async open(): Promise<void> {
    const tok = await this.token(); const WS = this.o.WS ?? (globalThis as any).WebSocket;
    const ws: WsLike = new WS(this.url); ws.binaryType = 'arraybuffer'; this.ws = ws;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => { rej(new Error('délai dépassé (relais)')); try { ws.close(); } catch { /* */ } }, this.o.readyTimeoutMs ?? 6000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: tok, language: this.o.language ?? 'ar' }));
      ws.onerror = () => { clearTimeout(t); rej(new Error('erreur de connexion WebSocket')); };
      ws.onclose = (e: any) => { clearTimeout(t); rej(new Error('fermé pendant l\'ouverture' + (e?.reason ? ' : ' + e.reason : ''))); };
      ws.onmessage = (e: any) => { try { const j = JSON.parse(String(e.data)); if (j.type === 'ready') { clearTimeout(t); res(); } else if (j.type === 'error') { clearTimeout(t); rej(new Error(j.message)); } } catch { /* */ } };
    });
    ws.onerror = () => {};
    ws.onmessage = (e: any) => { try { const j = JSON.parse(String(e.data));
      if (j.type === 'result') this.msgCb({ text: String(j.text ?? ''), isFinal: !!j.isFinal, start: +j.start || 0, end: +j.end || 0, confidence: typeof j.confidence === 'number' ? j.confidence : null }); } catch { /* trame invalide ignorée */ } };
    ws.onclose = (e: any) => this.closeCb({ clean: !!e?.wasClean, code: e?.code, reason: e?.reason ?? '' });
  }
  send(pcm16: Int16Array) { if (this.ws && this.ws.readyState === 1) this.ws.send(pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength)); }
  close() { try { this.ws?.close(); } catch { /* */ } }
}

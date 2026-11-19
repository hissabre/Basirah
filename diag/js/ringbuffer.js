/** Tampon circulaire BORNÉ de PCM float32. En cas de débordement, les plus anciens échantillons sont abandonnés et comptés (jamais de croissance illimitée). */
export class RingBuffer {
    capacity;
    buf;
    w = 0; // total écrit (échantillons)
    r = 0; // total lu
    dropped = 0;
    constructor(capacity) {
        this.capacity = capacity;
        this.buf = new Float32Array(capacity);
    }
    get size() { return this.w - this.r; }
    get totalWritten() { return this.w; }
    write(x) {
        if (x.length >= this.capacity) {
            const skip = x.length - this.capacity;
            this.dropped += this.size + skip;
            this.r = this.w + skip;
            x = x.subarray(skip);
        }
        const over = this.size + x.length - this.capacity;
        if (over > 0) {
            this.r += over;
            this.dropped += over;
        }
        for (let i = 0; i < x.length; i++)
            this.buf[(this.w + i) % this.capacity] = x[i];
        this.w += x.length;
    }
    /** Lit jusqu'à n échantillons (consomme). */
    read(n) {
        n = Math.min(n, this.size);
        const o = new Float32Array(n);
        for (let i = 0; i < n; i++)
            o[i] = this.buf[(this.r + i) % this.capacity];
        this.r += n;
        return o;
    }
    clear() { this.r = this.w; }
}

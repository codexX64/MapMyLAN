// Capture du micro pour le mode vocal de l'assistant.
//
// Rééchantillonne en PCM 16 bits mono 16 kHz (ce qu'attend Whisper), avec un
// passe-bas avant la décimation — sans lui, tout ce qui dépasse 8 kHz se
// replie dans la bande de la voix et Whisper rate des mots. Publie aussi le
// niveau (RMS) qui sert à détecter la parole et à animer l'orbe.
// Le même que celui du Hub et de la console VOX.
class CaptureVoix extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; this.pos = 0; this.dernier = 0;
    this.buf = new Int16Array(4096); this.n = 0; this.acc = 0; this.cnt = 0;
    this.filtre = sampleRate > 17000;
    const w = Math.tan(Math.PI * 7000 / sampleRate), k = Math.SQRT2, d = 1 + k * w + w * w;
    this.b0 = w * w / d; this.b1 = 2 * this.b0; this.b2 = this.b0;
    this.a1 = 2 * (w * w - 1) / d; this.a2 = (1 - k * w + w * w) / d;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    // « vider » : la fin de phrase tient dans le dernier bloc incomplet.
    this.port.onmessage = e => {
      if (e.data !== 'vider') return;
      const out = this.buf.slice(0, this.n); this.n = 0;
      this.port.postMessage({ t: 'pcm', b: out.buffer, fin: true }, [out.buffer]);
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    let src = ch;
    if (this.filtre) {
      src = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const x = ch[i];
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        src[i] = y;
      }
    }
    for (let i = 0; i < ch.length; i++) this.acc += ch[i] * ch[i];
    this.cnt += ch.length;
    while (this.pos < ch.length) {
      const i0 = Math.floor(this.pos), f = this.pos - i0;
      const s0 = i0 < 0 ? this.dernier : src[i0];
      const s1 = i0 + 1 < ch.length ? src[i0 + 1] : s0;
      let v = s0 + (s1 - s0) * f;
      if (v > 1) v = 1; else if (v < -1) v = -1;
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7FFF;
      if (this.n === this.buf.length) {
        const out = this.buf; this.buf = new Int16Array(4096); this.n = 0;
        this.port.postMessage({ t: 'pcm', b: out.buffer }, [out.buffer]);
      }
      this.pos += this.ratio;
    }
    this.dernier = src[ch.length - 1];
    this.pos -= ch.length;
    if (this.cnt >= 1024) { this.port.postMessage({ t: 'lvl', rms: Math.sqrt(this.acc / this.cnt) }); this.acc = 0; this.cnt = 0; }
    return true;
  }
}
registerProcessor('capture-voix', CaptureVoix);

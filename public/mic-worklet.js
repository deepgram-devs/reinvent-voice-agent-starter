// Runs on the audio thread: turns the microphone's float samples into 16-bit PCM, in chunks of about 40 ms.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(640);   // 40 ms at 16 kHz
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this.chunk[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("mic", MicProcessor);

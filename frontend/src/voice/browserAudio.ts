// Microphone stays local while thinking/speaking. Only completed utterances are uploaded.
export class BrowserMicrophone {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private recorder: MediaRecorder | null = null;
  async open(signal: AbortSignal) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (signal.aborted) {
      this.close();
      throw new DOMException("Stopped", "AbortError");
    }
    this.context = new AudioContext();
    await this.context.resume();
    if (signal.aborted) {
      this.close();
      throw new DOMException("Stopped", "AbortError");
    }
    this.source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
  }
  capture(signal: AbortSignal): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Stopped", "AbortError"));
        return;
      }
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t =>
        MediaRecorder.isTypeSupported(t)
      );
      if (!mime || !this.stream || !this.analyser) {
        reject(new Error("Voice conversation needs a supported browser on localhost or HTTPS."));
        return;
      }
      const recorder = new MediaRecorder(this.stream, { mimeType: mime });
      this.recorder = recorder;
      const pieces: Blob[] = [];
      const samples = new Float32Array(this.analyser.fftSize);
      const gate = new SpeechGate();
      let frame = 0;
      let done = false;
      let frameTime = performance.now();
      const cleanup = () => {
        cancelAnimationFrame(frame);
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
        if (this.recorder === recorder) this.recorder = null;
      };
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        cleanup();
        if (error) {
          recorder.onstop = null;
          if (recorder.state === "recording") recorder.stop();
          reject(error);
        } else if (recorder.state === "recording") recorder.stop();
      };
      const cancel = () => finish(new DOMException("Stopped", "AbortError"));
      const timeout = setTimeout(
        () =>
          gate.hasSpeech
            ? finish()
            : finish(
                new Error(
                  "No speech detected for 30 seconds. Start the conversation again when ready."
                )
              ),
        30000
      );
      recorder.ondataavailable = e => {
        if (e.data.size) pieces.push(e.data);
      };
      recorder.onerror = () =>
        finish(new Error("The microphone recording failed. Please start again."));
      recorder.onstop = () => {
        cleanup();
        resolve(new Blob(pieces, { type: mime }));
      };
      signal.addEventListener("abort", cancel, { once: true });
      recorder.start(200);
      const check = () => {
        if (done) return;
        this.analyser!.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
        const now = performance.now();
        if (gate.update(rms, now, Math.min(now - frameTime, 100))) {
          finish();
          return;
        }
        frameTime = now;
        frame = requestAnimationFrame(check);
      };
      frame = requestAnimationFrame(check);
    });
  }
  close() {
    if (this.recorder) {
      this.recorder.onstop = null;
      if (this.recorder.state === "recording") this.recorder.stop();
      this.recorder = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
export class SpeechGate {
  private voicedMs = 0;
  private lastVoice = 0;
  get hasSpeech() {
    return this.voicedMs >= 350;
  }
  update(rms: number, now: number, elapsed: number) {
    if (rms >= 0.018) {
      this.voicedMs += elapsed;
      this.lastVoice = now;
    }
    return this.hasSpeech && now - this.lastVoice >= 1200;
  }
}

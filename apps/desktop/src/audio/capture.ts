import workletUrl from "./captureWorklet.ts?worker&url";

export interface MicFrame {
  /** 320 × Int16 = 20 ms of 16 kHz mono PCM. */
  pcm: Int16Array;
  rms: number;
}

/**
 * Microphone capture on the stage's AudioContext (the same one TTS plays on).
 * WebKit's echo canceller removes audio played by this WebView from the mic
 * signal, which is why capture and playback share one page (research 03 §6).
 */
export class MicCapture {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private sink?: GainNode;
  private moduleLoaded = false;
  private opening?: Promise<void>;
  onFrame?: (f: MicFrame) => void;
  deviceId?: string;
  /** Label of the active input device, once open. */
  activeLabel = "";

  constructor(private readonly ctx: AudioContext) {}

  get isOpen(): boolean {
    return !!this.stream;
  }

  /** Open the mic (idempotent; concurrent calls share one open). */
  open(): Promise<void> {
    if (this.stream) return Promise.resolve();
    this.opening ??= this.doOpen().finally(() => (this.opening = undefined));
    return this.opening;
  }

  private async doOpen(): Promise<void> {
    if (!this.moduleLoaded) {
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.moduleLoaded = true;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.stream = stream;
    this.activeLabel = stream.getAudioTracks()[0]?.label ?? "";
    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, "hikari-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.node.port.onmessage = (e: MessageEvent<{ frame: ArrayBuffer; rms: number }>) =>
      this.onFrame?.({ pcm: new Int16Array(e.data.frame), rms: e.data.rms });
    // Pull the worklet through the graph without making any sound.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node).connect(this.sink).connect(this.ctx.destination);
  }

  /** Release the mic (macOS's orange mic indicator goes off). */
  close(): void {
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = this.source = this.node = this.sink = undefined;
    this.activeLabel = "";
  }

  /** Switch input device (reopens if currently open). */
  async setDevice(deviceId: string | undefined): Promise<void> {
    this.deviceId = deviceId || undefined;
    if (this.stream) {
      this.close();
      await this.open();
    }
  }

  static async inputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  }
}

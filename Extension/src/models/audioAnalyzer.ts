export type AudioEventType =
  | "AUDIO_SPEECH"
  | "AUDIO_NOISE"
  | "AUDIO_MULTIPLE_SPEAKERS"
  | "AUDIO_WHISPER";

export interface AudioEvent {
  type: AudioEventType;
  timestamp: string;
  confidence: number;
  metrics: {
    volume: number;
    speechEnergy: number;
    dominantFrequency: number;
  };
}

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;

  private frequencyData: Uint8Array<ArrayBuffer> | null = null;

  private running = false;

  private callback: ((event: AudioEvent) => void) | null = null;

  async start(
    onEvent: (event: AudioEvent) => void
  ): Promise<void> {
    if (this.running) {
      return;
    }

    this.callback = onEvent;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });

      this.audioContext = new AudioContext();

      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      this.analyser = this.audioContext.createAnalyser();

      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;

      this.microphone =
        this.audioContext.createMediaStreamSource(this.stream);

      this.microphone.connect(this.analyser);

      this.frequencyData = new Uint8Array(
        this.analyser.frequencyBinCount
      );

      this.running = true;

      this.analyze();
    } catch (error) {
      this.cleanup();

      console.error("AudioAnalyzer failed to start:", error);

      throw error;
    }
  }

  private analyze(): void {
    const analyser = this.analyser;
    const frequencyData = this.frequencyData;

    if (
      !this.running ||
      analyser === null ||
      frequencyData === null
    ) {
      return;
    }

    analyser.getByteFrequencyData(frequencyData);

    const volume = this.calculateVolume();
    const speechEnergy = this.calculateSpeechEnergy();
    const dominantFrequency =
      this.calculateDominantFrequency();

    if (volume > 15) {
      const event = this.createEvent(
        volume,
        speechEnergy,
        dominantFrequency
      );

      this.callback?.(event);
    }

    requestAnimationFrame(() => {
      this.analyze();
    });
  }

  private calculateVolume(): number {
    const data = this.frequencyData;

    if (data === null || data.length === 0) {
      return 0;
    }

    let sum = 0;

    for (let i = 0; i < data.length; i++) {
      const value = data[i];

      if (value !== undefined) {
        sum += value;
      }
    }

    return sum / data.length;
  }

  private calculateSpeechEnergy(): number {
    const data = this.frequencyData;
    const context = this.audioContext;
    const analyser = this.analyser;

    if (
      data === null ||
      context === null ||
      analyser === null ||
      data.length === 0
    ) {
      return 0;
    }

    const sampleRate = context.sampleRate;

    const binWidth =
      sampleRate / analyser.fftSize;

    // Human speech mainly occupies approximately
    // the 300 Hz – 3400 Hz range.
    const minBin = Math.max(
      0,
      Math.floor(300 / binWidth)
    );

    const maxBin = Math.min(
      data.length - 1,
      Math.ceil(3400 / binWidth)
    );

    let sum = 0;
    let count = 0;

    for (let i = minBin; i <= maxBin; i++) {
      const value = data[i];

      if (value !== undefined) {
        sum += value;
        count++;
      }
    }

    if (count === 0) {
      return 0;
    }

    return sum / count;
  }

  private calculateDominantFrequency(): number {
    const data = this.frequencyData;
    const context = this.audioContext;
    const analyser = this.analyser;

    if (
      data === null ||
      context === null ||
      analyser === null ||
      data.length === 0
    ) {
      return 0;
    }

    let maxValue = 0;
    let maxIndex = 0;

    for (let i = 0; i < data.length; i++) {
      const value = data[i];

      if (
        value !== undefined &&
        value > maxValue
      ) {
        maxValue = value;
        maxIndex = i;
      }
    }

    const binWidth =
      context.sampleRate / analyser.fftSize;

    return maxIndex * binWidth;
  }

  /**
   * Detect strong frequency peaks inside the
   * human speech frequency range.
   *
   * This is a heuristic. It does NOT identify
   * actual people, but can detect multiple
   * strong speech-like frequency components.
   */
  private detectMultipleSpeechPeaks(): number {
    const data = this.frequencyData;
    const context = this.audioContext;
    const analyser = this.analyser;

    if (
      data === null ||
      context === null ||
      analyser === null
    ) {
      return 0;
    }

    const binWidth =
      context.sampleRate / analyser.fftSize;

    const minFrequency = 300;
    const maxFrequency = 3400;

    const minBin = Math.max(
      1,
      Math.floor(minFrequency / binWidth)
    );

    const maxBin = Math.min(
      data.length - 2,
      Math.ceil(maxFrequency / binWidth)
    );

    let peaks = 0;

    for (let i = minBin; i <= maxBin; i++) {
      const current = data[i];
      const previous = data[i - 1];
      const next = data[i + 1];

      if (
        current === undefined ||
        previous === undefined ||
        next === undefined
      ) {
        continue;
      }

      // A frequency bin is considered a peak when
      // it is stronger than its neighbours.
      if (
        current > previous &&
        current > next &&
        current > 45
      ) {
        peaks++;
      }
    }

    return peaks;
  }

  /**
   * Whispering usually has lower overall volume
   * but can still contain noticeable speech-band
   * energy.
   */
  private detectWhisper(
    volume: number,
    speechEnergy: number
  ): boolean {
    return (
      volume >= 20 &&
      volume < 32 &&
      speechEnergy >= 18 &&
      speechEnergy < 40
    );
  }

  /**
   * Multiple-speaker detection is based on several
   * strong speech-band frequency peaks.
   *
   * This is a heuristic and should be treated as
   * "possible multiple speech", not proof of
   * multiple people.
   */
  private detectMultipleSpeakers(
    speechEnergy: number
  ): boolean {
    const peaks = this.detectMultipleSpeechPeaks();

    return (
      speechEnergy > 30 &&
      peaks >= 8
    );
  }

  private createEvent(
    volume: number,
    speechEnergy: number,
    dominantFrequency: number
  ): AudioEvent {
    let type: AudioEventType = "AUDIO_NOISE";

    const multipleSpeakers =
      this.detectMultipleSpeakers(speechEnergy);

    const whisper =
      this.detectWhisper(
        volume,
        speechEnergy
      );

    if (multipleSpeakers) {
      type = "AUDIO_MULTIPLE_SPEAKERS";
    } else if (whisper) {
      type = "AUDIO_WHISPER";
    } else if (speechEnergy > 25) {
      type = "AUDIO_SPEECH";
    }

    const confidence = Math.min(
      1,
      speechEnergy / 100
    );

    return {
      type,
      timestamp: new Date().toISOString(),
      confidence: Number(
        confidence.toFixed(2)
      ),
      metrics: {
        volume: Number(
          volume.toFixed(2)
        ),
        speechEnergy: Number(
          speechEnergy.toFixed(2)
        ),
        dominantFrequency: Number(
          dominantFrequency.toFixed(2)
        )
      }
    };
  }

  stop(): void {
    this.running = false;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.microphone !== null) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    if (this.audioContext !== null) {
      void this.audioContext.close();
      this.audioContext = null;
    }

    if (this.stream !== null) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }

      this.stream = null;
    }

    this.analyser = null;
    this.frequencyData = null;
    this.callback = null;
  }
}
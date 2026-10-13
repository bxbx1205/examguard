export type AudioEventType = "AUDIO_SPEECH" | "AUDIO_NOISE" | "AUDIO_MULTIPLE_SPEAKERS" | "AUDIO_WHISPER";
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
export declare class AudioAnalyzer {
    private audioContext;
    private analyser;
    private microphone;
    private stream;
    private frequencyData;
    private running;
    private callback;
    start(onEvent: (event: AudioEvent) => void): Promise<void>;
    private analyze;
    private calculateVolume;
    private calculateSpeechEnergy;
    private calculateDominantFrequency;
    /**
     * Detect strong frequency peaks inside the
     * human speech frequency range.
     *
     * This is a heuristic. It does NOT identify
     * actual people, but can detect multiple
     * strong speech-like frequency components.
     */
    private detectMultipleSpeechPeaks;
    /**
     * Whispering usually has lower overall volume
     * but can still contain noticeable speech-band
     * energy.
     */
    private detectWhisper;
    /**
     * Multiple-speaker detection is based on several
     * strong speech-band frequency peaks.
     *
     * This is a heuristic and should be treated as
     * "possible multiple speech", not proof of
     * multiple people.
     */
    private detectMultipleSpeakers;
    private createEvent;
    stop(): void;
    private cleanup;
}
//# sourceMappingURL=audioAnalyzer.d.ts.map
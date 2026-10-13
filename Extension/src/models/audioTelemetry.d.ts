import type { AudioEvent } from "./audioAnalyzer.js";
import type { AnomalyResult } from "./anomalyScorer.js";
export interface AudioTelemetry {
    source: "audio";
    eventType: AudioEvent["type"];
    timestamp: string;
    anomalyScore: number;
    anomalyLevel: AnomalyResult["level"];
    metrics: {
        volume: number;
        speechEnergy: number;
        dominantFrequency: number;
    };
    reasons: string[];
}
export declare function createAudioTelemetry(event: AudioEvent, anomaly: AnomalyResult): AudioTelemetry;
//# sourceMappingURL=audioTelemetry.d.ts.map
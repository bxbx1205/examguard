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

export function createAudioTelemetry(
  event: AudioEvent,
  anomaly: AnomalyResult
): AudioTelemetry {
  return {
    source: "audio",
    eventType: event.type,
    timestamp: event.timestamp,
    anomalyScore: anomaly.score,
    anomalyLevel: anomaly.level,
    metrics: {
      volume: event.metrics.volume,
      speechEnergy: event.metrics.speechEnergy,
      dominantFrequency: event.metrics.dominantFrequency
    },
    reasons: anomaly.reasons
  };
}

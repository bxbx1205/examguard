export function createAudioTelemetry(event, anomaly) {
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
//# sourceMappingURL=audioTelemetry.js.map
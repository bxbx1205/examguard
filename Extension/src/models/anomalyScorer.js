export class AnomalyScorer {
    constructor() {
        this.recentEvents = [];
        this.maxHistory = 10;
    }
    calculate(event) {
        this.recentEvents.push(event);
        if (this.recentEvents.length > this.maxHistory) {
            this.recentEvents.shift();
        }
        let score = 0;
        const reasons = [];
        // High volume can indicate speech or significant background noise.
        if (event.metrics.volume > 45) {
            score += 25;
            reasons.push("High audio volume");
        }
        else if (event.metrics.volume > 30) {
            score += 10;
            reasons.push("Elevated audio volume");
        }
        // Strong speech-band energy indicates possible speech activity.
        if (event.metrics.speechEnergy > 60) {
            score += 30;
            reasons.push("Strong speech-band energy");
        }
        else if (event.metrics.speechEnergy > 35) {
            score += 15;
            reasons.push("Moderate speech-band energy");
        }
        // Repeated audio activity increases suspicion.
        const recentSpeechEvents = this.recentEvents.filter((item) => item.type === "AUDIO_SPEECH" &&
            item.metrics.speechEnergy > 25);
        if (recentSpeechEvents.length >= 5) {
            score += 25;
            reasons.push("Repeated speech activity");
        }
        else if (recentSpeechEvents.length >= 3) {
            score += 10;
            reasons.push("Repeated audio activity");
        }
        // Keep the score within 0–100.
        score = Math.min(100, score);
        let level;
        if (score >= 70) {
            level = "HIGH";
        }
        else if (score >= 40) {
            level = "MEDIUM";
        }
        else {
            level = "LOW";
        }
        return {
            score,
            level,
            reasons,
            timestamp: new Date().toISOString()
        };
    }
    reset() {
        this.recentEvents = [];
    }
}
//# sourceMappingURL=anomalyScorer.js.map
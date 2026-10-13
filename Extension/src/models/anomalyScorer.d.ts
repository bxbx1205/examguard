import type { AudioEvent } from "./audioAnalyzer.js";
export interface AnomalyResult {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    reasons: string[];
    timestamp: string;
}
export declare class AnomalyScorer {
    private recentEvents;
    private readonly maxHistory;
    calculate(event: AudioEvent): AnomalyResult;
    reset(): void;
}
//# sourceMappingURL=anomalyScorer.d.ts.map
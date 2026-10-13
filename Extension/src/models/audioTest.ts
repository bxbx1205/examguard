import { AudioAnalyzer } from "./audioAnalyzer.js";
import { AnomalyScorer } from "./anomalyScorer.js";
import { createAudioTelemetry } from "./audioTelemetry.js";

declare const chrome: any;

const analyzer = new AudioAnalyzer();
const scorer = new AnomalyScorer();

const startButton = document.getElementById(
  "startAudio"
) as HTMLButtonElement;

const stopButton = document.getElementById(
  "stopAudio"
) as HTMLButtonElement;

const statusText = document.getElementById(
  "statusText"
) as HTMLDivElement;

const scoreElement = document.getElementById(
  "score"
) as HTMLDivElement;

const levelElement = document.getElementById(
  "level"
) as HTMLDivElement;

const eventTypeElement = document.getElementById(
  "eventType"
) as HTMLSpanElement;

const volumeElement = document.getElementById(
  "volume"
) as HTMLSpanElement;

const speechEnergyElement = document.getElementById(
  "speechEnergy"
) as HTMLSpanElement;

const frequencyElement = document.getElementById(
  "frequency"
) as HTMLSpanElement;

const reasonsElement = document.getElementById(
  "reasons"
) as HTMLDivElement;

const historyList = document.getElementById(
  "historyList"
) as HTMLDivElement;

let eventCount = 0;

const lastFiredTime: Record<string, number> = {};
const ANOMALY_COOLDOWN_MS = 2500;

function reportAudioAnomaly(
  subtype: string,
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  confidence: number,
  metrics: any,
  message: string
) {
  const now = Date.now();
  if (lastFiredTime[subtype] && now - lastFiredTime[subtype]! < ANOMALY_COOLDOWN_MS) {
    return;
  }
  lastFiredTime[subtype] = now;

  const telemetryFrame = {
    type: "TELEMETRY_ANOMALY",
    event_id: `evt_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
    category: "AUDIO",
    subtype: subtype,
    severity: severity,
    confidence: confidence,
    metrics: metrics,
    snapshot_key: null,
    message: message,
    timestamp: new Date().toISOString()
  };

  console.log("[ExamGuard Audio] Telemetry emitted:", telemetryFrame);

  if (typeof chrome !== "undefined" && (chrome as any)?.runtime?.sendMessage) {
    (chrome as any).runtime.sendMessage({
      action: "TELEMETRY_EVENT",
      data: telemetryFrame
    });
  }
}

startButton.addEventListener("click", async () => {
  scorer.reset();
  eventCount = 0;

  statusText.textContent = "STARTING...";

  try {
    await analyzer.start((event) => {

      // Calculate anomaly result
      const result = scorer.calculate(event);

      // Create clean telemetry object
      const telemetry = createAudioTelemetry(
        event,
        result
      );

      // Fire strongly typed audio anomalies to backend
      if (event.type === "AUDIO_MULTIPLE_SPEAKERS") {
        reportAudioAnomaly(
          "AUDIO_MULTIPLE_SPEAKERS",
          "HIGH",
          0.91,
          {
            speakers_estimated: 2,
            ...event.metrics
          },
          "Multiple vocal conversation streams detected in ambient room"
        );
      } else if (event.type === "AUDIO_WHISPER") {
        reportAudioAnomaly(
          "AUDIO_WHISPER",
          "LOW",
          0.84,
          {
            whisper_energy_ratio: Number((event.metrics.speechEnergy / 100).toFixed(2)),
            decibel_level: Number((event.metrics.volume - 60).toFixed(1)),
            ...event.metrics
          },
          "Whispering acoustic frequencies registered in background"
        );
      } else if (result.level === "HIGH" || result.score >= 50) {
        reportAudioAnomaly(
          "AUDIO_VOLUME_SPIKE",
          "MEDIUM",
          0.85,
          {
            volume: event.metrics.volume,
            speech_energy: event.metrics.speechEnergy,
            anomaly_score: result.score
          },
          "Elevated vocal or acoustic noise detected"
        );
      }

      // Send telemetry to browser console
      console.log(
        "ExamGuard Audio Telemetry:",
        telemetry
      );

      // Update anomaly score
      scoreElement.textContent =
        `${telemetry.anomalyScore}`;

      // Update anomaly level
      levelElement.textContent =
        telemetry.anomalyLevel;

      // Update event type
      eventTypeElement.textContent =
        telemetry.eventType;

      // Update volume
      volumeElement.textContent =
        telemetry.metrics.volume.toFixed(2);

      // Update speech energy
      speechEnergyElement.textContent =
        telemetry.metrics.speechEnergy.toFixed(2);

      // Update dominant frequency
      frequencyElement.textContent =
        `${telemetry.metrics.dominantFrequency.toFixed(2)} Hz`;

      // Update reasons
      if (telemetry.reasons.length > 0) {

        reasonsElement.innerHTML =
          telemetry.reasons
            .map(
              (reason) =>
                `<div class="reason">${reason}</div>`
            )
            .join("");

      } else {

        reasonsElement.innerHTML =
          `<div class="reason">
             No suspicious activity
           </div>`;
      }

      // Add event to history
      addHistoryItem(
        telemetry.eventType,
        telemetry.anomalyScore,
        telemetry.anomalyLevel
      );
    });

    statusText.textContent = "ACTIVE";

  } catch (error) {

    statusText.textContent = "ERROR";

    console.error(
      "Audio monitoring error:",
      error
    );
  }
});

stopButton.addEventListener("click", () => {

  analyzer.stop();
  scorer.reset();

  statusText.textContent = "INACTIVE";

  scoreElement.textContent = "0";
  levelElement.textContent = "LOW";

  eventTypeElement.textContent = "---";
  volumeElement.textContent = "0";
  speechEnergyElement.textContent = "0";
  frequencyElement.textContent = "0 Hz";

  reasonsElement.innerHTML =
    `<div class="reason">
       No suspicious activity
     </div>`;
});

function addHistoryItem(
  eventType: string,
  score: number,
  level: string
): void {

  eventCount++;

  if (eventCount === 1) {
    historyList.innerHTML = "";
  }

  const item = document.createElement("div");

  item.className = "history-item";

  item.innerHTML =
    `<span class="history-score">
       ${score}/100
     </span>
     — ${level} — ${eventType}`;

  historyList.prepend(item);

  // Keep only the latest 10 events
  if (historyList.children.length > 10) {

    const lastItem =
      historyList.lastElementChild;

    if (lastItem !== null) {
      historyList.removeChild(lastItem);
    }
  }
}
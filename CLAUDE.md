# 🛡️ ExamGuard (ProctorSentinel) — Context & LLM Maintenance Log

> **Repository:** `ExamGuard-prod-`  
> **Last Updated:** October 2026  
> **Purpose:** Persistent context store, architecture documentation, added/removed changes log, and guidelines for LLMs / AI pair programmers.

---

## 1. System Overview & Architecture

ExamGuard is a privacy-first, edge-AI proctoring platform that performs in-browser computer vision and acoustic telemetry on the examinee's machine, transmitting lightweight structured JSON events to a high-concurrency Go backend and live React invigilator dashboard.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Candidate Browser (Chrome / Edge MV3 Extension)                                       │
│  ├── Content Lockdown (content/lockdown.js) - Tabs, Fullscreen, Clipboard, DevTools    │
│  ├── Vision Edge-AI (dist/faceDetector.js, dist/headPoseEstimator.js, MediaPipe WASM)  │
│  ├── Audio Edge-AI (dist/audioAnalyzer.js, Web Audio API FFT formants & whisper)       │
│  └── Background Service Worker (background.js) ──► WebSocket /ws/telemetry             │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ WSS / WS JSON Telemetry Frames
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Go High-Concurrency Edge Server (backend)                                              │
│  ├── Ingestion & Auth (internal/api/handlers.go)                                       │
│  ├── Dedicated Session Manager per Student (internal/concurrency/session_manager.go)   │
│  ├── Multi-Signal Scoring Engine (internal/scoring/engine.go)                          │
│  ├── Storage Tier: PostgreSQL (state & history), Redis (presence TTL), MinIO (snapshots)│
│  └── Invigilator Hub Broadcast ──► WebSocket /ws/invigilator                           │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ Initial State, Incident Alerts, Live Scores
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Live Invigilator Dashboard (dashboard - React 19, Vite, Tailwind CSS)                  │
│  ├── App.tsx & websocket.ts (Subscribed to INITIAL_STATE, Alerts, Status, Connections)  │
│  ├── Live Candidate Grid & Fleet Directory (with dynamic trust score & violation HUD)  │
│  ├── Forensic Anomaly Feed & Evidence Modal                                            │
│  └── Live Proctor Actions (WARN, LOCK, TERMINATE)                                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Team Feature Matrix

| Member | Focus Area | Key Files |
|:-------|:-----------|:----------|
| **Atharva Mandle** | Go Backend & Concurrency Engine | `backend/internal/`, `backend/cmd/server/main.go` |
| **Aryan Karande** | Invigilator Dashboard UI | `dashboard/src/App.tsx`, `dashboard/src/services/websocket.ts` |
| **Anushka Patel** | Extension Lifecycle, Lockdown & WS | `Extension/background.js`, `Extension/content/lockdown.js`, `Extension/manifest.json` |
| **Taher Sanawadwala** | Vision Edge AI & Face Landmarker | `Extension/src/models/faceDetector.js`, `Extension/src/models/headPoseEstimator.js` |
| **Dimpal Sharma** | Audio Edge AI & Acoustic Scorer | `Extension/src/models/audioAnalyzer.ts`, `Extension/src/models/anomalyScorer.ts` |

---

## 3. Communication Protocols

### 3.1 Candidate Extension WebSocket (`/ws/telemetry`)
- **Connection URL:** `ws://localhost:8080/ws/telemetry?token=<JWT_OR_dev_token>&exam_id=<EXAM_ID>`
- **Handshake (`SESSION_INIT`):**
  ```json
  {
    "type": "SESSION_INIT",
    "event_id": "init_<uuid>",
    "exam_id": "exam_2026_cs501",
    "student_id": "50",
    "timestamp": "ISO_STRING",
    "payload": {
      "client_version": "1.0.0",
      "browser": "Chrome",
      "screen_resolution": "1920x1080",
      "capabilities": {
        "camera": true,
        "microphone": true,
        "mediapipe_loaded": true,
        "audio_worklet_loaded": true
      }
    }
  }
  ```
- **Keepalive (`HEARTBEAT_PING` / `HEARTBEAT_PONG` every 5,000ms):**
  ```json
  { "type": "HEARTBEAT_PING", "student_id": "50", "timestamp": "ISO_STRING" }
  ```
- **Telemetry Frame (`TELEMETRY_ANOMALY`):**
  ```json
  {
    "type": "TELEMETRY_ANOMALY",
    "event_id": "evt_<uuid>",
    "exam_id": "exam_2026_cs501",
    "session_id": "sess_<exam>_stud_<id>",
    "student_id": "50",
    "timestamp": "ISO_STRING",
    "category": "VISION | AUDIO | ENVIRONMENT",
    "subtype": "<SUBTYPE>",
    "severity": "LOW | MEDIUM | HIGH | CRITICAL",
    "confidence": 0.95,
    "metrics": {},
    "snapshot_key": null,
    "message": "Human-readable diagnostic description"
  }
  ```

### 3.2 Invigilator Dashboard WebSocket (`/ws/invigilator`)
- **Connection URL:** `ws://localhost:8080/ws/invigilator?token=inv_token&exam_id=exam_2026_cs501`
- **Initial Sync (`INITIAL_STATE`):**
  Pushed by backend immediately upon connection with database-backed roster:
  `exam_id`, `exam_name`, `summary` (`total_registered`, `active_count`, `flagged_count`, `disconnected_count`), and `candidates` array.
- **Incident Broadcast (`INCIDENT_ALERT`):**
  Real-time fan-out of anomaly events to proctor dashboards.
- **Status Broadcast (`CANDIDATE_STATUS_UPDATE`):**
  Pushed when trust score or violation state changes.
- **Connection Broadcast (`CANDIDATE_CONNECTION_CHANGE`):**
  Pushed on connect or disconnect.

---

## 4. Anomaly Subtypes & Scoring Weights

| Category | Subtype | Severity | Penalty | Description / Trigger |
|:---------|:--------|:---------|:-------:|:----------------------|
| **VISION** | `MULTIPLE_FACES_DETECTED` | `CRITICAL` | -15 pts | MediaPipe detects >= 2 faces |
| **VISION** | `FACE_NOT_DETECTED` | `CRITICAL` | -10 pts | Face missing continuously for > 5.0s |
| **VISION** | `GAZE_DEVIATION` | `MEDIUM` | -5 pts | Iris non-center fixation for > 3.5s |
| **VISION** | `HEAD_POSE_ANOMALY` | `MEDIUM` | -5 pts | Head yaw/pitch/roll > 20° for > 3.0s |
| **AUDIO** | `AUDIO_MULTIPLE_SPEAKERS` | `HIGH` | -8 pts | Web Audio FFT multiple vocal formants |
| **AUDIO** | `AUDIO_WHISPER` | `LOW` | -3 pts | 2.5kHz–6kHz whisper frequency band |
| **AUDIO** | `AUDIO_VOLUME_SPIKE` | `MEDIUM` | -5 pts | Elevated audio volume spike |
| **ENVIRONMENT** | `TAB_SWITCH_BLUR` | `HIGH` | -12 pts | `window.onblur` or hidden tab |
| **ENVIRONMENT** | `FULLSCREEN_EXIT` | `HIGH` | -10 pts | `fullscreenElement === null` |
| **ENVIRONMENT** | `DEVTOOLS_ATTEMPT` | `CRITICAL` | -15 pts | F12 / devtools inspection attempt |
| **ENVIRONMENT** | `CLIPBOARD_VIOLATION` | `LOW` | -3 pts | Copy/cut/paste attempt |

---

## 5. Development & Build Commands

### Backend
```bash
# Run server
cd backend
go run cmd/server/main.go

# Build all packages
go build ./...

# Run tests
go test ./...
```

### Dashboard
```bash
cd dashboard
npm install
npm run dev      # Launch Vite dev server on http://localhost:5173
npm run build    # TypeScript check (tsc -b) + Vite production build
```

### Extension
```bash
cd Extension
npm install
npm run build    # Or: node build.js (bundles faceDetector, headPoseEstimator, audioAnalyzer & copies wasm)
npx -p typescript tsc  # Typecheck TypeScript files
```

---

## 6. Detailed Changes Log (Added & Removed Changes)

### 6.5 Full Stack Integration & Hardware Readiness (Latest Updates)
- **[REMOVED]** Eliminated `INITIAL_CANDIDATES` mock array from `dashboard/src/App.tsx`. Candidates state starts empty (`[]`) and is populated purely from backend database via WebSocket `INITIAL_STATE`.
- **[REMOVED]** Removed fake default incidents from `dashboard/src/components/AnomalyFeed.tsx`. The feed dynamically renders genuine infractions received from the scoring engine.
- **[REMOVED]** Removed hardcoded default counts from `dashboard/src/components/Sidebar.tsx` (reset defaults from `28` to `0`).
- **[FIXED]** Fixed `popup.js:415` (`Could not establish connection. Receiving end does not exist`):
  - Chrome strictly forbids content scripts on internal tabs (`chrome://`, `chrome-extension://`, `edge://`).
  - `Extension/popup/popup.js` now detects restricted URLs and automatically launches the dedicated proctoring portal tab (`camera-test/index.html`).
  - For normal web tabs, dynamically injects `dist/faceDetector.js`, `dist/headPoseEstimator.js`, `dist/audioAnalyzer.js`, and `content/lockdown.js` via `chrome.scripting.executeScript` before sending messages.
- **[ADDED]** Camera and Microphone Hardware Diagnostics & Fallback:
  - Added hardware device enumeration (`navigator.mediaDevices.enumerateDevices()`) in both `content/lockdown.js` and `camera-test/camera.js`.
  - When no webcam hardware is detected: displays a candidate warning, emits a `CAMERA_OFFLINE` anomaly to the backend (`CRITICAL` severity), and notifies the background worker via `DEVICE_STATUS_CHANGE`.
  - Implemented graceful audio fallback: requests `{ video, audio }`, and automatically falls back to `{ video }` only if microphone is unavailable or denied.
  - Implemented `track.onended` listener to detect mid-exam camera disconnection.
- **[ADDED]** Live Invigilator Panel Presence Synchronization:
  - Updated `backend/internal/api/handlers.go` (`buildInitialState`): candidates without an active session now default to `status = 'DISCONNECTED'` and `camera_active = false`.
  - Updated `backend/internal/concurrency/session_manager.go`: `broadcastCandidateStatusUpdate` now transmits `student_name`, `camera_active`, and `microphone_active`.
  - When an examinee starts their exam, backend registers the session and immediately broadcasts `CANDIDATE_STATUS_UPDATE` to the invigilator dashboard, turning their card `ACTIVE` with green camera/mic status indicators.
- **[FIXED]** Manifest V3 WebAssembly Content Security Policy:
  - Fixed MediaPipe `CompileError: WebAssembly.instantiate(): Compiling or instantiating WebAssembly module violates Content Security Policy`.
  - Added `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }` to `Extension/manifest.json`.
  - Added GPU-to-CPU graceful fallback in `src/models/faceDetector.js` and `src/models/headPoseEstimator.js`.

---

## 7. Notes & Guidelines for Future LLMs

1. **Backend Database Seeding:** The Go backend seeds `exam_2026_cs501` with students 12, 21, 33, 38, 46, 49, 50, 52 on startup. `dev_token` authenticates student requests, and `inv_token` authenticates invigilator requests.
2. **WebSocket Path Disambiguation:**
   - Candidate extension connects to: `/ws/telemetry`
   - Invigilator dashboard connects to: `/ws/invigilator`
3. **Manifest V3 Service Worker Limits:** `background.js` cannot access `getUserMedia()` directly. Media streams must be acquired from content scripts (`content/lockdown.js`) or extension tabs (`camera-test/index.html`, `audio-test.html`).
4. **MediaPipe Model Assets:** `blaze_face_short_range.tflite` and `face_landmarker.task` are located in `Extension/models/`. Always ensure `dist/wasm` is populated by running `node build.js`.
5. **Always Verify Builds:**
   - Dashboard: `npm run build` in `dashboard/`
   - Backend: `go build ./...` in `backend/`
   - Extension: `node build.js` in `Extension/`


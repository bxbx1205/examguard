# 🛡️ ExamGuard (ProctorSentinel) — API & WebSocket Protocol Specification

> **Document Version:** `1.0.0`  
> **Status:** `APPROVED & ACTIVE`  
> **Target Audience:** Atharva Mandle (Backend/Architecture), Taher Sanawadwala (Edge-AI CV), Anushka Patel (Extension MV3), Dimpal Sharma (Audio Analytics), Aryan Karande (React Dashboard).

---

## 📌 Table of Contents

1. [Architectural Overview & Connection Topology](#1-architectural-overview--connection-topology)
2. [Global Standards & Conventions](#2-global-standards--conventions)
3. [Authentication & Session Lifecycle](#3-authentication--session-lifecycle)
4. [Candidate Extension WebSocket Protocol (`/ws/telemetry`)](#4-candidate-extension-websocket-protocol-wstelemetry)
   - [Handshake & Registration](#41-handshake--registration)
   - [Heartbeat & Keepalive](#42-heartbeat--keepalive)
   - [Telemetry Anomaly Events](#43-telemetry-anomaly-events)
   - [Server-to-Extension Commands & Interventions](#44-server-to-extension-commands--interventions)
   - [Session Completion](#45-session-completion)
5. [Invigilator Dashboard WebSocket Protocol (`/ws/invigilator`)](#5-invigilator-dashboard-websocket-protocol-wsinvigilator)
   - [Handshake & Initial State Sync](#51-handshake--initial-state-sync)
   - [Real-Time Incident Stream](#52-real-time-incident-stream)
   - [Candidate Score & Presence Updates](#53-candidate-score--presence-updates)
   - [Invigilator Actions & Interventions](#54-invigilator-actions--interventions)
6. [Evidentiary Snapshot Pipeline (MinIO / S3)](#6-evidentiary-snapshot-pipeline-minio--s3)
7. [REST API Specification (`/api/v1`)](#7-rest-api-specification-apiv1)
   - [Authentication & Sessions](#71-authentication--sessions)
   - [Exams Management](#72-exams-management)
   - [Candidates & Live Status](#73-candidates--live-status)
   - [Incidents & Telemetry Logs](#74-incidents--telemetry-logs)
   - [Evidence & Snapshots](#75-evidence--snapshots)
   - [Invigilator Interventions (REST Fallback)](#76-invigilator-interventions-rest-fallback)
   - [System Health & Metrics](#77-system-health--metrics)
8. [Integrity Scoring Engine Formulation](#8-integrity-scoring-engine-formulation)
9. [Canonical Type Definitions](#9-canonical-type-definitions)
   - [TypeScript (Frontend Dashboard & Browser Extension)](#91-typescript-definitions)
   - [Golang (Backend Domain Models)](#92-golang-struct-definitions)
10. [Developer Testing & Verification Recipes](#10-developer-testing--verification-recipes)

---

## 1. Architectural Overview & Connection Topology

ExamGuard uses a dual-WebSocket and REST micro-architecture to isolate high-throughput anomaly streams from human monitoring interfaces:

```
+---------------------------------------------------------------------------------------+
|                                    CLIENT TIER                                        |
|                                                                                       |
|   +------------------------------------+    +-------------------------------------+   |
|   |  Candidate Browser Extension       |    |  Invigilator Dashboard (React.js)   |   |
|   |  - MediaPipe FaceMesh / HeadPose   |    |  - Real-time Candidate Grid Cards   |   |
|   |  - Web Audio API Voice Analyzer    |    |  - Live Incident Ticker             |   |
|   |  - Window / Lockdown Event Hooks   |    |  - Snapshot Audit Modal             |   |
|   +-----------------+------------------+    +------------------+------------------+   |
+---------------------|------------------------------------------|----------------------+
                      | WSS: /ws/telemetry                       | WSS: /ws/invigilator
                      | (Telemetry Stream)                       | (Broadcast Alerts)
                      v                                          v
+---------------------------------------------------------------------------------------+
|                               GO BACKEND GATEWAY (:8080)                              |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   |   JWT Authenticator & Connection Multiplexer                                  |   |
|   +-------------------------------------------------------------------------------+   |
|         |                                                           |                 |
|         v                                                           v                 |
|   +-----------------------------+                           +---------------------+   |
|   | Dedicated Candidate         |                           | Invigilator Hub     |   |
|   | Goroutine & Buffered Chans  |                           | Broadcaster Fan-Out |   |
|   +--------------+--------------+                           +----------+----------+   |
|                  |                                                     ^              |
|                  v                                                     |              |
|   +--------------------------------------------------------------------+----------+   |
|   | Anomaly Scoring Engine & Sliding-Window Evaluator                             |   |
|   +-------------------------------------------------------------------------------+   |
|         |                                                           |                 |
+---------|-----------------------------------------------------------|-----------------+
          v                                                           v
+------------------------------------+             +------------------------------------+
|         STORAGE TIER               |             |          CACHE & PUB/SUB           |
|                                    |             |                                    |
|   +----------------------------+   |             |   +----------------------------+   |
|   | PostgreSQL (:5432)         |   |             |   | Redis (:6379)              |   |
|   | - Exams, Students, Audit   |   |             |   | - Heartbeat Presence TTL   |   |
|   | - Incident Logs & Scores   |   |             |   | - Channel: `exam:alerts`   |   |
|   +----------------------------+   |             |   +----------------------------+   |
|                                    |             +------------------------------------+
|   +----------------------------+   |
|   | MinIO S3 (:9000/:9001)     |   |
|   | - Flagged Snapshots (JPEG) |   |
|   +----------------------------+   |
+------------------------------------+
```

### Network Endpoints & Ports

| Service | Protocol | Host / Local URL | Purpose |
| :--- | :--- | :--- | :--- |
| **REST API** | HTTP/1.1 | `http://localhost:8080/api/v1` | Auth, exam management, report exports, CRUD |
| **Telemetry WebSocket** | WSS / WS | `ws://localhost:8080/ws/telemetry` | Extension telemetry ingestion from examinees |
| **Invigilator WebSocket** | WSS / WS | `ws://localhost:8080/ws/invigilator` | Real-time incident stream to proctors |
| **Dashboard UI** | HTTP/1.1 | `http://localhost:5173` | React.js Invigilator console |
| **MinIO S3 API** | HTTP/1.1 | `http://localhost:9000` | S3-compatible snapshot uploads |
| **MinIO Console** | HTTP/1.1 | `http://localhost:9001` | MinIO web browser UI (`minioadmin` / `minioadmin123`) |
| **PostgreSQL** | TCP | `localhost:5432` | Relational storage (`examguard_admin`) |
| **Redis** | TCP | `localhost:6379` | Session cache & Pub/Sub broker |

---

## 2. Global Standards & Conventions

1. **Serialization Format:** Strictly UTF-8 encoded JSON for all REST and WebSocket payloads.
2. **Casing Standard:**
   - **JSON Keys:** `snake_case` (e.g., `student_id`, `trust_score`, `event_id`).
   - **Enums & Subtypes:** `SCREAMING_SNAKE_CASE` (e.g., `MULTIPLE_FACES_DETECTED`, `CRITICAL`).
   - **TypeScript Variables:** `camelCase` internally, mapped to `snake_case` on API boundaries.
3. **Timestamps:** Standard ISO-8601 UTC with millisecond precision: `YYYY-MM-DDTHH:mm:ss.sssZ` (e.g., `2026-09-14T17:15:30.450Z`).
4. **Error Payloads:** All REST errors return uniform JSON:
   ```json
   {
     "success": false,
     "error": {
       "code": "RESOURCE_NOT_FOUND",
       "message": "Candidate with Roll #49 does not exist in exam CS501",
       "details": null
     }
   }
   ```
5. **Severity Levels:**
   - `LOW`: Subtle anomalies (e.g., isolated audio whisper, rapid glance away).
   - `MEDIUM`: Moderate infractions (sustained off-screen gaze $\ge 3.5\text{s}$, volume spikes).
   - `HIGH`: Major security violations (tab switch, window blur, fullscreen exit).
   - `CRITICAL`: Severe academic integrity violations (multiple faces detected, face missing $> 5\text{s}$).

---

## 3. Authentication & Session Lifecycle

### 3.1 JWT Token Schema
Every WebSocket connection and protected REST call requires a signed JSON Web Token (HMAC SHA-256).

**Payload Claims:**
```json
{
  "sub": "user_stud_49",
  "student_id": "49",
  "name": "Atharva Mandle",
  "exam_id": "exam_2026_cs501",
  "role": "student",
  "exp": 1789423200,
  "iat": 1789408800
}
```
*(For Invigilators: `"role": "invigilator"`, `"user_id": "inv_01"`).*

### 3.2 WebSocket Handshake Authentication
Browser extensions and web clients cannot reliably send custom HTTP headers during a native browser `new WebSocket(url)` handshake. Therefore:

- **Primary Authentication Method:** Supply the JWT via the query parameter `?token=<JWT_STRING>`.
- **Exam Context:** Supply the exam session via `?exam_id=<EXAM_ID>`.
- **Example URL:**
  ```text
  ws://localhost:8080/ws/telemetry?token=eyJhbGciOi...&exam_id=exam_2026_cs501
  ```

If the token is expired, corrupted, or missing, the Go backend immediately rejects the WebSocket upgrade with HTTP `401 Unauthorized` or closes with WS Close Code `4401 (Unauthorized)`.

---

## 4. Candidate Extension WebSocket Protocol (`/ws/telemetry`)

*Primary Implementers: **Anushka Patel** (Extension), **Taher Sanawadwala** (Vision), **Dimpal Sharma** (Audio), **Atharva Mandle** (Backend).*

### 4.1 Handshake & Registration

Immediately after the WebSocket connection opens, the extension MUST send a `SESSION_INIT` frame:

#### Request Frame: `SESSION_INIT` (Extension -> Server)
```json
{
  "type": "SESSION_INIT",
  "event_id": "init_9f8a12bc-e701-443b-8514-617e4bb00101",
  "exam_id": "exam_2026_cs501",
  "student_id": "49",
  "timestamp": "2026-09-14T17:00:00.120Z",
  "payload": {
    "client_version": "1.0.0",
    "browser": "Chrome 128.0.0",
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

#### Response Frame: `SESSION_INIT_ACK` (Server -> Extension)
```json
{
  "type": "SESSION_INIT_ACK",
  "session_id": "sess_cs501_stud_49_20260914",
  "student_id": "49",
  "timestamp": "2026-09-14T17:00:00.250Z",
  "payload": {
    "status": "INITIALIZED",
    "initial_trust_score": 100,
    "heartbeat_interval_ms": 5000,
    "rules": {
      "face_missing_tolerance_sec": 5,
      "gaze_deviation_tolerance_sec": 3.5,
      "capture_snapshots_on_severity": ["HIGH", "CRITICAL"]
    }
  }
}
```

---

### 4.2 Heartbeat & Keepalive

To detect disconnections or network drops within 10 seconds, the extension and Go backend maintain a heartbeat loop:

- **Ping Frame (Extension -> Server, every 5,000 ms):**
  ```json
  {
    "type": "HEARTBEAT_PING",
    "student_id": "49",
    "timestamp": "2026-09-14T17:05:00.000Z"
  }
  ```
- **Pong Frame (Server -> Extension, immediate reply):**
  ```json
  {
    "type": "HEARTBEAT_PONG",
    "timestamp": "2026-09-14T17:05:00.015Z"
  }
  ```

> [!IMPORTANT]
> If the Go backend misses 3 consecutive heartbeats (15 seconds), the session status transitions to `DISCONNECTED` in Redis, and an instant alert is pushed to the Invigilator Dashboard.

---

### 4.3 Telemetry Anomaly Events

When Edge-AI or lockdown listeners detect an infraction, the extension transmits a strongly-typed telemetry frame:

#### Base Envelope Format:
```json
{
  "type": "TELEMETRY_ANOMALY",
  "event_id": "evt_uuid_v4",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_49_20260914",
  "student_id": "49",
  "timestamp": "2026-09-14T17:14:22.450Z",
  "category": "VISION | AUDIO | ENVIRONMENT",
  "subtype": "<ANOMALY_SUBTYPE>",
  "severity": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": 0.95,
  "metrics": {},
  "snapshot_key": "evidence/2026-09-14/exam_cs501/stud_49_evt_9834.jpg",
  "message": "Human-readable diagnostic description"
}
```

---

#### 4.3.1 Computer Vision Events (Taher Sanawadwala)

##### A. Multiple Faces Detected (`MULTIPLE_FACES_DETECTED`)
- **Severity:** `CRITICAL`
- **Penalty:** `-15 pts`
- **Trigger:** MediaPipe detects $\ge 2$ faces in the webcam feed.
- **Snapshot Requirement:** Mandatory upload.
```json
{
  "type": "TELEMETRY_ANOMALY",
  "event_id": "evt_7f3b8a1c-6d21-4f1b-9e4a-1123456789ab",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_49_20260914",
  "student_id": "49",
  "timestamp": "2026-09-14T17:14:22.450Z",
  "category": "VISION",
  "subtype": "MULTIPLE_FACES_DETECTED",
  "severity": "CRITICAL",
  "confidence": 0.96,
  "metrics": {
    "faces_detected": 2,
    "bounding_boxes": [
      { "x_min": 0.25, "y_min": 0.20, "x_max": 0.55, "y_max": 0.65 },
      { "x_min": 0.70, "y_min": 0.35, "x_max": 0.92, "y_max": 0.75 }
    ]
  },
  "snapshot_key": "evidence/2026-09-14/exam_cs501/stud_49_evt_multi_face.jpg",
  "message": "Secondary individual identified in camera viewport"
}
```

##### B. Candidate Missing from Camera (`FACE_NOT_DETECTED`)
- **Severity:** `CRITICAL`
- **Penalty:** `-10 pts`
- **Trigger:** Face landmarks absent continuously for $> 5.0\text{s}$.
```json
{
  "type": "TELEMETRY_ANOMALY",
  "event_id": "evt_2d4e6f8a-9b1c-4e3f-8a5b-2234567890cd",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_49_20260914",
  "student_id": "49",
  "timestamp": "2026-09-14T17:18:05.100Z",
  "category": "VISION",
  "subtype": "FACE_NOT_DETECTED",
  "severity": "CRITICAL",
  "confidence": 0.99,
  "metrics": {
    "duration_seconds": 5.4,
    "last_seen_timestamp": "2026-09-14T17:17:59.700Z"
  },
  "snapshot_key": "evidence/2026-09-14/exam_cs501/stud_49_evt_no_face.jpg",
  "message": "Candidate departed camera viewport for over 5 seconds"
}
```

##### C. Sustained Off-Screen Gaze (`GAZE_DEVIATION`)
- **Severity:** `MEDIUM`
- **Penalty:** `-5 pts` (Warning issued if $\ge 3$ occurrences)
- **Trigger:** Iris tracking detects non-screen fixation for $> 3.5\text{s}$.
```json
{
  "type": "TELEMETRY_ANOMALY",
  "event_id": "evt_4a5b6c7d-8e9f-0a1b-2c3d-3345678901ef",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_46_20260914",
  "student_id": "46",
  "timestamp": "2026-09-14T17:21:40.320Z",
  "category": "VISION",
  "subtype": "GAZE_DEVIATION",
  "severity": "MEDIUM",
  "confidence": 0.88,
  "metrics": {
    "gaze_direction": "BOTTOM_RIGHT",
    "duration_seconds": 3.8,
    "head_pose": { "pitch": -12.4, "yaw": 24.8, "roll": 2.1 }
  },
  "snapshot_key": null,
  "message": "Candidate repeatedly glancing towards bottom-right corner"
}
```

##### D. Abnormal Head Pose Orientation (`HEAD_POSE_ANOMALY`)
- **Severity:** `MEDIUM`
- **Penalty:** `-5 pts`
- **Trigger:** Euler angles exceed safe thresholds (Pitch $> \pm 35^\circ$ or Yaw $> \pm 45^\circ$).

---

#### 4.3.2 Audio Analytics Events (Dimpal Sharma)

##### A. Multiple Speakers Detected (`AUDIO_MULTIPLE_SPEAKERS`)
- **Severity:** `HIGH`
- **Penalty:** `-8 pts`
- **Trigger:** Real-time Web Audio API FFT voice pitch classifier recognizes two distinct vocal frequency formants.
```json
{
  "type": "TELEMETRY_ANOMALY",
  "event_id": "evt_5b6c7d8e-9f0a-1b2c-3d4e-4456789012fa",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_52_20260914",
  "student_id": "52",
  "timestamp": "2026-09-14T17:24:11.890Z",
  "category": "AUDIO",
  "subtype": "AUDIO_MULTIPLE_SPEAKERS",
  "severity": "HIGH",
  "confidence": 0.91,
  "metrics": {
    "speakers_estimated": 2,
    "average_decibels": -24.5,
    "sample_duration_ms": 3200
  },
  "snapshot_key": null,
  "message": "Multiple vocal conversation streams detected in ambient room"
}
```

##### B. Whispering Audio Pattern (`AUDIO_WHISPER`)
- **Severity:** `LOW`
- **Penalty:** `-3 pts`
- **Trigger:** High-frequency, low-amplitude vocal band (2.5 kHz – 6 kHz) detected without fundamental vocal cord vibration.
```json
{
  "type": "TELEMETRY_ANOMALY",
  "event_id": "evt_6c7d8e9f-0a1b-2c3d-4e5f-5567890123ab",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_50_20260914",
  "student_id": "50",
  "timestamp": "2026-09-14T17:28:44.200Z",
  "category": "AUDIO",
  "subtype": "AUDIO_WHISPER",
  "severity": "LOW",
  "confidence": 0.84,
  "metrics": {
    "whisper_energy_ratio": 0.72,
    "decibel_level": -38.2
  },
  "snapshot_key": null,
  "message": "Whispering acoustic frequencies registered in background"
}
```

---

#### 4.3.3 Lockdown & Environment Events (Anushka Patel)

##### A. Tab Switch / Window Blur (`TAB_SWITCH_BLUR`)
- **Severity:** `HIGH`
- **Penalty:** `-12 pts`
- **Trigger:** `window.onblur` or `document.visibilitychange` (state: `hidden`).
```json
{
  "type": "TELEMETRY_ANOMALY",
  "event_id": "evt_7d8e9f0a-1b2c-3d4e-5f6a-6678901234bc",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_12_20260914",
  "student_id": "12",
  "timestamp": "2026-09-14T17:31:02.150Z",
  "category": "ENVIRONMENT",
  "subtype": "TAB_SWITCH_BLUR",
  "severity": "HIGH",
  "confidence": 1.0,
  "metrics": {
    "duration_seconds": 4.6,
    "target_visibility_state": "hidden"
  },
  "snapshot_key": null,
  "message": "Candidate navigated away from active exam window"
}
```

##### B. Fullscreen Mode Exited (`FULLSCREEN_EXIT`)
- **Severity:** `HIGH`
- **Penalty:** `-10 pts`
- **Trigger:** `document.fullscreenElement === null`.

##### C. DevTools Console Open Attempt (`DEVTOOLS_ATTEMPT`)
- **Severity:** `CRITICAL`
- **Penalty:** `-15 pts`
- **Trigger:** Shortcut keys `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, or window dimension variance debugger trap.

##### D. Unauthorized Clipboard Action (`CLIPBOARD_VIOLATION`)
- **Severity:** `LOW`
- **Penalty:** `-3 pts`
- **Trigger:** Intercepted `copy`, `cut`, or `paste` event.

---

### 4.4 Server-to-Extension Commands & Interventions

The Go backend forwards proctor interventions and automated locks downstream to the candidate's browser extension:

#### 4.4.1 Warning Toast Notification (`PROCTOR_WARNING`)
```json
{
  "type": "COMMAND",
  "action": "PROCTOR_WARNING",
  "timestamp": "2026-09-14T17:35:10.000Z",
  "payload": {
    "warning_title": "Integrity Warning",
    "message": "Please redirect your gaze directly to your monitor screen.",
    "issued_by": "Prof. Saurabh Tiwari (Invigilator)",
    "current_trust_score": 75
  }
}
```

#### 4.4.2 Exam Screen Lock (`LOCK_EXAM`)
Locks the candidate's view behind an overlay until re-authorized:
```json
{
  "type": "COMMAND",
  "action": "LOCK_EXAM",
  "timestamp": "2026-09-14T17:36:00.000Z",
  "payload": {
    "reason": "Excessive window blurring detected.",
    "unlock_code_required": false
  }
}
```

#### 4.4.3 Disqualification & Force Termination (`TERMINATE_EXAM`)
Immediately ends the student's exam session:
```json
{
  "type": "COMMAND",
  "action": "TERMINATE_EXAM",
  "timestamp": "2026-09-14T17:40:00.000Z",
  "payload": {
    "reason": "Severe academic dishonesty (Multiple unauthorized individuals present).",
    "final_trust_score": 38,
    "redirect_url": "https://exam.university.edu/disqualified"
  }
}
```

---

### 4.5 Session Completion

When the candidate finishes the test and clicks "Submit Exam":

```json
{
  "type": "SESSION_SUBMIT",
  "exam_id": "exam_2026_cs501",
  "session_id": "sess_cs501_stud_49_20260914",
  "student_id": "49",
  "timestamp": "2026-09-14T18:00:00.000Z",
  "payload": {
    "total_questions_answered": 50,
    "completion_status": "NORMAL"
  }
}
```

The Go server replies with `SESSION_SUBMIT_ACK`, closes the WebSocket cleanly (Code `1000`), and begins compiling the PDF audit report.

---

## 5. Invigilator Dashboard WebSocket Protocol (`/ws/invigilator`)

*Primary Implementers: **Aryan Karande** (React Dashboard), **Atharva Mandle** (Backend Fan-out).*

- **Connection URL:** `ws://localhost:8080/ws/invigilator?token=<INVIGILATOR_JWT>&exam_id=exam_2026_cs501`
- **Role:** Subscribes to the live event feed, receives updates on all candidates, and transmits invigilator interventions.

---

### 5.1 Handshake & Initial State Sync

Upon connection, the Go backend synchronizes the entire roster of candidates and active telemetry state:

#### Server Push: `INITIAL_STATE`
```json
{
  "type": "INITIAL_STATE",
  "timestamp": "2026-09-14T17:00:01.000Z",
  "payload": {
    "exam_id": "exam_2026_cs501",
    "exam_name": "CS501 - Distributed Systems End-Semester",
    "summary": {
      "total_registered": 60,
      "active_count": 56,
      "flagged_count": 3,
      "disconnected_count": 1
    },
    "candidates": [
      {
        "student_id": "49",
        "name": "Atharva Mandle",
        "trust_score": 98,
        "status": "ACTIVE",
        "last_violation": null,
        "camera_active": true,
        "microphone_active": true
      },
      {
        "student_id": "46",
        "name": "Taher Sanawadwala",
        "trust_score": 82,
        "status": "ACTIVE",
        "last_violation": "GAZE_DEVIATION",
        "camera_active": true,
        "microphone_active": true
      },
      {
        "student_id": "50",
        "name": "Anushka Patel",
        "trust_score": 54,
        "status": "FLAGGED",
        "last_violation": "MULTIPLE_FACES_DETECTED",
        "camera_active": true,
        "microphone_active": true
      },
      {
        "student_id": "52",
        "name": "Dimpal Sharma",
        "trust_score": 92,
        "status": "ACTIVE",
        "last_violation": null,
        "camera_active": true,
        "microphone_active": true
      },
      {
        "student_id": "38",
        "name": "Aryan Karande",
        "trust_score": 100,
        "status": "ACTIVE",
        "last_violation": null,
        "camera_active": true,
        "microphone_active": true
      },
      {
        "student_id": "12",
        "name": "Rohan Sharma",
        "trust_score": 42,
        "status": "FLAGGED",
        "last_violation": "TAB_SWITCH_BLUR",
        "camera_active": false,
        "microphone_active": true
      }
    ]
  }
}
```

> [!TIP]
> This schema directly hydrates Aryan's `Candidate[]` in `dashboard/src/App.tsx`!

---

### 5.2 Real-Time Incident Stream

Whenever an anomaly passes the backend sliding-window filter, the server pushes an `INCIDENT_ALERT` frame:

#### Server Broadcast: `INCIDENT_ALERT`
```json
{
  "type": "INCIDENT_ALERT",
  "payload": {
    "event_id": "evt_8a9b0c1d-2e3f-4a5b-6c7d-8890123456de",
    "student_id": "50",
    "student_name": "Anushka Patel",
    "timestamp": "17:14:22",
    "category": "VISION",
    "subtype": "MULTIPLE_FACES_DETECTED",
    "severity": "CRITICAL",
    "confidence": 0.96,
    "penalty": 15,
    "current_trust_score": 54,
    "message": "Secondary individual identified in camera viewport",
    "snapshot_url": "http://localhost:9000/examguard-evidence/evidence/2026-09-14/exam_cs501/stud_50_evt_multi.jpg"
  }
}
```

*(Directly maps to Aryan's `TelemetryEvent` and triggers the live incident ticker and the `EvidenceModal`).*

---

### 5.3 Candidate Score & Presence Updates

When a student's score updates or connection changes without a major visual incident:

#### Server Broadcast: `CANDIDATE_STATUS_UPDATE`
```json
{
  "type": "CANDIDATE_STATUS_UPDATE",
  "payload": {
    "student_id": "50",
    "trust_score": 54,
    "status": "FLAGGED",
    "last_violation": "MULTIPLE_FACES_DETECTED"
  }
}
```

#### Server Broadcast: `CANDIDATE_CONNECTION_CHANGE`
```json
{
  "type": "CANDIDATE_CONNECTION_CHANGE",
  "payload": {
    "student_id": "12",
    "status": "DISCONNECTED",
    "timestamp": "2026-09-14T17:32:00.000Z",
    "reason": "HEARTBEAT_TIMEOUT"
  }
}
```

---

### 5.4 Invigilator Actions & Interventions

When the proctor clicks "Issue Direct Proctor Warning" or "Force Lock & Terminate Exam" in `EvidenceModal.tsx`:

#### 5.4.1 Proctor Warning (Dashboard -> Server)
```json
{
  "action": "INVIGILATOR_ACTION",
  "exam_id": "exam_2026_cs501",
  "payload": {
    "action_type": "WARN",
    "student_id": "50",
    "message": "Secondary individual detected. Ensure you are alone in the room immediately."
  }
}
```

#### 5.4.2 Exam Termination (Dashboard -> Server)
```json
{
  "action": "INVIGILATOR_ACTION",
  "exam_id": "exam_2026_cs501",
  "payload": {
    "action_type": "TERMINATE",
    "student_id": "50",
    "reason": "Repeated unauthorized presence in exam room."
  }
}
```

#### Response from Server (Acknowledge Action):
```json
{
  "type": "INVIGILATOR_ACTION_ACK",
  "action_id": "act_991827364",
  "student_id": "50",
  "status": "DISPATCHED_TO_STUDENT",
  "timestamp": "2026-09-14T17:35:12.000Z"
}
```

---

## 6. Evidentiary Snapshot Pipeline (MinIO / S3)

To maintain student privacy and bandwidth efficiency:
- Raw video streams are **NEVER uploaded**.
- Snapshots are captured **ONLY upon `CRITICAL` or `HIGH` anomalies**.
- Snapshots are downscaled in-browser to max `640x360` JPEG at `quality: 0.6` (~25–35 KB).

### Workflow Diagram:

```
+------------------+         +-----------------+         +-----------------+
| Browser Ext      |         | Go Backend      |         | MinIO S3 Server |
+--------+---------+         +--------+--------+         +--------+--------+
         |                            |                           |
         | 1. Anomaly Occurs          |                           |
         | (e.g. MULTIPLE_FACES)      |                           |
         |                            |                           |
         | 2. Request Presigned URL   |                           |
         | POST /api/v1/evidence/url  |                           |
         +--------------------------->|                           |
         |                            | 3. Generate S3 PUT URL    |
         |                            | (15-min expiry)           |
         | 4. Return Presigned URL    |                           |
         |<---------------------------+                           |
         |                                                        |
         | 5. Direct HTTP PUT (JPEG binary)                       |
         +------------------------------------------------------->|
         |                                                        |
         | 6. Send WS TELEMETRY_ANOMALY (with snapshot_key)       |
         +--------------------------->|                           |
         |                            | 7. Store Key in Postgres  |
         |                            | 8. Broadcast to Dashboard |
         |                            +--------------------------> Invigilator
```

### Direct Presigned URL Generation Endpoint:
- **`POST /api/v1/evidence/presigned-url`**
- **Payload:**
  ```json
  {
    "exam_id": "exam_2026_cs501",
    "student_id": "49",
    "event_subtype": "MULTIPLE_FACES_DETECTED",
    "content_type": "image/jpeg"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "upload_url": "http://localhost:9000/examguard-evidence/evidence/2026-09-14/exam_cs501/stud_49_evt_8192.jpg?X-Amz-Algorithm=...",
    "snapshot_key": "evidence/2026-09-14/exam_cs501/stud_49_evt_8192.jpg",
    "expires_in_seconds": 900
  }
  ```

---

## 7. REST API Specification (`/api/v1`)

Base URL: `http://localhost:8080/api/v1`

---

### 7.1 Authentication & Sessions

#### 1. Candidate Login
- **Endpoint:** `POST /api/v1/auth/student/login`
- **Request Body:**
  ```json
  {
    "exam_key": "CS501-MIDTERM-2026",
    "student_id": "49",
    "secret_pin": "8492"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "expires_in": 14400,
    "student": {
      "student_id": "49",
      "name": "Atharva Mandle",
      "exam_id": "exam_2026_cs501",
      "exam_name": "CS501 - Distributed Systems"
    }
  }
  ```

#### 2. Invigilator Login
- **Endpoint:** `POST /api/v1/auth/invigilator/login`
- **Request Body:**
  ```json
  {
    "username": "prof_tiwari",
    "password": "hashed_password"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "user_id": "inv_01",
      "name": "Prof. Saurabh Tiwari",
      "role": "INVIGILATOR"
    }
  }
  ```

---

### 7.2 Exams Management

#### 1. Get Scheduled Exams
- **Endpoint:** `GET /api/v1/exams`
- **Headers:** `Authorization: Bearer <JWT>`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "exams": [
      {
        "exam_id": "exam_2026_cs501",
        "title": "CS501 - Distributed Systems",
        "start_time": "2026-09-14T17:00:00Z",
        "end_time": "2026-09-14T19:00:00Z",
        "duration_minutes": 120,
        "status": "LIVE",
        "total_students": 60
      }
    ]
  }
  ```

#### 2. Get Exam Configuration & Thresholds
- **Endpoint:** `GET /api/v1/exams/:exam_id`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "exam": {
      "exam_id": "exam_2026_cs501",
      "title": "CS501 - Distributed Systems",
      "rules": {
        "face_missing_tolerance_sec": 5.0,
        "gaze_deviation_tolerance_sec": 3.5,
        "max_tab_switches_permitted": 2,
        "disqualification_threshold": 40
      }
    }
  }
  ```

---

### 7.3 Candidates & Live Status

#### 1. List All Candidates for Exam
- **Endpoint:** `GET /api/v1/exams/:exam_id/candidates`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "total": 6,
    "candidates": [
      {
        "student_id": "49",
        "name": "Atharva Mandle",
        "trust_score": 98,
        "status": "ACTIVE",
        "last_violation": null
      },
      {
        "student_id": "50",
        "name": "Anushka Patel",
        "trust_score": 54,
        "status": "FLAGGED",
        "last_violation": "MULTIPLE_FACES_DETECTED"
      }
    ]
  }
  ```

#### 2. Get Single Candidate Profile & Timeline
- **Endpoint:** `GET /api/v1/exams/:exam_id/candidates/:student_id`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "candidate": {
      "student_id": "49",
      "name": "Atharva Mandle",
      "trust_score": 98,
      "status": "ACTIVE",
      "violations_count": 1,
      "timeline": [
        {
          "event_id": "evt_001",
          "timestamp": "2026-09-14T17:15:30Z",
          "subtype": "GAZE_DEVIATION",
          "severity": "LOW",
          "penalty": 2
        }
      ]
    }
  }
  ```

---

### 7.4 Incidents & Telemetry Logs

#### 1. Get Exam Incident Feed (Paginated)
- **Endpoint:** `GET /api/v1/exams/:exam_id/events`
- **Query Params:**
  - `page`: default `1`
  - `limit`: default `20`
  - `severity`: `LOW | MEDIUM | HIGH | CRITICAL`
  - `student_id`: string (optional)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "page": 1,
    "limit": 20,
    "total_records": 14,
    "events": [
      {
        "event_id": "evt_9834a81f-7e9b-4b26-9f1e",
        "student_id": "50",
        "timestamp": "2026-09-14T17:14:22.450Z",
        "category": "VISION",
        "subtype": "MULTIPLE_FACES_DETECTED",
        "severity": "CRITICAL",
        "confidence": 0.96,
        "message": "Additional face observed in frame",
        "snapshot_key": "evidence/2026-09-14/exam_cs501/stud_50_evt_multi.jpg"
      }
    ]
  }
  ```

#### 2. Get Single Event Details
- **Endpoint:** `GET /api/v1/events/:event_id`

---

### 7.5 Evidence & Snapshots

#### 1. Get Presigned Snapshot Download/View URL
- **Endpoint:** `GET /api/v1/events/:event_id/snapshot`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "event_id": "evt_9834a81f-7e9b-4b26-9f1e",
    "snapshot_url": "http://localhost:9000/examguard-evidence/evidence/2026-09-14/exam_cs501/stud_50_evt_multi.jpg?X-Amz-Signature=...",
    "expires_at": "2026-09-14T18:00:00Z"
  }
  ```

---

### 7.6 Invigilator Interventions (REST Fallback)

Provides REST endpoints if the invigilator dashboard needs an HTTP fallback for actions:

- **Endpoint:** `POST /api/v1/exams/:exam_id/candidates/:student_id/actions`
- **Request Body:**
  ```json
  {
    "action": "WARN | LOCK | TERMINATE",
    "message": "Custom message or warning"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "dispatched_at": "2026-09-14T17:35:15.120Z",
    "status": "DELIVERED"
  }
  ```

---

### 7.7 System Health & Metrics

#### 1. System Health Check
- **Endpoint:** `GET /api/v1/health`
- **Response (200 OK):**
  ```json
  {
    "status": "UP",
    "timestamp": "2026-09-14T17:45:00.000Z",
    "components": {
      "postgres": { "status": "UP", "latency_ms": 1.2 },
      "redis": { "status": "UP", "latency_ms": 0.5 },
      "minio": { "status": "UP", "latency_ms": 2.1 }
    }
  }
  ```

#### 2. Concurrency & Telemetry Ingestion Metrics
- **Endpoint:** `GET /api/v1/metrics`
- **Response (200 OK):**
  ```json
  {
    "active_websocket_connections": 56,
    "active_goroutines": 142,
    "events_ingested_per_second": 240.5,
    "memory_alloc_mb": 14.8
  }
  ```

---

## 8. Integrity Scoring Engine Formulation

Every student initializes with a **Trust Index of 100%**. 

### Scoring Formula:
$$\text{Trust Score} = \max\left(0, 100 - \sum_{i=1}^{N} \left( W_i \times C_i \times M_i \right)\right)$$

Where:
- $W_i$: Base penalty weight of the infraction.
- $C_i$: Edge-AI model confidence score ($0.0 \dots 1.0$). For deterministic browser events (e.g. `TAB_SWITCH`), $C_i = 1.0$.
- $M_i$: Multiplier based on repeat frequency or prolonged duration.

### Base Deduction Matrix:

| Infraction Subtype | Category | Base Penalty ($W_i$) | Auto Action Triggered |
| :--- | :--- | :---: | :--- |
| `MULTIPLE_FACES_DETECTED` | Vision | `-15 pts` | Snapshot upload + Invigilator flag |
| `FACE_NOT_DETECTED` ($> 5\text{s}$) | Vision | `-10 pts` | Snapshot upload + Candidate warning toast |
| `TAB_SWITCH_BLUR` | Environment | `-12 pts` | Screen lock modal until acknowledged |
| `FULLSCREEN_EXIT` | Environment | `-10 pts` | Fullscreen re-entry prompt |
| `DEVTOOLS_ATTEMPT` | Environment | `-15 pts` | Critical flag + Snapshot |
| `AUDIO_MULTIPLE_SPEAKERS` | Audio | `-8 pts` | Audio buffer flag |
| `GAZE_DEVIATION` ($> 3.5\text{s}$) | Vision | `-5 pts` | Warning flag if repeated $\ge 3$ times |
| `AUDIO_WHISPER` | Audio | `-3 pts` | Incident feed log |
| `CLIPBOARD_VIOLATION` | Environment | `-3 pts` | Clipboard blocked |

### Status Thresholds:
- **`ACTIVE` (Nominal / Green):** $85 \le \text{Trust Score} \le 100$
- **`ACTIVE` (Attention / Amber):** $60 \le \text{Trust Score} < 85$
- **`FLAGGED` (Violation / Red):** $\text{Trust Score} < 60$

---

## 9. Canonical Type Definitions

### 9.1 TypeScript Definitions
*(Save in `dashboard/src/types.ts` & `extension/src/types.ts`)*

```typescript
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AnomalyCategory = 'VISION' | 'AUDIO' | 'ENVIRONMENT';
export type CandidateStatus = 'ACTIVE' | 'FLAGGED' | 'DISCONNECTED';

export type AnomalySubtype =
  | 'MULTIPLE_FACES_DETECTED'
  | 'FACE_NOT_DETECTED'
  | 'GAZE_DEVIATION'
  | 'HEAD_POSE_ANOMALY'
  | 'AUDIO_MULTIPLE_SPEAKERS'
  | 'AUDIO_WHISPER'
  | 'AUDIO_VOLUME_SPIKE'
  | 'TAB_SWITCH_BLUR'
  | 'FULLSCREEN_EXIT'
  | 'DEVTOOLS_ATTEMPT'
  | 'CLIPBOARD_VIOLATION';

export interface TelemetryEvent {
  event_id: string;
  student_id: string;
  student_name?: string;
  timestamp: string;
  category?: AnomalyCategory;
  subtype: AnomalySubtype | string;
  severity: SeverityLevel;
  confidence: number;
  message: string;
  snapshot_url?: string | null;
  metrics?: Record<string, any>;
}

export interface Candidate {
  student_id: string;
  name: string;
  trust_score: number;
  status: CandidateStatus;
  last_violation?: AnomalySubtype | string;
  camera_active?: boolean;
  microphone_active?: boolean;
}

export interface InvigilatorActionPayload {
  action_type: 'WARN' | 'LOCK' | 'TERMINATE';
  student_id: string;
  message?: string;
  reason?: string;
}
```

---

### 9.2 Golang Struct Definitions
*(Save in `backend/pkg/models/telemetry.go`)*

```go
package models

import "time"

type SeverityLevel string

const (
	SeverityLow      SeverityLevel = "LOW"
	SeverityMedium   SeverityLevel = "MEDIUM"
	SeverityHigh     SeverityLevel = "HIGH"
	SeverityCritical SeverityLevel = "CRITICAL"
)

type AnomalyCategory string

const (
	CategoryVision      AnomalyCategory = "VISION"
	CategoryAudio       AnomalyCategory = "AUDIO"
	CategoryEnvironment AnomalyCategory = "ENVIRONMENT"
)

// Candidate telemetry event emitted by browser extension
type TelemetryEvent struct {
	Type        string                 `json:"type"`
	EventID     string                 `json:"event_id"`
	ExamID      string                 `json:"exam_id"`
	SessionID   string                 `json:"session_id"`
	StudentID   string                 `json:"student_id"`
	Timestamp   time.Time              `json:"timestamp"`
	Category    AnomalyCategory        `json:"category"`
	Subtype     string                 `json:"subtype"`
	Severity    SeverityLevel          `json:"severity"`
	Confidence  float64                `json:"confidence"`
	Metrics     map[string]interface{} `json:"metrics,omitempty"`
	SnapshotKey *string                `json:"snapshot_key,omitempty"`
	Message     string                 `json:"message"`
}

// Candidate representation for invigilator dashboard
type Candidate struct {
	StudentID        string    `json:"student_id"`
	Name             string    `json:"name"`
	TrustScore       int       `json:"trust_score"`
	Status           string    `json:"status"` // ACTIVE, FLAGGED, DISCONNECTED
	LastViolation    *string   `json:"last_violation,omitempty"`
	CameraActive     bool      `json:"camera_active"`
	MicrophoneActive bool      `json:"microphone_active"`
	LastSeen         time.Time `json:"last_seen"`
}

// Outbound alert broadcast to dashboard
type IncidentAlert struct {
	Type    string         `json:"type"` // "INCIDENT_ALERT"
	Payload TelemetryEvent `json:"payload"`
}
```

---

## 10. Developer Testing & Verification Recipes

### 10.1 Testing Telemetry Ingest in Chrome DevTools Console

Any team member can open the Chrome console and simulate a candidate's extension sending telemetry events:

```javascript
// Paste into Chrome DevTools Console:
const ws = new WebSocket("ws://localhost:8080/ws/telemetry?token=dev_token&exam_id=exam_2026_cs501");

ws.onopen = () => {
  console.log("🚀 Connected to Go Backend Telemetry Gateway");
  
  // 1. Send Handshake
  ws.send(JSON.stringify({
    type: "SESSION_INIT",
    event_id: "init_" + Date.now(),
    exam_id: "exam_2026_cs501",
    student_id: "49",
    timestamp: new Date().toISOString(),
    payload: { client_version: "1.0.0" }
  }));
};

ws.onmessage = (msg) => {
  console.log("📥 Received from Backend:", JSON.parse(msg.data));
};

// 2. Simulate High-Severity Multi-Face Violation after 3 seconds:
setTimeout(() => {
  ws.send(JSON.stringify({
    type: "TELEMETRY_ANOMALY",
    event_id: "evt_" + Math.random().toString(36).substr(2, 9),
    exam_id: "exam_2026_cs501",
    session_id: "sess_cs501_stud_49_20260914",
    student_id: "49",
    timestamp: new Date().toISOString(),
    category: "VISION",
    subtype: "MULTIPLE_FACES_DETECTED",
    severity: "CRITICAL",
    confidence: 0.97,
    metrics: { faces_detected: 2 },
    snapshot_key: null,
    message: "Secondary individual identified in camera viewport"
  }));
}, 3000);
```

### 10.2 Testing Invigilator Dashboard WebSocket Stream

```javascript
// Paste into Chrome DevTools Console to act as Invigilator:
const invWs = new WebSocket("ws://localhost:8080/ws/invigilator?token=inv_token&exam_id=exam_2026_cs501");

invWs.onopen = () => console.log("🚀 Connected as Invigilator Monitor");
invWs.onmessage = (msg) => console.log("🚨 Dashboard Live Alert:", JSON.parse(msg.data));

// Simulate proctor warning:
function sendWarning(studentId, msgText) {
  invWs.send(JSON.stringify({
    action: "INVIGILATOR_ACTION",
    exam_id: "exam_2026_cs501",
    payload: {
      action_type: "WARN",
      student_id: studentId,
      message: msgText
    }
  }));
}
```

### 10.3 Quick cURL API Tests

```bash
# 1. Check Backend Health
curl -X GET http://localhost:8080/api/v1/health

# 2. Get Candidates Roster
curl -X GET http://localhost:8080/api/v1/exams/exam_2026_cs501/candidates \
  -H "Authorization: Bearer <TOKEN>"

# 3. Request Presigned Snapshot URL
curl -X POST http://localhost:8080/api/v1/evidence/presigned-url \
  -H "Content-Type: application/json" \
  -d '{"exam_id":"exam_2026_cs501","student_id":"49","event_subtype":"MULTIPLE_FACES_DETECTED"}'
```

---

<div align="center">
  <sub>ExamGuard (ProctorSentinel) Architecture Team &copy; 2026 — Department of AI & Cyber Security, Ramdeobaba University</sub>
</div>

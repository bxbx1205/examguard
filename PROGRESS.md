# 🛡️ ExamGuard — Backend Development Progress

> **Last Updated:** 28 September 2026  
> **Go Version:** `1.26.0` | **Build Status:** ✅ Passing | **Vet Status:** ✅ Clean

---

## 📊 Overview

| Metric | Value |
|:-------|:------|
| **Total Features** | 41 |
| **Completed** | 41 ✅ |
| **In Progress** | 0 |
| **Remaining** | 4 (enhancement / hardening) |
| **Source Files** | 13 Go files |
| **Lines of Code** | ~2,400 |

---

## ✅ Phase 1: Foundation & Core Infrastructure

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 1 | Project scaffolding (`cmd/server/main.go`) | ✅ Done | `cmd/server/main.go` |
| 2 | Configuration management (env vars from `docker-compose.yml`) | ✅ Done | `internal/config/config.go` |
| 3 | PostgreSQL connection pool + 6-table schema migration | ✅ Done | `internal/storage/postgres.go` |
| 4 | Redis client (pooled, retry logic) | ✅ Done | `internal/storage/redis.go` |
| 5 | MinIO S3 client + auto-bucket creation | ✅ Done | `internal/storage/minio.go` |
| 6 | Gin HTTP server + CORS + graceful shutdown | ✅ Done | `cmd/server/main.go` |
| 7 | Health check (`GET /api/v1/health`) | ✅ Done | `internal/api/handlers.go` |
| 8 | Metrics endpoint (`GET /api/v1/metrics`) | ✅ Done | `internal/api/handlers.go` |
| 9 | Demo data seeding (1 exam, 6 students, 1 invigilator) | ✅ Done | `cmd/server/main.go` |

---

## ✅ Phase 2: Authentication & JWT

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 10 | JWT generation & validation (HMAC-SHA256) | ✅ Done | `internal/auth/jwt.go` |
| 11 | Student login (`POST /api/v1/auth/student/login`) | ✅ Done | `internal/api/handlers.go` |
| 12 | Invigilator login (`POST /api/v1/auth/invigilator/login`) | ✅ Done | `internal/api/handlers.go` |
| 13 | Bearer token auth middleware for REST routes | ✅ Done | `internal/auth/middleware.go` |

---

## ✅ Phase 3: Candidate WebSocket (`/ws/telemetry`)

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 14 | WebSocket upgrade + JWT query-param auth + `dev_token` fallback | ✅ Done | `internal/api/handlers.go` |
| 15 | `SESSION_INIT` handshake → `SESSION_INIT_ACK` response | ✅ Done | `internal/concurrency/session_manager.go` |
| 16 | Heartbeat Ping/Pong (5s interval, 3-miss → DISCONNECTED) | ✅ Done | `internal/concurrency/session_manager.go` |
| 17 | `TELEMETRY_ANOMALY` event ingestion + scoring + DB persist | ✅ Done | `internal/concurrency/session_manager.go` |
| 18 | `SESSION_SUBMIT` + `SESSION_SUBMIT_ACK` | ✅ Done | `internal/concurrency/session_manager.go` |
| 19 | Server→Extension: `PROCTOR_WARNING`, `LOCK_EXAM`, `TERMINATE_EXAM` | ✅ Done | `internal/concurrency/session_manager.go` |

---

## ✅ Phase 4: Invigilator WebSocket (`/ws/invigilator`)

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 20 | WebSocket upgrade + JWT auth + `inv_token` fallback | ✅ Done | `internal/api/handlers.go` |
| 21 | `INITIAL_STATE` sync on connect (full roster + summary) | ✅ Done | `internal/api/handlers.go` |
| 22 | `INCIDENT_ALERT` broadcast fan-out to all dashboards | ✅ Done | `internal/concurrency/invigilator_hub.go` |
| 23 | `CANDIDATE_STATUS_UPDATE` real-time push | ✅ Done | `internal/concurrency/session_manager.go` |
| 24 | `CANDIDATE_CONNECTION_CHANGE` on disconnect | ✅ Done | `internal/concurrency/session_manager.go` |
| 25 | Invigilator actions (WARN / LOCK / TERMINATE) → route to student | ✅ Done | `internal/api/handlers.go` |
| 26 | `INVIGILATOR_ACTION_ACK` response | ✅ Done | `internal/api/handlers.go` |

---

## ✅ Phase 5: Concurrency Engine & Scoring

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 27 | Session Manager — dedicated goroutine per student | ✅ Done | `internal/concurrency/session_manager.go` |
| 28 | Buffered channels for async event processing | ✅ Done | `internal/concurrency/session_manager.go` |
| 29 | Trust Score Engine: `Penalty = W × C × M` | ✅ Done | `internal/scoring/engine.go` |
| 30 | Redis session presence with heartbeat TTL refresh | ✅ Done | `internal/concurrency/session_manager.go` |
| 31 | Auto-flag at score < 60 (`FLAGGED` status) | ✅ Done | `internal/scoring/engine.go` |
| 32 | Repetition multiplier (+0.25 per repeat of same subtype) | ✅ Done | `internal/scoring/engine.go` |

### Base Penalty Weights Implemented

| Subtype | Base Weight |
|:--------|:-----------:|
| `MULTIPLE_FACES_DETECTED` | -15 pts |
| `FACE_NOT_DETECTED` | -10 pts |
| `TAB_SWITCH_BLUR` | -12 pts |
| `FULLSCREEN_EXIT` | -10 pts |
| `DEVTOOLS_ATTEMPT` | -15 pts |
| `AUDIO_MULTIPLE_SPEAKERS` | -8 pts |
| `GAZE_DEVIATION` | -5 pts |
| `HEAD_POSE_ANOMALY` | -5 pts |
| `AUDIO_WHISPER` | -3 pts |
| `CLIPBOARD_VIOLATION` | -3 pts |

---

## ✅ Phase 6: REST API — Exams & Candidates

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 33 | `GET /api/v1/exams` — list all exams | ✅ Done | `internal/api/handlers.go` |
| 34 | `GET /api/v1/exams/:exam_id` — exam details + rules | ✅ Done | `internal/api/handlers.go` |
| 35 | `GET /api/v1/exams/:exam_id/candidates` — candidate roster | ✅ Done | `internal/api/handlers.go` |
| 36 | `GET /api/v1/exams/:exam_id/candidates/:student_id` — profile + timeline | ✅ Done | `internal/api/handlers.go` |
| 37 | `GET /api/v1/exams/:exam_id/events` — paginated incident feed | ✅ Done | `internal/api/handlers.go` |
| 38 | `GET /api/v1/events/:event_id` — single event details | ✅ Done | `internal/api/handlers.go` |

---

## ✅ Phase 7: Evidence & Snapshot Pipeline

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 39 | `POST /api/v1/evidence/presigned-url` — S3 presigned upload URL | ✅ Done | `internal/api/handlers.go` |
| 40 | `GET /api/v1/events/:event_id/snapshot` — presigned download URL | ✅ Done | `internal/api/handlers.go` |
| 41 | MinIO bucket auto-creation on startup | ✅ Done | `internal/storage/minio.go` |

---

## ✅ Phase 8: Invigilator Intervention REST Fallback

| # | Feature | Status | File |
|:--|:--------|:------:|:-----|
| 42 | `POST /api/v1/exams/:exam_id/candidates/:student_id/actions` | ✅ Done | `internal/api/handlers.go` |

---

## 🗄️ Database Schema (Auto-Migrated on Startup)

| Table | Purpose |
|:------|:--------|
| `exams` | Scheduled exams with rules (JSONB), timing, status |
| `students` | Registered candidates per exam (`student_id + exam_id` composite PK) |
| `sessions` | Active session tracking with trust scores and status |
| `events` | All telemetry anomaly event logs with metrics (JSONB) |
| `invigilators` | Invigilator user accounts |
| `actions` | Audit trail of invigilator interventions |

---

## 📁 File Structure

```
backend/
├── cmd/
│   └── server/
│       └── main.go              # Entry point, wiring, graceful shutdown, seed data
├── internal/
│   ├── api/
│   │   ├── handlers.go          # All REST + WebSocket route handlers
│   │   └── handlers_test.go     # Route tests, auth protection, login validation, metrics
│   ├── auth/
│   │   ├── jwt.go               # JWT generation & validation (HMAC-SHA256)
│   │   ├── jwt_test.go          # Token lifecycle, claims, expiration, forgery tests
│   │   ├── middleware.go        # Gin Bearer token middleware
│   │   └── middleware_test.go   # Middleware scheme, header, claims injection tests
│   ├── concurrency/
│   │   ├── session_manager.go   # Goroutine-per-student session management
│   │   ├── session_manager_test.go # Non-blocking send, command dispatch, query tests
│   │   ├── invigilator_hub.go   # Fan-out broadcaster to dashboard WebSockets
│   │   └── invigilator_hub_test.go # Register, unregister, exam filtering, loop tests
│   ├── config/
│   │   ├── config.go            # Environment variable configuration
│   │   └── config_test.go       # Default values, env overrides, DSN generation tests
│   ├── scoring/
│   │   ├── engine.go            # Trust score engine (W × C × M formula)
│   │   └── engine_test.go       # Penalty subtypes, repetition multiplier, threshold tests
│   └── storage/
│       ├── postgres.go          # PostgreSQL pool + schema migration
│       ├── redis.go             # Redis client with retry logic
│       ├── minio.go             # MinIO S3 client + auto-bucket creation
│       └── storage_test.go      # DSN config validation tests
├── pkg/
│   └── models/
│       ├── telemetry.go         # Shared domain types & constants
│       └── telemetry_test.go    # JSON serialization, enum constants, payload tests
├── Dockerfile                   # Multi-stage build (golang:1.26-alpine → alpine:3.20)
├── go.mod
└── go.sum
```

---

## 🧪 Unit Testing Suite (Completed)

Comprehensive unit test coverage across all internal and shared packages:

| Package | Test File | Test Scenarios Covered |
|:---|:---|:---|
| `internal/scoring` | `engine_test.go` | Table-driven tests for all 5 anomaly subtypes, repetition multiplier compounding, zero floor enforcement, active/flagged score thresholds, auto-session initialization, removal. |
| `internal/auth` | `jwt_test.go`, `middleware_test.go` | Student & invigilator token generation, signature validation, tamper/garbage rejection, expiration checks, Gin Bearer header validation, claims context propagation. |
| `internal/config` | `config_test.go` | Default settings, environment variable overrides, non-numeric port fallbacks, DSN construction for local & Docker Compose. |
| `internal/concurrency` | `invigilator_hub_test.go`, `session_manager_test.go` | Live WebSocket pair registration/unregistration, exam-specific fanout isolation, full-buffer non-blocking drops, broadcast loop, session candidate queries, command dispatch. |
| `internal/api` | `handlers_test.go` | System metrics endpoint, WebSocket origin policy, request validation for student and invigilator logins, 401 unauthorized checks across all protected routes. |
| `internal/storage` | `storage_test.go` | Postgres connection string parsing and malformed port handling. |
| `pkg/models` | `telemetry_test.go` | JSON marshaling/unmarshaling, optional field omitempty behaviors, enum constants for severity, categories, and statuses. |

---

## 🔶 Future Enhancements (Not in MVP)

| Feature | Priority | Notes |
|:--------|:--------:|:------|
| PDF Report Generation (`internal/reporting/`) | Medium | Post-exam audit trail compilation |
| Bcrypt password hashing | High | Currently plain-text for development |
| Integration tests with Testcontainers | Medium | Automated containerized Postgres/Redis spin-up for CI/CD |
| Rate limiting middleware | Low | Prevent abuse on public endpoints |

---

## 🧪 Quick Verification

```bash
# Run all unit tests
cd backend && go test ./... -v -count=1

# Build
go build ./...

# Vet
go vet ./...

# Run locally (needs Postgres, Redis, MinIO via Docker)
docker compose up -d postgres redis minio
go run cmd/server/main.go

# Run full stack
docker compose up -d --build
```

---

> **Author:** Atharva Mandle (Roll #49) — System Architecture & Go Backend  
> **Project:** ProctorSentinel (ExamGuard) — Ramdeobaba University, IDEA Lab


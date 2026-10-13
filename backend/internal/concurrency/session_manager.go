package concurrency

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"examguard-backend/internal/scoring"
	"examguard-backend/pkg/models"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const (
	heartbeatInterval = 5 * time.Second
	heartbeatMisses   = 3
	heartbeatTimeout  = heartbeatInterval * heartbeatMisses
	writeWait         = 10 * time.Second
	maxMessageSize    = 64 * 1024 // 64 KB
)

// SessionManager manages all active candidate WebSocket sessions.
type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*CandidateSession // key: session_id

	pool    *pgxpool.Pool
	rdb     *redis.Client
	scoring *scoring.Engine

	// Channel for broadcasting incidents to invigilator hub
	IncidentChan chan IncidentBroadcast
}

// CandidateSession represents a single student's active WebSocket connection.
type CandidateSession struct {
	SessionID   string
	ExamID      string
	StudentID   string
	StudentName string
	Conn        *websocket.Conn

	// Channels
	SendChan     chan []byte
	lastPingTime time.Time
	mu           sync.Mutex
	closed       bool
}

// IncidentBroadcast wraps an incident alert with routing metadata.
type IncidentBroadcast struct {
	ExamID string
	Alert  interface{}
}

// NewSessionManager creates a new SessionManager.
func NewSessionManager(pool *pgxpool.Pool, rdb *redis.Client, scorer *scoring.Engine) *SessionManager {
	return &SessionManager{
		sessions:     make(map[string]*CandidateSession),
		pool:         pool,
		rdb:          rdb,
		scoring:      scorer,
		IncidentChan: make(chan IncidentBroadcast, 1000),
	}
}

// RegisterSession registers a new candidate session and starts its goroutines.
func (sm *SessionManager) RegisterSession(ctx context.Context, conn *websocket.Conn, sessionID, examID, studentID, studentName string, clientInfo json.RawMessage) {
	session := &CandidateSession{
		SessionID:    sessionID,
		ExamID:       examID,
		StudentID:    studentID,
		StudentName:  studentName,
		Conn:         conn,
		SendChan:     make(chan []byte, 256),
		lastPingTime: time.Now(),
	}

	sm.mu.Lock()
	sm.sessions[sessionID] = session
	sm.mu.Unlock()

	// Initialize trust score for this session
	sm.scoring.InitSession(sessionID)

	// Persist session to database
	sm.persistSessionStart(ctx, sessionID, examID, studentID, clientInfo)

	// Set presence in Redis with TTL
	sm.rdb.Set(ctx, fmt.Sprintf("session:%s:presence", sessionID), "ACTIVE", heartbeatTimeout+5*time.Second)
	sm.rdb.Set(ctx, fmt.Sprintf("student:%s:%s:session", examID, studentID), sessionID, 0)

	log.Printf("[session] registered: session=%s student=%s exam=%s", sessionID, studentID, examID)

	// Send SESSION_INIT_ACK
	ack := map[string]interface{}{
		"type":       "SESSION_INIT_ACK",
		"session_id": sessionID,
		"student_id": studentID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
		"payload": map[string]interface{}{
			"status":                "INITIALIZED",
			"initial_trust_score":   100,
			"heartbeat_interval_ms": 5000,
			"rules": map[string]interface{}{
				"face_missing_tolerance_sec":    5,
				"gaze_deviation_tolerance_sec":  3.5,
				"capture_snapshots_on_severity": []string{"HIGH", "CRITICAL"},
			},
		},
	}
	ackBytes, _ := json.Marshal(ack)
	session.Send(ackBytes)

	// Broadcast new connection to invigilator
	sm.broadcastCandidateStatusUpdate(examID, studentID, studentName, 100, "ACTIVE", "", true, true)

	// Start dedicated goroutines for this session
	go sm.readPump(ctx, session)
	go sm.writePump(session)
	go sm.heartbeatMonitor(ctx, session)
}

// readPump reads messages from the candidate's WebSocket connection.
func (sm *SessionManager) readPump(ctx context.Context, s *CandidateSession) {
	defer sm.RemoveSession(ctx, s.SessionID, "READ_PUMP_EXIT")

	s.Conn.SetReadLimit(maxMessageSize)

	for {
		_, message, err := s.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[session] read error session=%s: %v", s.SessionID, err)
			}
			return
		}

		sm.handleMessage(ctx, s, message)
	}
}

// writePump writes queued messages to the candidate's WebSocket connection.
func (sm *SessionManager) writePump(s *CandidateSession) {
	for msg := range s.SendChan {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return
		}
		s.Conn.SetWriteDeadline(time.Now().Add(writeWait))
		err := s.Conn.WriteMessage(websocket.TextMessage, msg)
		s.mu.Unlock()

		if err != nil {
			log.Printf("[session] write error session=%s: %v", s.SessionID, err)
			return
		}
	}
}

// heartbeatMonitor checks for missed heartbeats and disconnects stale sessions.
func (sm *SessionManager) heartbeatMonitor(ctx context.Context, s *CandidateSession) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return
		}
		elapsed := time.Since(s.lastPingTime)
		s.mu.Unlock()

		if elapsed > heartbeatTimeout {
			log.Printf("[session] heartbeat timeout session=%s student=%s (last ping %v ago)", s.SessionID, s.StudentID, elapsed)
			sm.RemoveSession(ctx, s.SessionID, "HEARTBEAT_TIMEOUT")
			return
		}

		// Refresh Redis presence TTL
		sm.rdb.Expire(ctx, fmt.Sprintf("session:%s:presence", s.SessionID), heartbeatTimeout+5*time.Second)
	}
}

// handleMessage processes an incoming WebSocket message from a candidate.
func (sm *SessionManager) handleMessage(ctx context.Context, s *CandidateSession, raw []byte) {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		log.Printf("[session] invalid JSON from session=%s: %v", s.SessionID, err)
		return
	}

	switch envelope.Type {
	case "HEARTBEAT_PING":
		sm.handleHeartbeat(s)

	case "TELEMETRY_ANOMALY":
		sm.handleTelemetry(ctx, s, raw)

	case "SESSION_SUBMIT":
		sm.handleSessionSubmit(ctx, s, raw)

	default:
		log.Printf("[session] unknown message type %q from session=%s", envelope.Type, s.SessionID)
	}
}

// handleHeartbeat responds to a heartbeat ping with a pong.
func (sm *SessionManager) handleHeartbeat(s *CandidateSession) {
	s.mu.Lock()
	s.lastPingTime = time.Now()
	s.mu.Unlock()

	pong := map[string]interface{}{
		"type":      "HEARTBEAT_PONG",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	pongBytes, _ := json.Marshal(pong)
	s.Send(pongBytes)
}

// handleTelemetry processes an anomaly telemetry event.
func (sm *SessionManager) handleTelemetry(ctx context.Context, s *CandidateSession, raw []byte) {
	var event models.TelemetryEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		log.Printf("[session] invalid telemetry from session=%s: %v", s.SessionID, err)
		return
	}

	// Override session/exam IDs to prevent spoofing
	event.SessionID = s.SessionID
	event.ExamID = s.ExamID
	event.StudentID = s.StudentID

	// Score the event
	penalty, newScore := sm.scoring.ProcessEvent(s.SessionID, event)

	// Determine new status
	var status string
	if newScore < 60 {
		status = "FLAGGED"
	} else {
		status = "ACTIVE"
	}

	// Persist event to database
	sm.persistEvent(ctx, event, penalty)

	// Update session trust score in database
	sm.updateSessionScore(ctx, s.SessionID, newScore, status, event.Subtype)

	log.Printf("[scoring] session=%s subtype=%s penalty=%.2f newScore=%d status=%s",
		s.SessionID, event.Subtype, penalty, newScore, status)

	// Broadcast INCIDENT_ALERT to invigilator hub
	alert := map[string]interface{}{
		"type": "INCIDENT_ALERT",
		"payload": map[string]interface{}{
			"event_id":            event.EventID,
			"student_id":          s.StudentID,
			"student_name":        s.StudentName,
			"timestamp":          event.Timestamp.Format("15:04:05"),
			"category":           string(event.Category),
			"subtype":            event.Subtype,
			"severity":           string(event.Severity),
			"confidence":         event.Confidence,
			"penalty":            penalty,
			"current_trust_score": newScore,
			"message":            event.Message,
			"snapshot_url":       sm.snapshotURL(event.SnapshotKey),
		},
	}
	sm.IncidentChan <- IncidentBroadcast{ExamID: s.ExamID, Alert: alert}

	// Broadcast candidate status update
	sm.broadcastCandidateStatusUpdate(s.ExamID, s.StudentID, s.StudentName, newScore, status, event.Subtype, true, true)
}

// handleSessionSubmit processes a candidate exam submission.
func (sm *SessionManager) handleSessionSubmit(ctx context.Context, s *CandidateSession, raw []byte) {
	log.Printf("[session] candidate submitted exam: session=%s student=%s", s.SessionID, s.StudentID)

	// Send ACK
	ack := map[string]interface{}{
		"type":       "SESSION_SUBMIT_ACK",
		"session_id": s.SessionID,
		"student_id": s.StudentID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
		"payload": map[string]interface{}{
			"final_trust_score": sm.scoring.GetScore(s.SessionID),
			"status":            "SUBMITTED",
		},
	}
	ackBytes, _ := json.Marshal(ack)
	s.Send(ackBytes)

	// Close the session cleanly
	sm.RemoveSession(ctx, s.SessionID, "SUBMITTED")
}

// SendCommand sends a command (warning/lock/terminate) to a specific candidate.
func (sm *SessionManager) SendCommand(examID, studentID string, command interface{}) error {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	for _, s := range sm.sessions {
		if s.ExamID == examID && s.StudentID == studentID {
			cmdBytes, err := json.Marshal(command)
			if err != nil {
				return err
			}
			s.Send(cmdBytes)
			return nil
		}
	}
	return fmt.Errorf("no active session for student %s in exam %s", studentID, examID)
}

// RemoveSession disconnects and cleans up a candidate session.
func (sm *SessionManager) RemoveSession(ctx context.Context, sessionID, reason string) {
	sm.mu.Lock()
	s, exists := sm.sessions[sessionID]
	if !exists {
		sm.mu.Unlock()
		return
	}
	delete(sm.sessions, sessionID)
	sm.mu.Unlock()

	s.mu.Lock()
	if !s.closed {
		s.closed = true
		close(s.SendChan)
		s.Conn.Close()
	}
	s.mu.Unlock()

	// Clean up Redis presence
	sm.rdb.Del(ctx, fmt.Sprintf("session:%s:presence", sessionID))

	// Update database
	sm.updateSessionEnd(ctx, sessionID)

	// Broadcast disconnection to invigilator
	if reason == "HEARTBEAT_TIMEOUT" || reason == "READ_PUMP_EXIT" {
		change := map[string]interface{}{
			"type": "CANDIDATE_CONNECTION_CHANGE",
			"payload": map[string]interface{}{
				"student_id": s.StudentID,
				"status":     "DISCONNECTED",
				"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
				"reason":     reason,
			},
		}
		sm.IncidentChan <- IncidentBroadcast{ExamID: s.ExamID, Alert: change}
	}

	sm.scoring.RemoveSession(sessionID)
	log.Printf("[session] removed: session=%s reason=%s", sessionID, reason)
}

// GetActiveSessions returns the count of active sessions.
func (sm *SessionManager) GetActiveSessions() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.sessions)
}

// GetCandidatesForExam returns all active candidate info for a given exam.
func (sm *SessionManager) GetCandidatesForExam(examID string) []models.Candidate {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	var candidates []models.Candidate
	for _, s := range sm.sessions {
		if s.ExamID == examID {
			score := sm.scoring.GetScore(s.SessionID)
			status := sm.scoring.GetStatus(s.SessionID)
			var lastViolation *string
			// Get last violation from the scoring record if available
			c := models.Candidate{
				StudentID:        s.StudentID,
				Name:             s.StudentName,
				TrustScore:       score,
				Status:           status,
				LastViolation:    lastViolation,
				CameraActive:     true,
				MicrophoneActive: true,
				LastSeen:         s.lastPingTime,
			}
			candidates = append(candidates, c)
		}
	}
	return candidates
}

// Send queues a message to be sent to the candidate's WebSocket.
func (s *CandidateSession) Send(msg []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		select {
		case s.SendChan <- msg:
		default:
			log.Printf("[session] send channel full, dropping message for session=%s", s.SessionID)
		}
	}
}

// broadcastCandidateStatusUpdate sends a status update to the invigilator hub.
func (sm *SessionManager) broadcastCandidateStatusUpdate(examID, studentID, studentName string, score int, status, lastViolation string, cameraActive, micActive bool) {
	update := map[string]interface{}{
		"type": "CANDIDATE_STATUS_UPDATE",
		"payload": map[string]interface{}{
			"student_id":        studentID,
			"name":              studentName,
			"trust_score":       score,
			"status":            status,
			"last_violation":    lastViolation,
			"camera_active":     cameraActive,
			"microphone_active": micActive,
		},
	}
	sm.IncidentChan <- IncidentBroadcast{ExamID: examID, Alert: update}
}

// snapshotURL converts a snapshot key to a full MinIO URL.
func (sm *SessionManager) snapshotURL(key *string) interface{} {
	if key == nil || *key == "" {
		return nil
	}
	return fmt.Sprintf("http://localhost:9000/examguard-evidence/%s", *key)
}

// ---- Database persistence helpers ----

func (sm *SessionManager) persistSessionStart(ctx context.Context, sessionID, examID, studentID string, clientInfo json.RawMessage) {
	_, err := sm.pool.Exec(ctx,
		`INSERT INTO sessions (session_id, exam_id, student_id, trust_score, status, client_info, camera_active, mic_active)
		 VALUES ($1, $2, $3, 100, 'ACTIVE', $4, true, true)
		 ON CONFLICT (session_id) DO UPDATE SET status = 'ACTIVE', camera_active = true, mic_active = true`,
		sessionID, examID, studentID, clientInfo,
	)
	if err != nil {
		log.Printf("[db] persist session start error: %v", err)
	}
}

func (sm *SessionManager) persistEvent(ctx context.Context, event models.TelemetryEvent, penalty float64) {
	metricsJSON, _ := json.Marshal(event.Metrics)
	var snapshotKey *string
	if event.SnapshotKey != nil {
		snapshotKey = event.SnapshotKey
	}
	_, err := sm.pool.Exec(ctx,
		`INSERT INTO events (event_id, session_id, exam_id, student_id, timestamp, category, subtype, severity, confidence, metrics, snapshot_key, message, penalty)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		 ON CONFLICT (event_id) DO NOTHING`,
		event.EventID, event.SessionID, event.ExamID, event.StudentID,
		event.Timestamp, string(event.Category), event.Subtype, string(event.Severity),
		event.Confidence, metricsJSON, snapshotKey, event.Message, penalty,
	)
	if err != nil {
		log.Printf("[db] persist event error: %v", err)
	}
}

func (sm *SessionManager) updateSessionScore(ctx context.Context, sessionID string, score int, status, lastViolation string) {
	_, err := sm.pool.Exec(ctx,
		`UPDATE sessions SET trust_score = $1, status = $2, last_violation = $3 WHERE session_id = $4`,
		score, status, lastViolation, sessionID,
	)
	if err != nil {
		log.Printf("[db] update session score error: %v", err)
	}
}

func (sm *SessionManager) updateSessionEnd(ctx context.Context, sessionID string) {
	_, err := sm.pool.Exec(ctx,
		`UPDATE sessions SET ended_at = NOW(), status = 'DISCONNECTED', camera_active = false, mic_active = false WHERE session_id = $1`, sessionID,
	)
	if err != nil {
		log.Printf("[db] update session end error: %v", err)
	}
}

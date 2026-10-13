package concurrency

import (
	"encoding/json"
	"testing"
	"time"

	"examguard-backend/internal/scoring"
	"examguard-backend/pkg/models"
)

func TestCandidateSession_Send(t *testing.T) {
	session := &CandidateSession{
		SessionID: "sess-test-1",
		SendChan:  make(chan []byte, 2),
	}

	// Normal send
	msg1 := []byte("hello")
	session.Send(msg1)

	select {
	case received := <-session.SendChan:
		if string(received) != "hello" {
			t.Errorf("expected hello, got %s", string(received))
		}
	default:
		t.Fatal("expected message in SendChan")
	}

	// Buffer full - should drop message without blocking
	session.Send([]byte("msg1"))
	session.Send([]byte("msg2"))

	done := make(chan bool)
	go func() {
		session.Send([]byte("msg3_dropped"))
		done <- true
	}()

	select {
	case <-done:
		// success: did not block on full channel
	case <-time.After(500 * time.Millisecond):
		t.Fatal("session.Send blocked on full channel")
	}

	// Closed session send - should not panic
	session.mu.Lock()
	session.closed = true
	session.mu.Unlock()

	session.Send([]byte("msg_after_close"))
}

func TestSessionManager_SnapshotURL(t *testing.T) {
	sm := &SessionManager{}

	// nil key
	if res := sm.snapshotURL(nil); res != nil {
		t.Errorf("expected nil for nil key, got %v", res)
	}

	// empty key
	emptyKey := ""
	if res := sm.snapshotURL(&emptyKey); res != nil {
		t.Errorf("expected nil for empty key, got %v", res)
	}

	// valid key
	key := "2026-09-28/student1_face.jpg"
	expectedURL := "http://localhost:9000/examguard-evidence/2026-09-28/student1_face.jpg"
	res := sm.snapshotURL(&key)
	if resStr, ok := res.(string); !ok || resStr != expectedURL {
		t.Errorf("expected %s, got %v", expectedURL, res)
	}
}

func TestSessionManager_SendCommand(t *testing.T) {
	sm := &SessionManager{
		sessions: make(map[string]*CandidateSession),
	}

	sess := &CandidateSession{
		SessionID: "sess-100",
		ExamID:    "exam-A",
		StudentID: "stud-A",
		SendChan:  make(chan []byte, 5),
	}
	sm.sessions[sess.SessionID] = sess

	cmd := models.InvigilatorAction{
		ActionType: "WARN",
		StudentID:  "stud-A",
		Message:    "Face not visible",
	}

	// Successful send
	err := sm.SendCommand("exam-A", "stud-A", cmd)
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	select {
	case data := <-sess.SendChan:
		var parsed models.InvigilatorAction
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("failed to parse sent command: %v", err)
		}
		if parsed.ActionType != "WARN" || parsed.Message != "Face not visible" {
			t.Errorf("unexpected command payload: %+v", parsed)
		}
	default:
		t.Fatal("expected command in SendChan")
	}

	// Non-existent student / wrong exam
	err = sm.SendCommand("exam-A", "non-existent-student", cmd)
	if err == nil {
		t.Fatal("expected error for non-existent student, got nil")
	}

	err = sm.SendCommand("wrong-exam", "stud-A", cmd)
	if err == nil {
		t.Fatal("expected error for wrong exam, got nil")
	}
}

func TestSessionManager_GetActiveSessionsAndGetCandidatesForExam(t *testing.T) {
	scorer := scoring.NewEngine()
	sm := &SessionManager{
		sessions: make(map[string]*CandidateSession),
		scoring:  scorer,
	}

	if sm.GetActiveSessions() != 0 {
		t.Fatalf("expected 0 active sessions, got %d", sm.GetActiveSessions())
	}

	// Register 2 sessions for exam-1 and 1 for exam-2
	s1 := &CandidateSession{
		SessionID:   "sess-1",
		ExamID:      "exam-1",
		StudentID:   "stud-1",
		StudentName: "Candidate One",
	}
	s2 := &CandidateSession{
		SessionID:   "sess-2",
		ExamID:      "exam-1",
		StudentID:   "stud-2",
		StudentName: "Candidate Two",
	}
	s3 := &CandidateSession{
		SessionID:   "sess-3",
		ExamID:      "exam-2",
		StudentID:   "stud-3",
		StudentName: "Candidate Three",
	}

	sm.sessions[s1.SessionID] = s1
	sm.sessions[s2.SessionID] = s2
	sm.sessions[s3.SessionID] = s3

	scorer.InitSession("sess-1")
	scorer.InitSession("sess-2")
	scorer.InitSession("sess-3")

	// Trigger a violation on sess-2 to lower score
	scorer.ProcessEvent("sess-2", models.TelemetryEvent{
		Subtype:    "MULTIPLE_FACES_DETECTED",
		Confidence: 1.0,
	})

	if sm.GetActiveSessions() != 3 {
		t.Fatalf("expected 3 active sessions, got %d", sm.GetActiveSessions())
	}

	// Check candidates for exam-1
	candidates1 := sm.GetCandidatesForExam("exam-1")
	if len(candidates1) != 2 {
		t.Fatalf("expected 2 candidates for exam-1, got %d", len(candidates1))
	}

	for _, c := range candidates1 {
		if c.StudentID == "stud-1" {
			if c.TrustScore != 100 {
				t.Errorf("expected stud-1 score 100, got %d", c.TrustScore)
			}
			if c.Status != models.StatusActive {
				t.Errorf("expected stud-1 status ACTIVE, got %s", c.Status)
			}
		} else if c.StudentID == "stud-2" {
			if c.TrustScore >= 100 {
				t.Errorf("expected stud-2 score < 100, got %d", c.TrustScore)
			}
		}
	}

	// Check candidates for exam-2
	candidates2 := sm.GetCandidatesForExam("exam-2")
	if len(candidates2) != 1 {
		t.Fatalf("expected 1 candidate for exam-2, got %d", len(candidates2))
	}
	if candidates2[0].StudentID != "stud-3" {
		t.Errorf("expected stud-3, got %s", candidates2[0].StudentID)
	}

	// Check non-existent exam
	candidatesNone := sm.GetCandidatesForExam("exam-empty")
	if len(candidatesNone) != 0 {
		t.Fatalf("expected 0 candidates for empty exam, got %d", len(candidatesNone))
	}
}

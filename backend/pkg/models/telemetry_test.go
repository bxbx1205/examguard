package models

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSeverityLevelConstants(t *testing.T) {
	tests := []struct {
		severity SeverityLevel
		expected string
	}{
		{SeverityLow, "LOW"},
		{SeverityMedium, "MEDIUM"},
		{SeverityHigh, "HIGH"},
		{SeverityCritical, "CRITICAL"},
	}

	for _, tt := range tests {
		if string(tt.severity) != tt.expected {
			t.Errorf("expected severity %s, got %s", tt.expected, tt.severity)
		}
	}
}

func TestAnomalyCategoryConstants(t *testing.T) {
	tests := []struct {
		category AnomalyCategory
		expected string
	}{
		{CategoryVision, "VISION"},
		{CategoryAudio, "AUDIO"},
		{CategoryEnvironment, "ENVIRONMENT"},
	}

	for _, tt := range tests {
		if string(tt.category) != tt.expected {
			t.Errorf("expected category %s, got %s", tt.expected, tt.category)
		}
	}
}

func TestCandidateStatusConstants(t *testing.T) {
	tests := []struct {
		status   CandidateStatus
		expected string
	}{
		{StatusActive, "ACTIVE"},
		{StatusFlagged, "FLAGGED"},
		{StatusDisconnected, "DISCONNECTED"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.expected {
			t.Errorf("expected status %s, got %s", tt.expected, tt.status)
		}
	}
}

func TestTelemetryEvent_JSONSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	snapKey := "snapshots/snap-123.jpg"

	event := TelemetryEvent{
		Type:        "TELEMETRY_ANOMALY",
		EventID:     "evt-001",
		ExamID:      "exam-101",
		SessionID:   "sess-555",
		StudentID:   "stud-999",
		Timestamp:   now,
		Category:    CategoryVision,
		Subtype:     "MULTIPLE_FACES_DETECTED",
		Severity:    SeverityCritical,
		Confidence:  0.95,
		Metrics:     map[string]interface{}{"face_count": float64(2)},
		SnapshotKey: &snapKey,
		Message:     "Multiple faces visible in webcam frame",
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("failed to marshal TelemetryEvent: %v", err)
	}

	var parsed TelemetryEvent
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal TelemetryEvent: %v", err)
	}

	if parsed.EventID != event.EventID {
		t.Errorf("expected EventID %s, got %s", event.EventID, parsed.EventID)
	}
	if parsed.ExamID != event.ExamID {
		t.Errorf("expected ExamID %s, got %s", event.ExamID, parsed.ExamID)
	}
	if parsed.SessionID != event.SessionID {
		t.Errorf("expected SessionID %s, got %s", event.SessionID, parsed.SessionID)
	}
	if parsed.StudentID != event.StudentID {
		t.Errorf("expected StudentID %s, got %s", event.StudentID, parsed.StudentID)
	}
	if parsed.Category != CategoryVision {
		t.Errorf("expected Category %s, got %s", CategoryVision, parsed.Category)
	}
	if parsed.Subtype != "MULTIPLE_FACES_DETECTED" {
		t.Errorf("expected Subtype MULTIPLE_FACES_DETECTED, got %s", parsed.Subtype)
	}
	if parsed.Severity != SeverityCritical {
		t.Errorf("expected Severity %s, got %s", SeverityCritical, parsed.Severity)
	}
	if parsed.Confidence != 0.95 {
		t.Errorf("expected Confidence 0.95, got %f", parsed.Confidence)
	}
	if parsed.SnapshotKey == nil || *parsed.SnapshotKey != snapKey {
		t.Errorf("expected SnapshotKey %s, got %v", snapKey, parsed.SnapshotKey)
	}
	if parsed.Message != event.Message {
		t.Errorf("expected Message %s, got %s", event.Message, parsed.Message)
	}
	if fc, ok := parsed.Metrics["face_count"].(float64); !ok || fc != 2 {
		t.Errorf("expected Metrics['face_count'] = 2, got %v", parsed.Metrics["face_count"])
	}
}

func TestTelemetryEvent_OmitEmptyFields(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)

	event := TelemetryEvent{
		Type:       "TELEMETRY_ANOMALY",
		EventID:    "evt-002",
		ExamID:     "exam-102",
		SessionID:  "sess-556",
		StudentID:  "stud-998",
		Timestamp:  now,
		Category:   CategoryAudio,
		Subtype:    "AUDIO_WHISPER",
		Severity:   SeverityMedium,
		Confidence: 0.65,
		Message:    "Whispering detected",
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("failed to marshal TelemetryEvent: %v", err)
	}

	jsonStr := string(data)
	var parsedMap map[string]interface{}
	if err := json.Unmarshal(data, &parsedMap); err != nil {
		t.Fatalf("failed to unmarshal JSON into map: %v", err)
	}

	if _, exists := parsedMap["metrics"]; exists {
		t.Errorf("metrics field should be omitted when nil, got %s", jsonStr)
	}
	if _, exists := parsedMap["snapshot_key"]; exists {
		t.Errorf("snapshot_key field should be omitted when nil, got %s", jsonStr)
	}
}

func TestCandidate_JSONSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	violation := "GAZE_DEVIATION"

	candidate := Candidate{
		StudentID:        "stud-123",
		Name:             "John Doe",
		TrustScore:       85,
		Status:           StatusActive,
		LastViolation:    &violation,
		CameraActive:     true,
		MicrophoneActive: true,
		LastSeen:         now,
	}

	data, err := json.Marshal(candidate)
	if err != nil {
		t.Fatalf("failed to marshal Candidate: %v", err)
	}

	var parsed Candidate
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal Candidate: %v", err)
	}

	if parsed.StudentID != "stud-123" {
		t.Errorf("expected StudentID stud-123, got %s", parsed.StudentID)
	}
	if parsed.Name != "John Doe" {
		t.Errorf("expected Name John Doe, got %s", parsed.Name)
	}
	if parsed.TrustScore != 85 {
		t.Errorf("expected TrustScore 85, got %d", parsed.TrustScore)
	}
	if parsed.Status != StatusActive {
		t.Errorf("expected Status ACTIVE, got %s", parsed.Status)
	}
	if parsed.LastViolation == nil || *parsed.LastViolation != violation {
		t.Errorf("expected LastViolation %s, got %v", violation, parsed.LastViolation)
	}
	if !parsed.CameraActive || !parsed.MicrophoneActive {
		t.Errorf("expected CameraActive and MicrophoneActive true")
	}
}

func TestInitialStatePayload_JSONSerialization(t *testing.T) {
	payload := InitialStatePayload{
		ExamID:   "exam-202",
		ExamName: "Algorithms Midterm",
		Summary: struct {
			TotalRegistered   int `json:"total_registered"`
			ActiveCount       int `json:"active_count"`
			FlaggedCount      int `json:"flagged_count"`
			DisconnectedCount int `json:"disconnected_count"`
		}{
			TotalRegistered:   50,
			ActiveCount:       45,
			FlaggedCount:      3,
			DisconnectedCount: 2,
		},
		Candidates: []Candidate{
			{
				StudentID:  "s-1",
				Name:       "Candidate 1",
				TrustScore: 100,
				Status:     StatusActive,
			},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to marshal InitialStatePayload: %v", err)
	}

	var parsed InitialStatePayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal InitialStatePayload: %v", err)
	}

	if parsed.ExamID != "exam-202" {
		t.Errorf("expected ExamID exam-202, got %s", parsed.ExamID)
	}
	if parsed.Summary.TotalRegistered != 50 {
		t.Errorf("expected TotalRegistered 50, got %d", parsed.Summary.TotalRegistered)
	}
	if parsed.Summary.ActiveCount != 45 {
		t.Errorf("expected ActiveCount 45, got %d", parsed.Summary.ActiveCount)
	}
	if len(parsed.Candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(parsed.Candidates))
	}
	if parsed.Candidates[0].StudentID != "s-1" {
		t.Errorf("expected StudentID s-1, got %s", parsed.Candidates[0].StudentID)
	}
}

func TestIncidentAlert_JSONSerialization(t *testing.T) {
	alert := IncidentAlert{
		Type: "INCIDENT_ALERT",
		Payload: TelemetryEvent{
			EventID:    "evt-88",
			ExamID:     "ex-1",
			StudentID:  "st-1",
			Category:   CategoryEnvironment,
			Subtype:    "TAB_SWITCH_BLUR",
			Severity:   SeverityMedium,
			Confidence: 1.0,
		},
	}

	data, err := json.Marshal(alert)
	if err != nil {
		t.Fatalf("failed to marshal IncidentAlert: %v", err)
	}

	var parsed IncidentAlert
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal IncidentAlert: %v", err)
	}

	if parsed.Type != "INCIDENT_ALERT" {
		t.Errorf("expected Type INCIDENT_ALERT, got %s", parsed.Type)
	}
	if parsed.Payload.Subtype != "TAB_SWITCH_BLUR" {
		t.Errorf("expected Subtype TAB_SWITCH_BLUR, got %s", parsed.Payload.Subtype)
	}
}

func TestInvigilatorAction_JSONSerialization(t *testing.T) {
	action := InvigilatorAction{
		ActionType: "WARN",
		StudentID:  "stud-456",
		Message:    "Please keep your face towards the screen",
		Reason:     "Repeated gaze deviation detected",
	}

	data, err := json.Marshal(action)
	if err != nil {
		t.Fatalf("failed to marshal InvigilatorAction: %v", err)
	}

	var parsed InvigilatorAction
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal InvigilatorAction: %v", err)
	}

	if parsed.ActionType != "WARN" {
		t.Errorf("expected ActionType WARN, got %s", parsed.ActionType)
	}
	if parsed.StudentID != "stud-456" {
		t.Errorf("expected StudentID stud-456, got %s", parsed.StudentID)
	}
	if parsed.Message != action.Message {
		t.Errorf("expected Message %s, got %s", action.Message, parsed.Message)
	}
	if parsed.Reason != action.Reason {
		t.Errorf("expected Reason %s, got %s", action.Reason, parsed.Reason)
	}
}

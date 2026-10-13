package models

import "time"

// SeverityLevel indicates the gravity of the infraction
type SeverityLevel string

const (
	SeverityLow      SeverityLevel = "LOW"
	SeverityMedium   SeverityLevel = "MEDIUM"
	SeverityHigh     SeverityLevel = "HIGH"
	SeverityCritical SeverityLevel = "CRITICAL"
)

// AnomalyCategory categorizes the origin of the infraction
type AnomalyCategory string

const (
	CategoryVision      AnomalyCategory = "VISION"
	CategoryAudio       AnomalyCategory = "AUDIO"
	CategoryEnvironment AnomalyCategory = "ENVIRONMENT"
)

// CandidateStatus defines the state of the student's exam integrity
type CandidateStatus string

const (
	StatusActive       CandidateStatus = "ACTIVE"
	StatusFlagged      CandidateStatus = "FLAGGED"
	StatusDisconnected CandidateStatus = "DISCONNECTED"
)

// TelemetryEvent represents an anomaly payload emitted by the browser extension
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

// Candidate represents a candidate card in the live invigilator dashboard
type Candidate struct {
	StudentID        string          `json:"student_id"`
	Name             string          `json:"name"`
	TrustScore       int             `json:"trust_score"`
	Status           CandidateStatus `json:"status"`
	LastViolation    *string         `json:"last_violation,omitempty"`
	CameraActive     bool            `json:"camera_active"`
	MicrophoneActive bool            `json:"microphone_active"`
	LastSeen         time.Time       `json:"last_seen"`
}

// InitialStatePayload is pushed to the invigilator dashboard upon connection
type InitialStatePayload struct {
	ExamID   string `json:"exam_id"`
	ExamName string `json:"exam_name"`
	Summary  struct {
		TotalRegistered   int `json:"total_registered"`
		ActiveCount       int `json:"active_count"`
		FlaggedCount      int `json:"flagged_count"`
		DisconnectedCount int `json:"disconnected_count"`
	} `json:"summary"`
	Candidates []Candidate `json:"candidates"`
}

// IncidentAlert is broadcast to invigilator dashboards when an anomaly passes the filter
type IncidentAlert struct {
	Type    string         `json:"type"` // "INCIDENT_ALERT"
	Payload TelemetryEvent `json:"payload"`
}

// InvigilatorAction models downstream interventions (Warn, Lock, Terminate)
type InvigilatorAction struct {
	ActionType string `json:"action_type"` // "WARN", "LOCK", "TERMINATE"
	StudentID  string `json:"student_id"`
	Message    string `json:"message,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

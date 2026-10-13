package scoring

import (
	"math"
	"sync"

	"examguard-backend/pkg/models"
)

// BasePenalties maps anomaly subtypes to their base point deduction.
var BasePenalties = map[string]float64{
	"MULTIPLE_FACES_DETECTED": 15,
	"FACE_NOT_DETECTED":       10,
	"TAB_SWITCH_BLUR":         12,
	"FULLSCREEN_EXIT":         10,
	"DEVTOOLS_ATTEMPT":        15,
	"AUDIO_MULTIPLE_SPEAKERS": 8,
	"GAZE_DEVIATION":          5,
	"HEAD_POSE_ANOMALY":       5,
	"AUDIO_WHISPER":           3,
	"CLIPBOARD_VIOLATION":     3,
}

// Engine manages trust score computation per student session.
type Engine struct {
	mu     sync.RWMutex
	scores map[string]*StudentScore // key: session_id
}

// StudentScore tracks cumulative penalties and occurrence counts per subtype.
type StudentScore struct {
	mu            sync.Mutex
	TrustScore    int
	Violations    []ViolationRecord
	SubtypeCounts map[string]int
}

// ViolationRecord logs a single penalty application.
type ViolationRecord struct {
	EventID    string  `json:"event_id"`
	Subtype    string  `json:"subtype"`
	Penalty    float64 `json:"penalty"`
	Confidence float64 `json:"confidence"`
}

// NewEngine creates a new scoring engine.
func NewEngine() *Engine {
	return &Engine{
		scores: make(map[string]*StudentScore),
	}
}

// InitSession creates a score tracker for a new session with baseline 100.
func (e *Engine) InitSession(sessionID string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.scores[sessionID] = &StudentScore{
		TrustScore:    100,
		Violations:    make([]ViolationRecord, 0),
		SubtypeCounts: make(map[string]int),
	}
}

// ProcessEvent calculates the penalty for an anomaly event and updates the trust score.
// Returns the penalty applied and the new trust score.
//
// Formula: Penalty_i = W_i × C_i × M_i
// Where:
//   - W_i = Base penalty weight
//   - C_i = ML model confidence (0.0 – 1.0)
//   - M_i = Repetition multiplier (1.0 base, +0.25 per repeat)
func (e *Engine) ProcessEvent(sessionID string, event models.TelemetryEvent) (penalty float64, newScore int) {
	e.mu.RLock()
	ss, exists := e.scores[sessionID]
	e.mu.RUnlock()

	if !exists {
		// Auto-initialize if session not explicitly initialized
		e.InitSession(sessionID)
		e.mu.RLock()
		ss = e.scores[sessionID]
		e.mu.RUnlock()
	}

	ss.mu.Lock()
	defer ss.mu.Unlock()

	// Look up base weight
	baseWeight, ok := BasePenalties[event.Subtype]
	if !ok {
		// Unknown subtype — apply a minimal default penalty
		baseWeight = 2
	}

	// Confidence factor
	confidence := event.Confidence
	if confidence <= 0 {
		confidence = 1.0
	}

	// Repetition multiplier: increases by 0.25 for each prior occurrence of the same subtype
	ss.SubtypeCounts[event.Subtype]++
	count := ss.SubtypeCounts[event.Subtype]
	multiplier := 1.0 + 0.25*float64(count-1)

	// Compute final penalty
	penalty = baseWeight * confidence * multiplier
	penalty = math.Round(penalty*100) / 100 // round to 2 decimal places

	// Apply deduction
	ss.TrustScore = int(math.Max(0, float64(ss.TrustScore)-penalty))

	// Record the violation
	ss.Violations = append(ss.Violations, ViolationRecord{
		EventID:    event.EventID,
		Subtype:    event.Subtype,
		Penalty:    penalty,
		Confidence: confidence,
	})

	return penalty, ss.TrustScore
}

// GetScore returns the current trust score for a session.
func (e *Engine) GetScore(sessionID string) int {
	e.mu.RLock()
	ss, exists := e.scores[sessionID]
	e.mu.RUnlock()

	if !exists {
		return 100
	}

	ss.mu.Lock()
	defer ss.mu.Unlock()
	return ss.TrustScore
}

// GetStatus returns the candidate status based on current trust score.
func (e *Engine) GetStatus(sessionID string) models.CandidateStatus {
	score := e.GetScore(sessionID)
	if score < 60 {
		return models.StatusFlagged
	}
	return models.StatusActive
}

// RemoveSession removes a session from tracking (e.g., on disconnect/submit).
func (e *Engine) RemoveSession(sessionID string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.scores, sessionID)
}

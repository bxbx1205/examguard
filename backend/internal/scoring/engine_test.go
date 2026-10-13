package scoring

import (
	"testing"

	"examguard-backend/pkg/models"
)

func TestNewEngine(t *testing.T) {
	e := NewEngine()
	if e == nil {
		t.Fatal("NewEngine() returned nil")
	}
	if e.scores == nil {
		t.Fatal("scores map not initialized")
	}
}

func TestInitSession(t *testing.T) {
	e := NewEngine()
	e.InitSession("sess_test_01")

	score := e.GetScore("sess_test_01")
	if score != 100 {
		t.Errorf("initial score = %d, want 100", score)
	}

	status := e.GetStatus("sess_test_01")
	if status != models.StatusActive {
		t.Errorf("initial status = %q, want %q", status, models.StatusActive)
	}
}

func TestGetScore_NonExistentSession(t *testing.T) {
	e := NewEngine()
	score := e.GetScore("sess_nonexistent")
	if score != 100 {
		t.Errorf("non-existent session score = %d, want 100 (default)", score)
	}
}

func TestProcessEvent_KnownSubtype(t *testing.T) {
	tests := []struct {
		name       string
		subtype    string
		confidence float64
		wantMin    float64 // minimum expected penalty
		wantMax    float64 // maximum expected penalty
	}{
		{
			name:       "MULTIPLE_FACES_DETECTED with high confidence",
			subtype:    "MULTIPLE_FACES_DETECTED",
			confidence: 0.96,
			wantMin:    14.0,
			wantMax:    15.0,
		},
		{
			name:       "TAB_SWITCH_BLUR with full confidence",
			subtype:    "TAB_SWITCH_BLUR",
			confidence: 1.0,
			wantMin:    12.0,
			wantMax:    12.0,
		},
		{
			name:       "AUDIO_WHISPER with low confidence",
			subtype:    "AUDIO_WHISPER",
			confidence: 0.5,
			wantMin:    1.0,
			wantMax:    2.0,
		},
		{
			name:       "GAZE_DEVIATION with medium confidence",
			subtype:    "GAZE_DEVIATION",
			confidence: 0.88,
			wantMin:    4.0,
			wantMax:    5.0,
		},
		{
			name:       "CLIPBOARD_VIOLATION deterministic",
			subtype:    "CLIPBOARD_VIOLATION",
			confidence: 1.0,
			wantMin:    3.0,
			wantMax:    3.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := NewEngine()
			e.InitSession("sess_test")

			event := models.TelemetryEvent{
				EventID:    "evt_test_001",
				Subtype:    tt.subtype,
				Confidence: tt.confidence,
				Severity:   models.SeverityHigh,
			}

			penalty, newScore := e.ProcessEvent("sess_test", event)

			if penalty < tt.wantMin || penalty > tt.wantMax {
				t.Errorf("penalty = %.2f, want between %.2f and %.2f", penalty, tt.wantMin, tt.wantMax)
			}

			expectedMaxScore := int(100 - tt.wantMin)
			if newScore > expectedMaxScore {
				t.Errorf("newScore = %d, want <= %d", newScore, expectedMaxScore)
			}
		})
	}
}

func TestProcessEvent_UnknownSubtype(t *testing.T) {
	e := NewEngine()
	e.InitSession("sess_test")

	event := models.TelemetryEvent{
		EventID:    "evt_unknown",
		Subtype:    "UNKNOWN_EVENT_TYPE",
		Confidence: 1.0,
	}

	penalty, newScore := e.ProcessEvent("sess_test", event)

	// Unknown subtypes should get default penalty of 2
	if penalty != 2.0 {
		t.Errorf("unknown subtype penalty = %.2f, want 2.0", penalty)
	}
	if newScore != 98 {
		t.Errorf("newScore = %d, want 98", newScore)
	}
}

func TestProcessEvent_ZeroConfidence(t *testing.T) {
	e := NewEngine()
	e.InitSession("sess_test")

	event := models.TelemetryEvent{
		EventID:    "evt_zero_conf",
		Subtype:    "TAB_SWITCH_BLUR",
		Confidence: 0, // zero confidence should default to 1.0
	}

	penalty, _ := e.ProcessEvent("sess_test", event)

	// With confidence defaulted to 1.0, penalty should be base weight (12)
	if penalty != 12.0 {
		t.Errorf("zero-confidence penalty = %.2f, want 12.0 (defaulted to confidence=1.0)", penalty)
	}
}

func TestProcessEvent_RepetitionMultiplier(t *testing.T) {
	e := NewEngine()
	e.InitSession("sess_test")

	// First occurrence: multiplier = 1.0 → penalty = 12 * 1.0 * 1.0 = 12
	event1 := models.TelemetryEvent{
		EventID: "evt_001", Subtype: "TAB_SWITCH_BLUR", Confidence: 1.0,
	}
	penalty1, score1 := e.ProcessEvent("sess_test", event1)
	if penalty1 != 12.0 {
		t.Errorf("1st occurrence penalty = %.2f, want 12.0", penalty1)
	}
	if score1 != 88 {
		t.Errorf("score after 1st = %d, want 88", score1)
	}

	// Second occurrence: multiplier = 1.25 → penalty = 12 * 1.0 * 1.25 = 15
	event2 := models.TelemetryEvent{
		EventID: "evt_002", Subtype: "TAB_SWITCH_BLUR", Confidence: 1.0,
	}
	penalty2, score2 := e.ProcessEvent("sess_test", event2)
	if penalty2 != 15.0 {
		t.Errorf("2nd occurrence penalty = %.2f, want 15.0", penalty2)
	}
	if score2 != 73 {
		t.Errorf("score after 2nd = %d, want 73", score2)
	}

	// Third occurrence: multiplier = 1.5 → penalty = 12 * 1.0 * 1.5 = 18
	event3 := models.TelemetryEvent{
		EventID: "evt_003", Subtype: "TAB_SWITCH_BLUR", Confidence: 1.0,
	}
	penalty3, score3 := e.ProcessEvent("sess_test", event3)
	if penalty3 != 18.0 {
		t.Errorf("3rd occurrence penalty = %.2f, want 18.0", penalty3)
	}
	if score3 != 55 {
		t.Errorf("score after 3rd = %d, want 55", score3)
	}
}

func TestProcessEvent_ScoreFloorAtZero(t *testing.T) {
	e := NewEngine()
	e.InitSession("sess_test")

	// Repeatedly send critical events to drive score below zero
	for i := 0; i < 20; i++ {
		event := models.TelemetryEvent{
			EventID:    "evt_flood_" + string(rune('A'+i)),
			Subtype:    "MULTIPLE_FACES_DETECTED",
			Confidence: 1.0,
		}
		_, score := e.ProcessEvent("sess_test", event)
		if score < 0 {
			t.Fatalf("score went below zero: %d (iteration %d)", score, i)
		}
	}

	finalScore := e.GetScore("sess_test")
	if finalScore != 0 {
		t.Errorf("final score = %d, want 0 (floor)", finalScore)
	}
}

func TestGetStatus_Thresholds(t *testing.T) {
	tests := []struct {
		name       string
		events     int // number of TAB_SWITCH_BLUR events to send (12 pts each)
		wantStatus models.CandidateStatus
	}{
		{
			name:       "active after 0 events (score=100)",
			events:     0,
			wantStatus: models.StatusActive,
		},
		{
			name:       "active after 1 event (score=88)",
			events:     1,
			wantStatus: models.StatusActive,
		},
		{
			name:       "active after 2 events (score~73)",
			events:     2,
			wantStatus: models.StatusActive,
		},
		{
			name:       "flagged after 3 events (score~55)",
			events:     3,
			wantStatus: models.StatusFlagged,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := NewEngine()
			e.InitSession("sess_test")

			for i := 0; i < tt.events; i++ {
				event := models.TelemetryEvent{
					EventID: "evt_" + string(rune('A'+i)), Subtype: "TAB_SWITCH_BLUR", Confidence: 1.0,
				}
				e.ProcessEvent("sess_test", event)
			}

			status := e.GetStatus("sess_test")
			if status != tt.wantStatus {
				t.Errorf("status = %q, want %q (after %d events)", status, tt.wantStatus, tt.events)
			}
		})
	}
}

func TestProcessEvent_AutoInitSession(t *testing.T) {
	e := NewEngine()
	// Don't call InitSession — ProcessEvent should auto-init

	event := models.TelemetryEvent{
		EventID:    "evt_auto",
		Subtype:    "CLIPBOARD_VIOLATION",
		Confidence: 1.0,
	}

	penalty, score := e.ProcessEvent("sess_auto", event)

	if penalty != 3.0 {
		t.Errorf("auto-init penalty = %.2f, want 3.0", penalty)
	}
	if score != 97 {
		t.Errorf("auto-init score = %d, want 97", score)
	}
}

func TestRemoveSession(t *testing.T) {
	e := NewEngine()
	e.InitSession("sess_remove")

	event := models.TelemetryEvent{
		EventID: "evt_r", Subtype: "GAZE_DEVIATION", Confidence: 0.9,
	}
	e.ProcessEvent("sess_remove", event)

	e.RemoveSession("sess_remove")

	// After removal, should return default score
	score := e.GetScore("sess_remove")
	if score != 100 {
		t.Errorf("score after removal = %d, want 100 (default)", score)
	}
}

func TestRemoveSession_NonExistent(t *testing.T) {
	e := NewEngine()
	// Should not panic
	e.RemoveSession("sess_nonexistent")
}

func TestBasePenalties_AllSubtypes(t *testing.T) {
	expectedSubtypes := []string{
		"MULTIPLE_FACES_DETECTED",
		"FACE_NOT_DETECTED",
		"TAB_SWITCH_BLUR",
		"FULLSCREEN_EXIT",
		"DEVTOOLS_ATTEMPT",
		"AUDIO_MULTIPLE_SPEAKERS",
		"GAZE_DEVIATION",
		"HEAD_POSE_ANOMALY",
		"AUDIO_WHISPER",
		"CLIPBOARD_VIOLATION",
	}

	for _, subtype := range expectedSubtypes {
		weight, ok := BasePenalties[subtype]
		if !ok {
			t.Errorf("BasePenalties missing subtype %q", subtype)
			continue
		}
		if weight <= 0 {
			t.Errorf("BasePenalties[%q] = %.1f, want > 0", subtype, weight)
		}
	}
}

func TestProcessEvent_MixedSubtypes(t *testing.T) {
	e := NewEngine()
	e.InitSession("sess_mixed")

	events := []struct {
		subtype    string
		confidence float64
	}{
		{"GAZE_DEVIATION", 0.88},          // 5 * 0.88 * 1.0 = 4.4
		{"TAB_SWITCH_BLUR", 1.0},          // 12 * 1.0 * 1.0 = 12
		{"GAZE_DEVIATION", 0.9},           // 5 * 0.9 * 1.25 = 5.625 (2nd gaze)
		{"MULTIPLE_FACES_DETECTED", 0.96}, // 15 * 0.96 * 1.0 = 14.4
	}

	var totalPenalty float64
	for i, ev := range events {
		event := models.TelemetryEvent{
			EventID:    "evt_mix_" + string(rune('A'+i)),
			Subtype:    ev.subtype,
			Confidence: ev.confidence,
		}
		penalty, _ := e.ProcessEvent("sess_mixed", event)
		totalPenalty += penalty
	}

	finalScore := e.GetScore("sess_mixed")
	expectedApprox := 100 - int(totalPenalty)
	if expectedApprox < 0 {
		expectedApprox = 0
	}

	// Allow ±2 for cumulative rounding across multiple penalty calculations
	if finalScore < expectedApprox-2 || finalScore > expectedApprox+2 {
		t.Errorf("final score = %d, want ~%d (total penalty=%.2f)", finalScore, expectedApprox, totalPenalty)
	}
}

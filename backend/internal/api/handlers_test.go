package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"examguard-backend/internal/concurrency"
	"examguard-backend/internal/config"
	"examguard-backend/internal/scoring"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestAPIServer() (*Server, *gin.Engine) {
	cfg := &config.Config{
		JWTSecret: "test-jwt-secret-for-api-tests-2026",
	}
	scorer := scoring.NewEngine()
	hub := concurrency.NewInvigilatorHub()
	// Create SessionManager with nil DB pools (safe for metrics and router setup)
	sm := concurrency.NewSessionManager(nil, nil, scorer)

	srv := NewServer(cfg, nil, nil, nil, sm, hub, scorer)
	router := gin.New()
	srv.SetupRoutes(router)

	return srv, router
}

func TestWebSocketUpgrader_CheckOrigin(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "http://localhost/api/v1/ws/candidate", nil)
	req.Header.Set("Origin", "http://external-site.com")

	if !upgrader.CheckOrigin(req) {
		t.Error("upgrader.CheckOrigin should return true for all origins in development")
	}
}

func TestMetricsEndpoint(t *testing.T) {
	_, router := setupTestAPIServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse metrics JSON: %v", err)
	}

	if _, ok := resp["active_websocket_connections"]; !ok {
		t.Error("metrics response missing 'active_websocket_connections'")
	}
	if _, ok := resp["active_goroutines"]; !ok {
		t.Error("metrics response missing 'active_goroutines'")
	}
	if _, ok := resp["memory_alloc_mb"]; !ok {
		t.Error("metrics response missing 'memory_alloc_mb'")
	}
	if _, ok := resp["uptime_seconds"]; !ok {
		t.Error("metrics response missing 'uptime_seconds'")
	}
}

func TestStudentLogin_ValidationErrors(t *testing.T) {
	_, router := setupTestAPIServer()

	testCases := []struct {
		name       string
		body       map[string]interface{}
		rawBody    string
		expectCode int
	}{
		{
			name:       "empty body",
			rawBody:    "",
			expectCode: http.StatusBadRequest,
		},
		{
			name:       "invalid JSON",
			rawBody:    "{invalid_json",
			expectCode: http.StatusBadRequest,
		},
		{
			name: "missing student_id",
			body: map[string]interface{}{
				"exam_key":   "EXAM123",
				"secret_pin": "1234",
			},
			expectCode: http.StatusBadRequest,
		},
		{
			name: "missing secret_pin",
			body: map[string]interface{}{
				"exam_key":   "EXAM123",
				"student_id": "stud-1",
			},
			expectCode: http.StatusBadRequest,
		},
		{
			name: "missing exam_key",
			body: map[string]interface{}{
				"student_id": "stud-1",
				"secret_pin": "1234",
			},
			expectCode: http.StatusBadRequest,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var bodyBytes []byte
			if tc.rawBody != "" {
				bodyBytes = []byte(tc.rawBody)
			} else if tc.body != nil {
				bodyBytes, _ = json.Marshal(tc.body)
			}

			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodPost, "/api/v1/auth/student/login", bytes.NewBuffer(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(w, req)

			if w.Code != tc.expectCode {
				t.Fatalf("expected status %d, got %d: %s", tc.expectCode, w.Code, w.Body.String())
			}

			var resp map[string]interface{}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err == nil {
				if success, ok := resp["success"].(bool); ok && success {
					t.Error("expected success=false for validation error")
				}
			}
		})
	}
}

func TestInvigilatorLogin_ValidationErrors(t *testing.T) {
	_, router := setupTestAPIServer()

	testCases := []struct {
		name       string
		body       map[string]interface{}
		rawBody    string
		expectCode int
	}{
		{
			name:       "empty body",
			rawBody:    "",
			expectCode: http.StatusBadRequest,
		},
		{
			name:       "invalid JSON",
			rawBody:    "not a json",
			expectCode: http.StatusBadRequest,
		},
		{
			name: "missing username",
			body: map[string]interface{}{
				"password": "secretpassword",
			},
			expectCode: http.StatusBadRequest,
		},
		{
			name: "missing password",
			body: map[string]interface{}{
				"username": "admin",
			},
			expectCode: http.StatusBadRequest,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var bodyBytes []byte
			if tc.rawBody != "" {
				bodyBytes = []byte(tc.rawBody)
			} else if tc.body != nil {
				bodyBytes, _ = json.Marshal(tc.body)
			}

			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodPost, "/api/v1/auth/invigilator/login", bytes.NewBuffer(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(w, req)

			if w.Code != tc.expectCode {
				t.Fatalf("expected status %d, got %d: %s", tc.expectCode, w.Code, w.Body.String())
			}
		})
	}
}

func TestProtectedRoutes_RequireAuth(t *testing.T) {
	_, router := setupTestAPIServer()

	protectedEndpoints := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/exams"},
		{http.MethodGet, "/api/v1/exams/exam-123"},
		{http.MethodGet, "/api/v1/exams/exam-123/candidates"},
		{http.MethodGet, "/api/v1/exams/exam-123/candidates/stud-1"},
		{http.MethodGet, "/api/v1/exams/exam-123/events"},
		{http.MethodGet, "/api/v1/events/evt-1"},
		{http.MethodGet, "/api/v1/events/evt-1/snapshot"},
		{http.MethodPost, "/api/v1/evidence/presigned-url"},
		{http.MethodPost, "/api/v1/exams/exam-123/candidates/stud-1/actions"},
	}

	for _, ep := range protectedEndpoints {
		t.Run("NoAuth_"+ep.method+"_"+ep.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(ep.method, ep.path, nil)
			router.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Fatalf("expected status 401 for unauthenticated request to %s %s, got %d", ep.method, ep.path, w.Code)
			}
		})

		t.Run("InvalidToken_"+ep.method+"_"+ep.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(ep.method, ep.path, nil)
			req.Header.Set("Authorization", "Bearer bad.token.here")
			router.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Fatalf("expected status 401 for invalid token to %s %s, got %d", ep.method, ep.path, w.Code)
			}
		})
	}
}

func TestServer_UptimeIncreases(t *testing.T) {
	srv, router := setupTestAPIServer()
	srv.startTime = time.Now().Add(-5 * time.Second)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	router.ServeHTTP(w, req)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	uptime, ok := resp["uptime_seconds"].(float64)
	if !ok || uptime < 4.9 {
		t.Errorf("expected uptime >= 4.9 seconds, got %v", resp["uptime_seconds"])
	}
}

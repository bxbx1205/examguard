package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestRouter(secret string) *gin.Engine {
	r := gin.New()
	r.Use(Middleware(secret))
	r.GET("/test-protected", func(c *gin.Context) {
		role, _ := c.Get("role")
		userID, _ := c.Get("user_id")
		studentID, _ := c.Get("student_id")
		examID, _ := c.Get("exam_id")
		claims, _ := c.Get("claims")

		c.JSON(http.StatusOK, gin.H{
			"role":       role,
			"user_id":    userID,
			"student_id": studentID,
			"exam_id":    examID,
			"has_claims": claims != nil,
		})
	})
	return r
}

func TestMiddleware_MissingAuthorizationHeader(t *testing.T) {
	router := setupTestRouter(testSecret)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-protected", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "Missing Authorization header") {
		t.Errorf("expected missing header message, got %s", w.Body.String())
	}
}

func TestMiddleware_InvalidScheme(t *testing.T) {
	router := setupTestRouter(testSecret)

	testCases := []struct {
		name   string
		header string
	}{
		{"Basic scheme", "Basic dXNlcjpwYXNz"},
		{"No space token", "BearerTokenWithoutSpace"},
		{"Custom scheme", "Token 12345"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodGet, "/test-protected", nil)
			req.Header.Set("Authorization", tc.header)
			router.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Fatalf("expected status 401, got %d", w.Code)
			}
			if !strings.Contains(w.Body.String(), "must use Bearer scheme") {
				t.Errorf("expected Bearer scheme error, got %s", w.Body.String())
			}
		})
	}
}

func TestMiddleware_InvalidOrGarbageToken(t *testing.T) {
	router := setupTestRouter(testSecret)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-protected", nil)
	req.Header.Set("Authorization", "Bearer invalid.jwt.token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "Invalid or expired token") {
		t.Errorf("expected invalid token error, got %s", w.Body.String())
	}
}

func TestMiddleware_WrongSecretToken(t *testing.T) {
	router := setupTestRouter(testSecret)

	// Generate token with different secret
	token, err := GenerateStudentToken("wrong_secret_key", "exam-1", "student-1", "Alice")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
}

func TestMiddleware_ExpiredToken(t *testing.T) {
	router := setupTestRouter(testSecret)

	// Create an expired token manually
	claims := Claims{
		Role:      "student",
		StudentID: "s-1",
		ExamID:    "e-1",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
}

func TestMiddleware_ValidStudentToken(t *testing.T) {
	router := setupTestRouter(testSecret)

	token, err := GenerateStudentToken(testSecret, "student-42", "Bob Smith", "exam-99")
	if err != nil {
		t.Fatalf("failed to generate student token: %v", err)
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	body := w.Body.String()
	if !strings.Contains(body, `"role":"student"`) {
		t.Errorf("expected role student in response, got %s", body)
	}
	if !strings.Contains(body, `"student_id":"student-42"`) {
		t.Errorf("expected student_id student-42 in response, got %s", body)
	}
	if !strings.Contains(body, `"exam_id":"exam-99"`) {
		t.Errorf("expected exam_id exam-99 in response, got %s", body)
	}
	if !strings.Contains(body, `"has_claims":true`) {
		t.Errorf("expected has_claims true in response, got %s", body)
	}
}

func TestMiddleware_ValidInvigilatorToken(t *testing.T) {
	router := setupTestRouter(testSecret)

	token, err := GenerateInvigilatorToken(testSecret, "proctor-7", "Dr. Jane")
	if err != nil {
		t.Fatalf("failed to generate invigilator token: %v", err)
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	body := w.Body.String()
	if !strings.Contains(body, `"role":"invigilator"`) {
		t.Errorf("expected role invigilator in response, got %s", body)
	}
	if !strings.Contains(body, `"user_id":"proctor-7"`) {
		t.Errorf("expected user_id proctor-7 in response, got %s", body)
	}
}

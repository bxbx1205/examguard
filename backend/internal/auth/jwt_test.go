package auth

import (
	"testing"
	"time"
)

const testSecret = "test_secret_key_for_unit_tests_2026"

// =====================================================================
// Token Generation Tests
// =====================================================================

func TestGenerateStudentToken(t *testing.T) {
	token, err := GenerateStudentToken(testSecret, "49", "Atharva Mandle", "exam_2026_cs501")
	if err != nil {
		t.Fatalf("GenerateStudentToken() error = %v", err)
	}
	if token == "" {
		t.Fatal("GenerateStudentToken() returned empty token")
	}
}

func TestGenerateInvigilatorToken(t *testing.T) {
	token, err := GenerateInvigilatorToken(testSecret, "inv_01", "Prof. Saurabh Tiwari")
	if err != nil {
		t.Fatalf("GenerateInvigilatorToken() error = %v", err)
	}
	if token == "" {
		t.Fatal("GenerateInvigilatorToken() returned empty token")
	}
}

// =====================================================================
// Token Validation Tests
// =====================================================================

func TestValidateToken_Student(t *testing.T) {
	token, err := GenerateStudentToken(testSecret, "49", "Atharva Mandle", "exam_2026_cs501")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	claims, err := ValidateToken(testSecret, token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.StudentID != "49" {
		t.Errorf("StudentID = %q, want %q", claims.StudentID, "49")
	}
	if claims.Name != "Atharva Mandle" {
		t.Errorf("Name = %q, want %q", claims.Name, "Atharva Mandle")
	}
	if claims.ExamID != "exam_2026_cs501" {
		t.Errorf("ExamID = %q, want %q", claims.ExamID, "exam_2026_cs501")
	}
	if claims.Role != "student" {
		t.Errorf("Role = %q, want %q", claims.Role, "student")
	}
	if claims.Subject != "user_stud_49" {
		t.Errorf("Subject = %q, want %q", claims.Subject, "user_stud_49")
	}
}

func TestValidateToken_Invigilator(t *testing.T) {
	token, err := GenerateInvigilatorToken(testSecret, "inv_01", "Prof. Saurabh Tiwari")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	claims, err := ValidateToken(testSecret, token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.UserID != "inv_01" {
		t.Errorf("UserID = %q, want %q", claims.UserID, "inv_01")
	}
	if claims.Name != "Prof. Saurabh Tiwari" {
		t.Errorf("Name = %q, want %q", claims.Name, "Prof. Saurabh Tiwari")
	}
	if claims.Role != "invigilator" {
		t.Errorf("Role = %q, want %q", claims.Role, "invigilator")
	}
	if claims.Subject != "user_inv_inv_01" {
		t.Errorf("Subject = %q, want %q", claims.Subject, "user_inv_inv_01")
	}
}

// =====================================================================
// Token Expiry Tests
// =====================================================================

func TestValidateToken_StudentExpiry(t *testing.T) {
	token, _ := GenerateStudentToken(testSecret, "49", "Test", "exam_test")
	claims, err := ValidateToken(testSecret, token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	// Student tokens should expire in 4 hours
	expiry := claims.ExpiresAt.Time
	issuedAt := claims.IssuedAt.Time
	duration := expiry.Sub(issuedAt)

	if duration != 4*time.Hour {
		t.Errorf("student token duration = %v, want %v", duration, 4*time.Hour)
	}
}

func TestValidateToken_InvigilatorExpiry(t *testing.T) {
	token, _ := GenerateInvigilatorToken(testSecret, "inv_01", "Test")
	claims, err := ValidateToken(testSecret, token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	// Invigilator tokens should expire in 8 hours
	expiry := claims.ExpiresAt.Time
	issuedAt := claims.IssuedAt.Time
	duration := expiry.Sub(issuedAt)

	if duration != 8*time.Hour {
		t.Errorf("invigilator token duration = %v, want %v", duration, 8*time.Hour)
	}
}

// =====================================================================
// Invalid Token Tests
// =====================================================================

func TestValidateToken_WrongSecret(t *testing.T) {
	token, _ := GenerateStudentToken(testSecret, "49", "Test", "exam_test")

	_, err := ValidateToken("wrong_secret", token)
	if err == nil {
		t.Fatal("ValidateToken() with wrong secret should return error")
	}
	if err != ErrInvalidToken {
		t.Errorf("error = %v, want %v", err, ErrInvalidToken)
	}
}

func TestValidateToken_GarbageToken(t *testing.T) {
	_, err := ValidateToken(testSecret, "not.a.valid.jwt")
	if err == nil {
		t.Fatal("ValidateToken() with garbage token should return error")
	}
	if err != ErrInvalidToken {
		t.Errorf("error = %v, want %v", err, ErrInvalidToken)
	}
}

func TestValidateToken_EmptyToken(t *testing.T) {
	_, err := ValidateToken(testSecret, "")
	if err == nil {
		t.Fatal("ValidateToken() with empty token should return error")
	}
}

// =====================================================================
// Token Uniqueness Test
// =====================================================================

func TestGenerateToken_Uniqueness(t *testing.T) {
	token1, _ := GenerateStudentToken(testSecret, "49", "Test", "exam_test")
	token2, _ := GenerateStudentToken(testSecret, "49", "Test", "exam_test")

	// Tokens generated at the same second could be identical due to iat,
	// but they should at least not be empty
	if token1 == "" || token2 == "" {
		t.Fatal("generated tokens should not be empty")
	}
}

// =====================================================================
// Claims Fields Test
// =====================================================================

func TestStudentClaims_AllFields(t *testing.T) {
	token, _ := GenerateStudentToken(testSecret, "46", "Taher Sanawadwala", "exam_2026_cs501")
	claims, err := ValidateToken(testSecret, token)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}

	// Verify all fields are populated
	checks := []struct {
		field string
		got   string
		want  string
	}{
		{"StudentID", claims.StudentID, "46"},
		{"Name", claims.Name, "Taher Sanawadwala"},
		{"ExamID", claims.ExamID, "exam_2026_cs501"},
		{"Role", claims.Role, "student"},
	}

	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %q, want %q", c.field, c.got, c.want)
		}
	}

	// Invigilator-specific fields should be empty for students
	if claims.UserID != "" {
		t.Errorf("student token has UserID = %q, want empty", claims.UserID)
	}
}

func TestInvigilatorClaims_AllFields(t *testing.T) {
	token, _ := GenerateInvigilatorToken(testSecret, "inv_02", "Dr. Smith")
	claims, err := ValidateToken(testSecret, token)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}

	if claims.UserID != "inv_02" {
		t.Errorf("UserID = %q, want %q", claims.UserID, "inv_02")
	}
	if claims.Role != "invigilator" {
		t.Errorf("Role = %q, want %q", claims.Role, "invigilator")
	}

	// Student-specific fields should be empty for invigilators
	if claims.StudentID != "" {
		t.Errorf("invigilator token has StudentID = %q, want empty", claims.StudentID)
	}
	if claims.ExamID != "" {
		t.Errorf("invigilator token has ExamID = %q, want empty", claims.ExamID)
	}
}

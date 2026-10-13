package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the JWT payload for both students and invigilators.
type Claims struct {
	jwt.RegisteredClaims
	StudentID string `json:"student_id,omitempty"`
	Name      string `json:"name"`
	ExamID    string `json:"exam_id,omitempty"`
	Role      string `json:"role"` // "student" or "invigilator"
	UserID    string `json:"user_id,omitempty"`
}

var (
	ErrInvalidToken = errors.New("invalid or expired token")
	ErrMissingToken = errors.New("missing authorization token")
)

// GenerateStudentToken creates a signed JWT for a student session.
func GenerateStudentToken(secret, studentID, name, examID string) (string, error) {
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user_stud_" + studentID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(4 * time.Hour)),
		},
		StudentID: studentID,
		Name:      name,
		ExamID:    examID,
		Role:      "student",
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GenerateInvigilatorToken creates a signed JWT for an invigilator session.
func GenerateInvigilatorToken(secret, userID, name string) (string, error) {
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user_inv_" + userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(8 * time.Hour)),
		},
		UserID: userID,
		Name:   name,
		Role:   "invigilator",
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ValidateToken parses and validates a JWT string, returning the claims.
func ValidateToken(secret, tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

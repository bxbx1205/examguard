package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Middleware returns a Gin middleware that validates JWT tokens from the
// Authorization header (Bearer scheme).
func Middleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error": gin.H{
					"code":    "UNAUTHORIZED",
					"message": "Missing Authorization header",
				},
			})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error": gin.H{
					"code":    "UNAUTHORIZED",
					"message": "Authorization header must use Bearer scheme",
				},
			})
			c.Abort()
			return
		}

		claims, err := ValidateToken(secret, parts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error": gin.H{
					"code":    "UNAUTHORIZED",
					"message": "Invalid or expired token",
				},
			})
			c.Abort()
			return
		}

		// Store claims in context for downstream handlers
		c.Set("claims", claims)
		c.Set("role", claims.Role)
		c.Set("user_id", claims.UserID)
		c.Set("student_id", claims.StudentID)
		c.Set("exam_id", claims.ExamID)

		c.Next()
	}
}

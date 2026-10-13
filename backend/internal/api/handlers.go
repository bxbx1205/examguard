package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime"
	"strconv"
	"time"

	"examguard-backend/internal/auth"
	"examguard-backend/internal/concurrency"
	"examguard-backend/internal/config"
	"examguard-backend/internal/scoring"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

// Server holds all dependencies for HTTP/WS route handlers.
type Server struct {
	cfg            *config.Config
	pool           *pgxpool.Pool
	rdb            *redis.Client
	minioClient    *minio.Client
	sessionManager *concurrency.SessionManager
	invHub         *concurrency.InvigilatorHub
	scoringEngine  *scoring.Engine
	startTime      time.Time
}

// NewServer creates a new API server with all injected dependencies.
func NewServer(
	cfg *config.Config,
	pool *pgxpool.Pool,
	rdb *redis.Client,
	minioClient *minio.Client,
	sm *concurrency.SessionManager,
	invHub *concurrency.InvigilatorHub,
	scorer *scoring.Engine,
) *Server {
	return &Server{
		cfg:            cfg,
		pool:           pool,
		rdb:            rdb,
		minioClient:    minioClient,
		sessionManager: sm,
		invHub:         invHub,
		scoringEngine:  scorer,
		startTime:      time.Now(),
	}
}

// SetupRoutes configures all REST and WebSocket routes on the Gin engine.
func (s *Server) SetupRoutes(r *gin.Engine) {
	// --- Public routes (no auth) ---
	api := r.Group("/api/v1")
	{
		api.GET("/health", s.handleHealth)
		api.GET("/metrics", s.handleMetrics)

		// Authentication
		api.POST("/auth/student/login", s.handleStudentLogin)
		api.POST("/auth/invigilator/login", s.handleInvigilatorLogin)
	}

	// --- Protected routes (JWT required) ---
	protected := r.Group("/api/v1")
	protected.Use(auth.Middleware(s.cfg.JWTSecret))
	{
		// Exams
		protected.GET("/exams", s.handleListExams)
		protected.GET("/exams/:exam_id", s.handleGetExam)
		protected.GET("/exams/:exam_id/candidates", s.handleListCandidates)
		protected.GET("/exams/:exam_id/candidates/:student_id", s.handleGetCandidate)
		protected.GET("/exams/:exam_id/events", s.handleListEvents)

		// Events
		protected.GET("/events/:event_id", s.handleGetEvent)
		protected.GET("/events/:event_id/snapshot", s.handleGetSnapshot)

		// Evidence
		protected.POST("/evidence/presigned-url", s.handlePresignedURL)

		// Invigilator actions (REST fallback)
		protected.POST("/exams/:exam_id/candidates/:student_id/actions", s.handleInvigilatorAction)
	}

	// --- WebSocket endpoints (JWT via query param) ---
	r.GET("/ws", s.handleInvigilatorWS)
	r.GET("/ws/telemetry", s.handleTelemetryWS)
	r.GET("/ws/invigilator", s.handleInvigilatorWS)
}

// =====================================================================
// Health & Metrics
// =====================================================================

func (s *Server) handleHealth(c *gin.Context) {
	ctx := c.Request.Context()

	// Check Postgres
	pgStatus := "UP"
	pgLatency := float64(0)
	start := time.Now()
	if err := s.pool.Ping(ctx); err != nil {
		pgStatus = "DOWN"
	}
	pgLatency = float64(time.Since(start).Microseconds()) / 1000.0

	// Check Redis
	redisStatus := "UP"
	redisLatency := float64(0)
	start = time.Now()
	if err := s.rdb.Ping(ctx).Err(); err != nil {
		redisStatus = "DOWN"
	}
	redisLatency = float64(time.Since(start).Microseconds()) / 1000.0

	// Check MinIO
	minioStatus := "UP"
	minioLatency := float64(0)
	if s.minioClient != nil {
		start = time.Now()
		_, err := s.minioClient.BucketExists(ctx, s.cfg.MinIOBucket)
		if err != nil {
			minioStatus = "DOWN"
		}
		minioLatency = float64(time.Since(start).Microseconds()) / 1000.0
	} else {
		minioStatus = "DOWN (FALLBACK)"
	}

	c.JSON(http.StatusOK, gin.H{
		"status":    "UP",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"components": gin.H{
			"postgres": gin.H{"status": pgStatus, "latency_ms": pgLatency},
			"redis":    gin.H{"status": redisStatus, "latency_ms": redisLatency},
			"minio":    gin.H{"status": minioStatus, "latency_ms": minioLatency},
		},
	})
}

func (s *Server) handleMetrics(c *gin.Context) {
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	c.JSON(http.StatusOK, gin.H{
		"active_websocket_connections": s.sessionManager.GetActiveSessions() + s.invHub.GetConnectionCount(),
		"active_goroutines":            runtime.NumGoroutine(),
		"events_ingested_per_second":   0, // TODO: implement rate tracking
		"memory_alloc_mb":              float64(memStats.Alloc) / 1024 / 1024,
		"uptime_seconds":               time.Since(s.startTime).Seconds(),
	})
}

// =====================================================================
// Authentication
// =====================================================================

func (s *Server) handleStudentLogin(c *gin.Context) {
	var req struct {
		ExamKey   string `json:"exam_key" binding:"required"`
		StudentID string `json:"student_id" binding:"required"`
		SecretPIN string `json:"secret_pin" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   gin.H{"code": "INVALID_REQUEST", "message": err.Error()},
		})
		return
	}

	ctx := c.Request.Context()

	// Look up exam by key pattern (exam_key maps to exam_id)
	var examID, examTitle string
	err := s.pool.QueryRow(ctx,
		`SELECT exam_id, title FROM exams WHERE exam_id = $1 OR title ILIKE '%' || $1 || '%' LIMIT 1`,
		req.ExamKey,
	).Scan(&examID, &examTitle)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   gin.H{"code": "EXAM_NOT_FOUND", "message": "Invalid exam key"},
		})
		return
	}

	// Verify student and PIN
	var studentName string
	err = s.pool.QueryRow(ctx,
		`SELECT name FROM students WHERE student_id = $1 AND exam_id = $2 AND secret_pin = $3`,
		req.StudentID, examID, req.SecretPIN,
	).Scan(&studentName)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   gin.H{"code": "AUTH_FAILED", "message": "Invalid credentials"},
		})
		return
	}

	// Generate JWT
	token, err := auth.GenerateStudentToken(s.cfg.JWTSecret, req.StudentID, studentName, examID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "TOKEN_ERROR", "message": "Failed to generate token"},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"token":      token,
		"expires_in": 14400,
		"student": gin.H{
			"student_id": req.StudentID,
			"name":       studentName,
			"exam_id":    examID,
			"exam_name":  examTitle,
		},
	})
}

func (s *Server) handleInvigilatorLogin(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   gin.H{"code": "INVALID_REQUEST", "message": err.Error()},
		})
		return
	}

	ctx := c.Request.Context()

	// Look up invigilator
	var userID, name, passwordHash string
	err := s.pool.QueryRow(ctx,
		`SELECT user_id, name, password_hash FROM invigilators WHERE username = $1`,
		req.Username,
	).Scan(&userID, &name, &passwordHash)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   gin.H{"code": "AUTH_FAILED", "message": "Invalid credentials"},
		})
		return
	}

	// For development: accept raw password comparison or hashed
	// TODO: Use bcrypt for production
	if passwordHash != req.Password {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   gin.H{"code": "AUTH_FAILED", "message": "Invalid credentials"},
		})
		return
	}

	token, err := auth.GenerateInvigilatorToken(s.cfg.JWTSecret, userID, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "TOKEN_ERROR", "message": "Failed to generate token"},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"token":   token,
		"user": gin.H{
			"user_id": userID,
			"name":    name,
			"role":    "INVIGILATOR",
		},
	})
}

// =====================================================================
// Exams Management
// =====================================================================

func (s *Server) handleListExams(c *gin.Context) {
	ctx := c.Request.Context()
	rows, err := s.pool.Query(ctx,
		`SELECT exam_id, title, start_time, end_time, duration_minutes, status, total_students FROM exams ORDER BY start_time DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "DB_ERROR", "message": "Failed to query exams"},
		})
		return
	}
	defer rows.Close()

	var exams []gin.H
	for rows.Next() {
		var examID, title, status string
		var startTime, endTime time.Time
		var durationMinutes, totalStudents int
		if err := rows.Scan(&examID, &title, &startTime, &endTime, &durationMinutes, &status, &totalStudents); err != nil {
			continue
		}
		exams = append(exams, gin.H{
			"exam_id":          examID,
			"title":            title,
			"start_time":       startTime.Format(time.RFC3339),
			"end_time":         endTime.Format(time.RFC3339),
			"duration_minutes": durationMinutes,
			"status":           status,
			"total_students":   totalStudents,
		})
	}

	if exams == nil {
		exams = []gin.H{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"exams":   exams,
	})
}

func (s *Server) handleGetExam(c *gin.Context) {
	examID := c.Param("exam_id")
	ctx := c.Request.Context()

	var title, status string
	var startTime, endTime time.Time
	var durationMinutes, totalStudents int
	var rules json.RawMessage

	err := s.pool.QueryRow(ctx,
		`SELECT title, start_time, end_time, duration_minutes, status, total_students, rules FROM exams WHERE exam_id = $1`,
		examID,
	).Scan(&title, &startTime, &endTime, &durationMinutes, &status, &totalStudents, &rules)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   gin.H{"code": "RESOURCE_NOT_FOUND", "message": fmt.Sprintf("Exam %s not found", examID)},
		})
		return
	}

	var rulesMap map[string]interface{}
	json.Unmarshal(rules, &rulesMap)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"exam": gin.H{
			"exam_id":          examID,
			"title":            title,
			"start_time":       startTime.Format(time.RFC3339),
			"end_time":         endTime.Format(time.RFC3339),
			"duration_minutes": durationMinutes,
			"status":           status,
			"total_students":   totalStudents,
			"rules":            rulesMap,
		},
	})
}

// =====================================================================
// Candidates
// =====================================================================

func (s *Server) handleListCandidates(c *gin.Context) {
	examID := c.Param("exam_id")
	ctx := c.Request.Context()

	rows, err := s.pool.Query(ctx,
		`SELECT st.student_id, st.name,
		        COALESCE(s.trust_score, 100) as trust_score,
		        COALESCE(s.status, 'ACTIVE') as status,
		        s.last_violation
		 FROM students st
		 LEFT JOIN sessions s ON st.student_id = s.student_id AND st.exam_id = s.exam_id
		 WHERE st.exam_id = $1
		 ORDER BY st.student_id`,
		examID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "DB_ERROR", "message": "Failed to query candidates"},
		})
		return
	}
	defer rows.Close()

	var candidates []gin.H
	for rows.Next() {
		var studentID, name, status string
		var trustScore int
		var lastViolation *string
		if err := rows.Scan(&studentID, &name, &trustScore, &status, &lastViolation); err != nil {
			continue
		}
		candidates = append(candidates, gin.H{
			"student_id":     studentID,
			"name":           name,
			"trust_score":    trustScore,
			"status":         status,
			"last_violation": lastViolation,
		})
	}

	if candidates == nil {
		candidates = []gin.H{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"total":      len(candidates),
		"candidates": candidates,
	})
}

func (s *Server) handleGetCandidate(c *gin.Context) {
	examID := c.Param("exam_id")
	studentID := c.Param("student_id")
	ctx := c.Request.Context()

	// Get candidate info
	var name, status string
	var trustScore int
	var lastViolation *string
	err := s.pool.QueryRow(ctx,
		`SELECT st.name,
		        COALESCE(s.trust_score, 100),
		        COALESCE(s.status, 'ACTIVE'),
		        s.last_violation
		 FROM students st
		 LEFT JOIN sessions s ON st.student_id = s.student_id AND st.exam_id = s.exam_id
		 WHERE st.exam_id = $1 AND st.student_id = $2`,
		examID, studentID,
	).Scan(&name, &trustScore, &status, &lastViolation)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   gin.H{"code": "RESOURCE_NOT_FOUND", "message": fmt.Sprintf("Candidate %s not found in exam %s", studentID, examID)},
		})
		return
	}

	// Get event timeline
	rows, err := s.pool.Query(ctx,
		`SELECT event_id, timestamp, subtype, severity, penalty
		 FROM events WHERE exam_id = $1 AND student_id = $2
		 ORDER BY timestamp DESC`,
		examID, studentID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "DB_ERROR", "message": "Failed to query timeline"},
		})
		return
	}
	defer rows.Close()

	var timeline []gin.H
	for rows.Next() {
		var eventID, subtype, severity string
		var ts time.Time
		var penalty float64
		if err := rows.Scan(&eventID, &ts, &subtype, &severity, &penalty); err != nil {
			continue
		}
		timeline = append(timeline, gin.H{
			"event_id":  eventID,
			"timestamp": ts.Format(time.RFC3339),
			"subtype":   subtype,
			"severity":  severity,
			"penalty":   penalty,
		})
	}

	if timeline == nil {
		timeline = []gin.H{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"candidate": gin.H{
			"student_id":       studentID,
			"name":             name,
			"trust_score":      trustScore,
			"status":           status,
			"last_violation":   lastViolation,
			"violations_count": len(timeline),
			"timeline":         timeline,
		},
	})
}

// =====================================================================
// Events / Incidents
// =====================================================================

func (s *Server) handleListEvents(c *gin.Context) {
	examID := c.Param("exam_id")
	ctx := c.Request.Context()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	severityFilter := c.Query("severity")
	studentFilter := c.Query("student_id")

	// Build query dynamically
	query := `SELECT event_id, student_id, timestamp, category, subtype, severity, confidence, message, snapshot_key
	          FROM events WHERE exam_id = $1`
	args := []interface{}{examID}
	argIdx := 2

	if severityFilter != "" {
		query += fmt.Sprintf(" AND severity = $%d", argIdx)
		args = append(args, severityFilter)
		argIdx++
	}
	if studentFilter != "" {
		query += fmt.Sprintf(" AND student_id = $%d", argIdx)
		args = append(args, studentFilter)
		argIdx++
	}

	// Count total
	countQuery := "SELECT COUNT(*) FROM events WHERE exam_id = $1"
	countArgs := []interface{}{examID}
	if severityFilter != "" {
		countQuery += " AND severity = $2"
		countArgs = append(countArgs, severityFilter)
	}
	if studentFilter != "" {
		idx := len(countArgs) + 1
		countQuery += fmt.Sprintf(" AND student_id = $%d", idx)
		countArgs = append(countArgs, studentFilter)
	}

	var totalRecords int
	s.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&totalRecords)

	query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "DB_ERROR", "message": "Failed to query events"},
		})
		return
	}
	defer rows.Close()

	var events []gin.H
	for rows.Next() {
		var eventID, studentID, category, subtype, severity, message string
		var ts time.Time
		var confidence float64
		var snapshotKey *string
		if err := rows.Scan(&eventID, &studentID, &ts, &category, &subtype, &severity, &confidence, &message, &snapshotKey); err != nil {
			continue
		}
		events = append(events, gin.H{
			"event_id":     eventID,
			"student_id":   studentID,
			"timestamp":    ts.Format(time.RFC3339Nano),
			"category":     category,
			"subtype":      subtype,
			"severity":     severity,
			"confidence":   confidence,
			"message":      message,
			"snapshot_key": snapshotKey,
		})
	}

	if events == nil {
		events = []gin.H{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"page":          page,
		"limit":         limit,
		"total_records": totalRecords,
		"events":        events,
	})
}

func (s *Server) handleGetEvent(c *gin.Context) {
	eventID := c.Param("event_id")
	ctx := c.Request.Context()

	var studentID, category, subtype, severity, message, sessionID, examID string
	var ts time.Time
	var confidence, penalty float64
	var snapshotKey *string
	var metrics json.RawMessage

	err := s.pool.QueryRow(ctx,
		`SELECT event_id, session_id, exam_id, student_id, timestamp, category, subtype, severity, confidence, metrics, snapshot_key, message, penalty
		 FROM events WHERE event_id = $1`,
		eventID,
	).Scan(&eventID, &sessionID, &examID, &studentID, &ts, &category, &subtype, &severity, &confidence, &metrics, &snapshotKey, &message, &penalty)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   gin.H{"code": "RESOURCE_NOT_FOUND", "message": fmt.Sprintf("Event %s not found", eventID)},
		})
		return
	}

	var metricsMap map[string]interface{}
	json.Unmarshal(metrics, &metricsMap)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"event": gin.H{
			"event_id":     eventID,
			"session_id":   sessionID,
			"exam_id":      examID,
			"student_id":   studentID,
			"timestamp":    ts.Format(time.RFC3339Nano),
			"category":     category,
			"subtype":      subtype,
			"severity":     severity,
			"confidence":   confidence,
			"metrics":      metricsMap,
			"snapshot_key": snapshotKey,
			"message":      message,
			"penalty":      penalty,
		},
	})
}

// =====================================================================
// Evidence & Snapshots
// =====================================================================

func (s *Server) handlePresignedURL(c *gin.Context) {
	var req struct {
		ExamID       string `json:"exam_id" binding:"required"`
		StudentID    string `json:"student_id" binding:"required"`
		EventSubtype string `json:"event_subtype"`
		ContentType  string `json:"content_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   gin.H{"code": "INVALID_REQUEST", "message": err.Error()},
		})
		return
	}

	if req.ContentType == "" {
		req.ContentType = "image/jpeg"
	}

	// Generate unique object key
	now := time.Now().UTC()
	objectKey := fmt.Sprintf("evidence/%s/%s/stud_%s_evt_%s.jpg",
		now.Format("2006-01-02"), req.ExamID, req.StudentID, uuid.New().String()[:8])

	// Generate presigned PUT URL (15 minutes)
	if s.minioClient == nil {
		c.JSON(http.StatusOK, gin.H{
			"success":            true,
			"upload_url":         fmt.Sprintf("http://%s/%s/%s", s.cfg.MinIOEndpoint, s.cfg.MinIOBucket, objectKey),
			"snapshot_key":       objectKey,
			"expires_in_seconds": 900,
			"mock":               true,
		})
		return
	}

	presignedURL, err := s.minioClient.PresignedPutObject(
		c.Request.Context(),
		s.cfg.MinIOBucket,
		objectKey,
		15*time.Minute,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "S3_ERROR", "message": "Failed to generate presigned URL"},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":            true,
		"upload_url":         presignedURL.String(),
		"snapshot_key":       objectKey,
		"expires_in_seconds": 900,
	})
}

func (s *Server) handleGetSnapshot(c *gin.Context) {
	eventID := c.Param("event_id")
	ctx := c.Request.Context()

	var snapshotKey *string
	err := s.pool.QueryRow(ctx,
		`SELECT snapshot_key FROM events WHERE event_id = $1`, eventID,
	).Scan(&snapshotKey)
	if err != nil || snapshotKey == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   gin.H{"code": "RESOURCE_NOT_FOUND", "message": "No snapshot for this event"},
		})
		return
	}

	if s.minioClient == nil {
		c.JSON(http.StatusOK, gin.H{
			"success":            true,
			"event_id":           eventID,
			"snapshot_url":       fmt.Sprintf("http://%s/%s/%s", s.cfg.MinIOEndpoint, s.cfg.MinIOBucket, *snapshotKey),
			"expires_in_seconds": 3600,
			"mock":               true,
		})
		return
	}

	// Generate presigned GET URL (1 hour)
	presignedURL, err := s.minioClient.PresignedGetObject(
		ctx,
		s.cfg.MinIOBucket,
		*snapshotKey,
		1*time.Hour,
		nil,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "S3_ERROR", "message": "Failed to generate snapshot URL"},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"event_id":     eventID,
		"snapshot_url":  presignedURL.String(),
		"expires_at":   time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
	})
}

// =====================================================================
// Invigilator Actions (REST Fallback)
// =====================================================================

func (s *Server) handleInvigilatorAction(c *gin.Context) {
	examID := c.Param("exam_id")
	studentID := c.Param("student_id")

	var req struct {
		Action  string `json:"action" binding:"required"`
		Message string `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   gin.H{"code": "INVALID_REQUEST", "message": err.Error()},
		})
		return
	}

	ctx := c.Request.Context()

	// Build the command to send to the student's extension
	var command interface{}
	switch req.Action {
	case "WARN":
		command = gin.H{
			"type":   "COMMAND",
			"action": "PROCTOR_WARNING",
			"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
			"payload": gin.H{
				"warning_title":      "Integrity Warning",
				"message":            req.Message,
				"issued_by":          "Invigilator",
				"current_trust_score": s.scoringEngine.GetScore(""),
			},
		}
	case "LOCK":
		command = gin.H{
			"type":   "COMMAND",
			"action": "LOCK_EXAM",
			"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
			"payload": gin.H{
				"reason":              req.Message,
				"unlock_code_required": false,
			},
		}
	case "TERMINATE":
		command = gin.H{
			"type":   "COMMAND",
			"action": "TERMINATE_EXAM",
			"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
			"payload": gin.H{
				"reason":           req.Message,
				"final_trust_score": 0,
				"redirect_url":    "https://exam.university.edu/disqualified",
			},
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   gin.H{"code": "INVALID_ACTION", "message": "Action must be WARN, LOCK, or TERMINATE"},
		})
		return
	}

	// Dispatch to candidate
	err := s.sessionManager.SendCommand(examID, studentID, command)
	if err != nil {
		log.Printf("[action] could not dispatch to student %s: %v", studentID, err)
	}

	// Log action in database
	actionID := "act_" + uuid.New().String()[:12]
	s.pool.Exec(ctx,
		`INSERT INTO actions (action_id, exam_id, student_id, action_type, message)
		 VALUES ($1, $2, $3, $4, $5)`,
		actionID, examID, studentID, req.Action, req.Message,
	)

	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"dispatched_at": time.Now().UTC().Format(time.RFC3339Nano),
		"status":        "DELIVERED",
	})
}

// =====================================================================
// WebSocket: Candidate Telemetry
// =====================================================================

func (s *Server) handleTelemetryWS(c *gin.Context) {
	// Authenticate via query param
	tokenStr := c.Query("token")
	examID := c.Query("exam_id")

	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token query parameter"})
		return
	}

	// For development: accept "dev_token" for testing
	var studentID, studentName string
	if tokenStr == "dev_token" {
		studentID = "dev_student"
		studentName = "Dev Student"
		if examID == "" {
			examID = "exam_dev"
		}
	} else {
		claims, err := auth.ValidateToken(s.cfg.JWTSecret, tokenStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}
		if claims.Role != "student" {
			c.JSON(http.StatusForbidden, gin.H{"error": "token role must be student"})
			return
		}
		studentID = claims.StudentID
		studentName = claims.Name
		if examID == "" {
			examID = claims.ExamID
		}
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[ws/telemetry] upgrade error: %v", err)
		return
	}

	// Wait for SESSION_INIT
	_, initMsg, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return
	}

	var initPayload struct {
		Type      string          `json:"type"`
		EventID   string          `json:"event_id"`
		ExamID    string          `json:"exam_id"`
		StudentID string          `json:"student_id"`
		Payload   json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(initMsg, &initPayload); err != nil || initPayload.Type != "SESSION_INIT" {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4400, "Expected SESSION_INIT as first frame"))
		conn.Close()
		return
	}

	// Use student ID from the init payload if it was provided and matches auth
	if initPayload.StudentID != "" {
		studentID = initPayload.StudentID
	}
	if initPayload.ExamID != "" {
		examID = initPayload.ExamID
	}

	// Check if client provided student_name in payload
	var clientPayload struct {
		StudentName string `json:"student_name"`
	}
	if err := json.Unmarshal(initPayload.Payload, &clientPayload); err == nil && clientPayload.StudentName != "" {
		studentName = clientPayload.StudentName
	}

	// Look up student name from DB if not from token or client payload
	if studentName == "" || studentName == "Dev Student" {
		ctx := context.Background()
		s.pool.QueryRow(ctx,
			`SELECT name FROM students WHERE student_id = $1 AND exam_id = $2`,
			studentID, examID,
		).Scan(&studentName)
		if studentName == "" {
			studentName = "Student " + studentID
		}
	}

	// Generate session ID
	sessionID := fmt.Sprintf("sess_%s_stud_%s_%s", examID, studentID, time.Now().Format("20060102"))

	// Register session — this sends ACK and starts goroutines
	ctx := context.Background()
	s.sessionManager.RegisterSession(ctx, conn, sessionID, examID, studentID, studentName, initPayload.Payload)
}

// =====================================================================
// WebSocket: Invigilator Dashboard
// =====================================================================

func (s *Server) handleInvigilatorWS(c *gin.Context) {
	tokenStr := c.Query("token")
	examID := c.Query("exam_id")

	// For development: accept empty token or "inv_token" for instant local testing
	var userID string
	if tokenStr == "" || tokenStr == "inv_token" {
		userID = "inv_dev"
		if examID == "" {
			examID = "exam_2026_cs501"
		}
	} else {
		claims, err := auth.ValidateToken(s.cfg.JWTSecret, tokenStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}
		if claims.Role != "invigilator" {
			c.JSON(http.StatusForbidden, gin.H{"error": "token role must be invigilator"})
			return
		}
		userID = claims.UserID
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[ws/invigilator] upgrade error: %v", err)
		return
	}

	connID := fmt.Sprintf("inv_%s_%s", userID, uuid.New().String()[:8])

	// Build initial state from DB
	initialState := s.buildInitialState(c.Request.Context(), examID)

	invConn := &concurrency.InvigilatorConn{
		ID:       connID,
		ExamID:   examID,
		UserID:   userID,
		Conn:     conn,
		SendChan: make(chan []byte, 256),
	}

	// Register with the hub
	s.invHub.Register(invConn)

	// Send INITIAL_STATE
	stateBytes, _ := json.Marshal(initialState)
	invConn.SendChan <- stateBytes

	// Read pump for invigilator actions
	go s.invigilatorReadPump(invConn)
}

// buildInitialState constructs the INITIAL_STATE payload from the database.
func (s *Server) buildInitialState(ctx context.Context, examID string) map[string]interface{} {
	// Get exam info
	var examName string
	s.pool.QueryRow(ctx, `SELECT title FROM exams WHERE exam_id = $1`, examID).Scan(&examName)
	if examName == "" {
		examName = examID
	}

	// Get candidates
	rows, _ := s.pool.Query(ctx,
		`SELECT st.student_id, st.name,
		        COALESCE(s.trust_score, 100) as trust_score,
		        COALESCE(s.status, 'DISCONNECTED') as status,
		        s.last_violation,
		        COALESCE(s.camera_active, false) as camera_active,
		        COALESCE(s.mic_active, false) as mic_active
		 FROM students st
		 LEFT JOIN sessions s ON st.student_id = s.student_id AND st.exam_id = s.exam_id AND s.ended_at IS NULL
		 WHERE st.exam_id = $1
		 ORDER BY st.student_id`,
		examID,
	)

	var candidates []map[string]interface{}
	activeCount, flaggedCount, disconnectedCount := 0, 0, 0

	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var studentID, name, status string
			var trustScore int
			var lastViolation *string
			var cameraActive, micActive bool
			if err := rows.Scan(&studentID, &name, &trustScore, &status, &lastViolation, &cameraActive, &micActive); err != nil {
				continue
			}

			// Cross-check in-memory session manager for real-time live connection state
			if s.sessionManager != nil {
				for _, sess := range s.sessionManager.GetCandidatesForExam(examID) {
					if sess.StudentID == studentID {
						status = string(sess.Status)
						cameraActive = sess.CameraActive
						micActive = sess.MicrophoneActive
						trustScore = sess.TrustScore
						break
					}
				}
			}

			candidates = append(candidates, map[string]interface{}{
				"student_id":        studentID,
				"name":              name,
				"trust_score":       trustScore,
				"status":            status,
				"last_violation":    lastViolation,
				"camera_active":     cameraActive,
				"microphone_active": micActive,
			})
			switch status {
			case "ACTIVE":
				activeCount++
			case "FLAGGED":
				flaggedCount++
			default:
				disconnectedCount++
			}
		}
	}

	if candidates == nil {
		candidates = []map[string]interface{}{}
	}

	return map[string]interface{}{
		"type":      "INITIAL_STATE",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload": map[string]interface{}{
			"exam_id":   examID,
			"exam_name": examName,
			"summary": map[string]interface{}{
				"total_registered":   len(candidates),
				"active_count":       activeCount,
				"flagged_count":      flaggedCount,
				"disconnected_count": disconnectedCount,
			},
			"candidates": candidates,
		},
	}
}

// invigilatorReadPump reads messages from the invigilator dashboard.
func (s *Server) invigilatorReadPump(conn *concurrency.InvigilatorConn) {
	defer s.invHub.Unregister(conn.ID)

	for {
		_, message, err := conn.Conn.ReadMessage()
		if err != nil {
			return
		}

		var envelope struct {
			Action  string `json:"action"`
			ExamID  string `json:"exam_id"`
			Payload struct {
				ActionType string `json:"action_type"`
				StudentID  string `json:"student_id"`
				Message    string `json:"message"`
				Reason     string `json:"reason"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(message, &envelope); err != nil {
			continue
		}

		if envelope.Action != "INVIGILATOR_ACTION" {
			continue
		}

		examID := envelope.ExamID
		if examID == "" {
			examID = conn.ExamID
		}

		log.Printf("[invigilator] action=%s student=%s exam=%s",
			envelope.Payload.ActionType, envelope.Payload.StudentID, examID)

		// Build the command
		var command interface{}
		switch envelope.Payload.ActionType {
		case "WARN":
			command = map[string]interface{}{
				"type":   "COMMAND",
				"action": "PROCTOR_WARNING",
				"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
				"payload": map[string]interface{}{
					"warning_title": "Integrity Warning",
					"message":       envelope.Payload.Message,
					"issued_by":     "Invigilator",
				},
			}
		case "LOCK":
			command = map[string]interface{}{
				"type":   "COMMAND",
				"action": "LOCK_EXAM",
				"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
				"payload": map[string]interface{}{
					"reason":              envelope.Payload.Reason,
					"unlock_code_required": false,
				},
			}
		case "TERMINATE":
			command = map[string]interface{}{
				"type":   "COMMAND",
				"action": "TERMINATE_EXAM",
				"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
				"payload": map[string]interface{}{
					"reason":       envelope.Payload.Reason,
					"redirect_url": "https://exam.university.edu/disqualified",
				},
			}
		default:
			continue
		}

		// Dispatch to student
		s.sessionManager.SendCommand(examID, envelope.Payload.StudentID, command)

		// Send ACK
		ack := map[string]interface{}{
			"type":       "INVIGILATOR_ACTION_ACK",
			"action_id":  "act_" + uuid.New().String()[:12],
			"student_id": envelope.Payload.StudentID,
			"status":     "DISPATCHED_TO_STUDENT",
			"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
		}
		ackBytes, _ := json.Marshal(ack)
		conn.SendChan <- ackBytes
	}
}

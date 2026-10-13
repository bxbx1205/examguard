package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"examguard-backend/internal/api"
	"examguard-backend/internal/concurrency"
	"examguard-backend/internal/config"
	"examguard-backend/internal/scoring"
	"examguard-backend/internal/storage"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("========================================")
	log.Println("  🛡️  ExamGuard Backend Starting...")
	log.Println("========================================")

	// ---- Load Configuration ----
	cfg := config.Load()
	log.Printf("[config] Server port: %s | PostgreSQL: %s:%d | Redis: %s | MinIO: %s",
		cfg.Port, cfg.PostgresHost, cfg.PostgresPort, cfg.RedisAddr, cfg.MinIOEndpoint,
	)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ---- Connect to PostgreSQL ----
	pool, err := storage.NewPostgresPool(ctx, cfg.PostgresDSN())
	if err != nil {
		log.Fatalf("[FATAL] PostgreSQL: %v", err)
	}
	defer pool.Close()

	// ---- Run Migrations ----
	if err := storage.RunMigrations(ctx, pool); err != nil {
		log.Fatalf("[FATAL] Migrations: %v", err)
	}

	// ---- Seed demo data for development ----
	seedDemoData(ctx, pool)

	// ---- Connect to Redis ----
	rdb, err := storage.NewRedisClient(ctx, cfg.RedisAddr)
	if err != nil {
		log.Fatalf("[FATAL] Redis: %v", err)
	}
	defer rdb.Close()

	// ---- Connect to MinIO (Non-fatal fallback if unavailable) ----
	minioClient, err := storage.NewMinIOClient(
		ctx, cfg.MinIOEndpoint, cfg.MinIOAccessKey, cfg.MinIOSecretKey, cfg.MinIOBucket, cfg.MinIOUseSSL,
	)
	if err != nil {
		log.Printf("⚠️  [WARN] MinIO: failed to connect: %v", err)
		log.Println("⚠️  [WARN] Continuing without MinIO. Snapshot features will run in mock mode.")
		minioClient = nil
	}

	// ---- Initialize Scoring Engine ----
	scorer := scoring.NewEngine()

	// ---- Initialize Session Manager ----
	sm := concurrency.NewSessionManager(pool, rdb, scorer)

	// ---- Initialize Invigilator Hub ----
	invHub := concurrency.NewInvigilatorHub()
	go invHub.BroadcastLoop(sm.IncidentChan)

	// ---- Initialize API Server ----
	server := api.NewServer(cfg, pool, rdb, minioClient, sm, invHub, scorer)

	// ---- Setup Gin Router ----
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	server.SetupRoutes(router)

	// ---- Start HTTP Server ----
	addr := ":" + cfg.Port
	httpServer := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("🚀 ExamGuard backend listening on http://0.0.0.0%s", addr)
		log.Printf("   REST API:            http://localhost%s/api/v1", addr)
		log.Printf("   Telemetry WebSocket:  ws://localhost%s/ws/telemetry", addr)
		log.Printf("   Invigilator WebSocket: ws://localhost%s/ws/invigilator", addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[FATAL] server: %v", err)
		}
	}()

	// ---- Graceful Shutdown ----
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("⏳ Shutting down gracefully...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("[ERROR] server shutdown: %v", err)
	}

	cancel() // cancel background context
	log.Println("✅ ExamGuard backend stopped.")
}

// seedDemoData inserts sample exam and student data for development & testing.
func seedDemoData(ctx context.Context, pool *pgxpool.Pool) {
	log.Println("[seed] checking for demo data...")

	// Check if demo exam already exists
	var count int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM exams WHERE exam_id = 'exam_2026_cs501'`).Scan(&count)
	if err != nil {
		log.Printf("[seed] error checking for demo data: %v", err)
		return
	}
	if count > 0 {
		log.Println("[seed] demo data already exists, skipping seed")
		return
	}

	log.Println("[seed] inserting demo exam, students, and invigilator...")

	// Insert demo exam
	_, err = pool.Exec(ctx, `
		INSERT INTO exams (exam_id, title, start_time, end_time, duration_minutes, status, total_students, rules)
		VALUES (
			'exam_2026_cs501',
			'CS501 - Distributed Systems End-Semester',
			'2026-09-14T17:00:00Z',
			'2026-09-14T19:00:00Z',
			120,
			'LIVE',
			6,
			'{"face_missing_tolerance_sec": 5.0, "gaze_deviation_tolerance_sec": 3.5, "max_tab_switches_permitted": 2, "disqualification_threshold": 40}'
		)
	`)
	if err != nil {
		log.Printf("[seed] error inserting exam: %v", err)
		return
	}

	// Insert demo students
	students := []struct {
		ID   string
		Name string
		PIN  string
	}{
		{"49", "Atharva Mandle", "8492"},
		{"46", "Taher Sanawadwala", "1234"},
		{"50", "Anushka Patel", "5678"},
		{"52", "Dimpal Sharma", "9012"},
		{"38", "Aryan Karande", "3456"},
		{"12", "Rohan Sharma", "7890"},
	}

	for _, s := range students {
		_, err := pool.Exec(ctx,
			`INSERT INTO students (student_id, exam_id, name, secret_pin) VALUES ($1, 'exam_2026_cs501', $2, $3)`,
			s.ID, s.Name, s.PIN,
		)
		if err != nil {
			log.Printf("[seed] error inserting student %s: %v", s.ID, err)
		}
	}

	// Insert demo invigilator
	_, err = pool.Exec(ctx, `
		INSERT INTO invigilators (user_id, username, password_hash, name)
		VALUES ('inv_01', 'prof_tiwari', 'hashed_password', 'Prof. Saurabh Tiwari')
	`)
	if err != nil {
		log.Printf("[seed] error inserting invigilator: %v", err)
	}

	log.Println("[seed] ✅ demo data seeded successfully")
}

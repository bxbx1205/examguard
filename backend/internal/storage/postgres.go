package storage

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPostgresPool creates a connection pool to PostgreSQL with health-checked retry logic.

func NewPostgresPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}

	config.MaxConns = 25
	config.MinConns = 5
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute

	var lastErr error

	for i := 0; i < 10; i++ {
		pool, err := pgxpool.NewWithConfig(ctx, config)

		if err != nil {
			lastErr = err
		} else {
			lastErr = pool.Ping(ctx)

			if lastErr == nil {
				log.Println("[postgres] connection pool established")
				return pool, nil
			}

			pool.Close()
		}

		log.Printf(
			"[postgres] connection attempt %d/10 failed: %v",
			i+1, lastErr,
		)

		if i < 9 {
			time.Sleep(2 * time.Second)
		}
	}

	return nil, fmt.Errorf(
		"postgres: failed to connect after 10 attempts: %w",
		lastErr,
	)
}

// RunMigrations creates all tables required by ExamGuard if they don't exist.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	schema := `
	-- Exams table
	CREATE TABLE IF NOT EXISTS exams (
		exam_id        TEXT PRIMARY KEY,
		title          TEXT NOT NULL,
		start_time     TIMESTAMPTZ NOT NULL,
		end_time       TIMESTAMPTZ NOT NULL,
		duration_minutes INTEGER NOT NULL DEFAULT 120,
		status         TEXT NOT NULL DEFAULT 'SCHEDULED',
		total_students INTEGER NOT NULL DEFAULT 0,
		rules          JSONB NOT NULL DEFAULT '{}',
		created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	-- Students table (registered candidates per exam)
	CREATE TABLE IF NOT EXISTS students (
		student_id     TEXT NOT NULL,
		exam_id        TEXT NOT NULL REFERENCES exams(exam_id),
		name           TEXT NOT NULL,
		secret_pin     TEXT NOT NULL DEFAULT '0000',
		created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		PRIMARY KEY (student_id, exam_id)
	);

	-- Sessions table (one per student per exam attempt)
	CREATE TABLE IF NOT EXISTS sessions (
		session_id     TEXT PRIMARY KEY,
		exam_id        TEXT NOT NULL REFERENCES exams(exam_id),
		student_id     TEXT NOT NULL,
		trust_score    INTEGER NOT NULL DEFAULT 100,
		status         TEXT NOT NULL DEFAULT 'ACTIVE',
		last_violation TEXT,
		camera_active  BOOLEAN NOT NULL DEFAULT true,
		mic_active     BOOLEAN NOT NULL DEFAULT true,
		started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		ended_at       TIMESTAMPTZ,
		client_info    JSONB
	);

	-- Event logs table (all telemetry anomaly events)
	CREATE TABLE IF NOT EXISTS events (
		event_id       TEXT PRIMARY KEY,
		session_id     TEXT NOT NULL REFERENCES sessions(session_id),
		exam_id        TEXT NOT NULL,
		student_id     TEXT NOT NULL,
		timestamp      TIMESTAMPTZ NOT NULL,
		category       TEXT NOT NULL,
		subtype        TEXT NOT NULL,
		severity       TEXT NOT NULL,
		confidence     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
		metrics        JSONB,
		snapshot_key   TEXT,
		message        TEXT NOT NULL DEFAULT '',
		penalty        DOUBLE PRECISION NOT NULL DEFAULT 0.0,
		created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	-- Invigilator users table
	CREATE TABLE IF NOT EXISTS invigilators (
		user_id        TEXT PRIMARY KEY,
		username       TEXT UNIQUE NOT NULL,
		password_hash  TEXT NOT NULL,
		name           TEXT NOT NULL,
		created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	-- Invigilator actions log
	CREATE TABLE IF NOT EXISTS actions (
		action_id      TEXT PRIMARY KEY,
		exam_id        TEXT NOT NULL,
		student_id     TEXT NOT NULL,
		action_type    TEXT NOT NULL,
		message        TEXT,
		reason         TEXT,
		issued_by      TEXT,
		dispatched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	-- Indexes for common query patterns
	CREATE INDEX IF NOT EXISTS idx_events_exam_id ON events(exam_id);
	CREATE INDEX IF NOT EXISTS idx_events_student_id ON events(student_id);
	CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
	CREATE INDEX IF NOT EXISTS idx_sessions_exam_id ON sessions(exam_id);
	CREATE INDEX IF NOT EXISTS idx_sessions_student_id ON sessions(student_id);
	`

	_, err := pool.Exec(ctx, schema)
	if err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	log.Println("[postgres] schema migrations applied successfully")
	return nil
}

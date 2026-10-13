package config

import (
	"os"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// Clear any env vars that might interfere
	envVars := []string{
		"PORT", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER",
		"POSTGRES_PASSWORD", "POSTGRES_DB", "REDIS_ADDR",
		"MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY",
		"MINIO_BUCKET", "MINIO_USE_SSL", "JWT_SECRET",
	}
	for _, v := range envVars {
		os.Unsetenv(v)
	}

	cfg := Load()

	tests := []struct {
		field string
		got   string
		want  string
	}{
		{"Port", cfg.Port, "8080"},
		{"PostgresHost", cfg.PostgresHost, "localhost"},
		{"PostgresUser", cfg.PostgresUser, "examguard_admin"},
		{"PostgresPassword", cfg.PostgresPassword, "examguard_secret_2026"},
		{"PostgresDB", cfg.PostgresDB, "examguard_db"},
		{"RedisAddr", cfg.RedisAddr, "localhost:6379"},
		{"MinIOEndpoint", cfg.MinIOEndpoint, "localhost:9000"},
		{"MinIOAccessKey", cfg.MinIOAccessKey, "minioadmin"},
		{"MinIOSecretKey", cfg.MinIOSecretKey, "minioadmin123"},
		{"MinIOBucket", cfg.MinIOBucket, "examguard-evidence"},
		{"JWTSecret", cfg.JWTSecret, "super_secret_examguard_jwt_key_2026"},
	}

	for _, tt := range tests {
		if tt.got != tt.want {
			t.Errorf("default %s = %q, want %q", tt.field, tt.got, tt.want)
		}
	}

	if cfg.PostgresPort != 5434 {
		t.Errorf("default PostgresPort = %d, want 5434", cfg.PostgresPort)
	}

	if cfg.MinIOUseSSL != false {
		t.Error("default MinIOUseSSL should be false")
	}
}

func TestLoad_EnvironmentOverrides(t *testing.T) {
	// Set env vars
	overrides := map[string]string{
		"PORT":             "9090",
		"POSTGRES_HOST":    "db.production.internal",
		"POSTGRES_PORT":    "5433",
		"POSTGRES_USER":    "prod_user",
		"POSTGRES_PASSWORD": "prod_pass",
		"POSTGRES_DB":      "prod_db",
		"REDIS_ADDR":       "redis.cluster:6380",
		"MINIO_ENDPOINT":   "s3.amazonaws.com",
		"MINIO_ACCESS_KEY": "AKIAIOSFODNN7EXAMPLE",
		"MINIO_SECRET_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		"MINIO_BUCKET":     "prod-evidence-bucket",
		"MINIO_USE_SSL":    "true",
		"JWT_SECRET":       "production_jwt_secret_very_long_key_2026",
	}

	for k, v := range overrides {
		os.Setenv(k, v)
	}
	defer func() {
		for k := range overrides {
			os.Unsetenv(k)
		}
	}()

	cfg := Load()

	if cfg.Port != "9090" {
		t.Errorf("Port = %q, want %q", cfg.Port, "9090")
	}
	if cfg.PostgresHost != "db.production.internal" {
		t.Errorf("PostgresHost = %q, want %q", cfg.PostgresHost, "db.production.internal")
	}
	if cfg.PostgresPort != 5433 {
		t.Errorf("PostgresPort = %d, want 5433", cfg.PostgresPort)
	}
	if cfg.MinIOUseSSL != true {
		t.Error("MinIOUseSSL should be true when MINIO_USE_SSL=true")
	}
	if cfg.JWTSecret != "production_jwt_secret_very_long_key_2026" {
		t.Errorf("JWTSecret = %q, want override", cfg.JWTSecret)
	}
}

func TestLoad_InvalidPortFallback(t *testing.T) {
	os.Setenv("POSTGRES_PORT", "not_a_number")
	defer os.Unsetenv("POSTGRES_PORT")

	cfg := Load()

	if cfg.PostgresPort != 5434 {
		t.Errorf("PostgresPort with invalid env = %d, want 5434 (fallback)", cfg.PostgresPort)
	}
}

func TestPostgresDSN(t *testing.T) {
	cfg := &Config{
		PostgresHost:     "dbhost",
		PostgresPort:     5432,
		PostgresUser:     "myuser",
		PostgresPassword: "mypass",
		PostgresDB:       "mydb",
	}

	dsn := cfg.PostgresDSN()
	expected := "host=dbhost port=5432 user=myuser password=mypass dbname=mydb sslmode=disable"

	if dsn != expected {
		t.Errorf("PostgresDSN() = %q, want %q", dsn, expected)
	}
}

func TestPostgresDSN_DockerCompose(t *testing.T) {
	// Simulate docker-compose environment
	os.Setenv("POSTGRES_HOST", "postgres")
	os.Setenv("POSTGRES_PORT", "5432")
	os.Setenv("POSTGRES_USER", "examguard_admin")
	os.Setenv("POSTGRES_PASSWORD", "examguard_secret_2026")
	os.Setenv("POSTGRES_DB", "examguard_db")
	defer func() {
		for _, k := range []string{"POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"} {
			os.Unsetenv(k)
		}
	}()

	cfg := Load()
	dsn := cfg.PostgresDSN()

	expected := "host=postgres port=5432 user=examguard_admin password=examguard_secret_2026 dbname=examguard_db sslmode=disable"
	if dsn != expected {
		t.Errorf("Docker DSN = %q, want %q", dsn, expected)
	}
}

package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all environment-driven configuration for the ExamGuard backend.
type Config struct {
	// Server
	Port string

	// PostgreSQL
	PostgresHost     string
	PostgresPort     int
	PostgresUser     string
	PostgresPassword string
	PostgresDB       string

	// Redis
	RedisAddr string

	// MinIO / S3
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	MinIOUseSSL    bool

	// JWT
	JWTSecret string
}

func loadDotEnv() {
	paths := []string{".env", "../.env", "../../.env"}
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				k := strings.TrimSpace(parts[0])
				v := strings.TrimSpace(parts[1])
				v = strings.Trim(v, `"'`)
				if _, exists := os.LookupEnv(k); !exists {
					_ = os.Setenv(k, v)
				}
			}
		}
		_ = f.Close()
		break
	}
}

// Load reads environment variables and returns a populated Config.
// Falls back to sensible defaults for local development.
func Load() *Config {
	loadDotEnv()

	return &Config{
		Port: envOrDefault("PORT", "8080"),

		PostgresHost:     envOrDefault("POSTGRES_HOST", "localhost"),
		PostgresPort:     envOrDefaultInt("POSTGRES_PORT", 5434),
		PostgresUser:     envOrDefault("POSTGRES_USER", "examguard_admin"),
		PostgresPassword: envOrDefault("POSTGRES_PASSWORD", "examguard_secret_2026"),
		PostgresDB:       envOrDefault("POSTGRES_DB", "examguard_db"),

		RedisAddr: envOrDefault("REDIS_ADDR", "localhost:6379"),

		MinIOEndpoint:  envOrDefault("MINIO_ENDPOINT", "localhost:9000"),
		MinIOAccessKey: envOrDefault("MINIO_ROOT_USER", envOrDefault("MINIO_ACCESS_KEY", "minioadmin")),
		MinIOSecretKey: envOrDefault("MINIO_ROOT_PASSWORD", envOrDefault("MINIO_SECRET_KEY", "minioadmin123")),
		MinIOBucket:    envOrDefault("MINIO_BUCKET_NAME", envOrDefault("MINIO_BUCKET", "examguard-evidence")),
		MinIOUseSSL:    envOrDefault("MINIO_USE_SSL", "false") == "true",

		JWTSecret: envOrDefault("JWT_SECRET", "super_secret_examguard_jwt_key_2026"),
	}
}

// PostgresDSN returns the full PostgreSQL connection string.
func (c *Config) PostgresDSN() string {
	if rawURL := os.Getenv("DATABASE_URL"); rawURL != "" {
		return rawURL
	}
	sslMode := envOrDefault("POSTGRES_SSLMODE", "disable")
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.PostgresHost, c.PostgresPort, c.PostgresUser, c.PostgresPassword, c.PostgresDB, sslMode,
	)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envOrDefaultInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

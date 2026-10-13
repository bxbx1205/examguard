package storage

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestNewPostgresPool_InvalidDSN(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Malformed DSN that fails during ParseConfig immediately without retry
	_, err := NewPostgresPool(ctx, "://invalid-dsn-syntax")
	if err == nil {
		t.Fatal("expected error for malformed DSN, got nil")
	}
	if !strings.Contains(err.Error(), "parse postgres config") {
		t.Errorf("expected 'parse postgres config' in error, got %v", err)
	}
}

func TestNewPostgresPool_InvalidPortSyntax(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	_, err := NewPostgresPool(ctx, "postgres://user:pass@localhost:notanumber/dbname")
	if err == nil {
		t.Fatal("expected error for non-numeric port, got nil")
	}
}

# =======================================================
# Multi-stage Dockerfile for Go Concurrency Backend
# Optimized for Google Cloud Run & High Security
# =======================================================

# Stage 1: Build statically compiled binary
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Cache dependency layers
COPY go.mod go.sum ./
RUN go mod download

# Copy application source code
COPY . .

# Build statically linked binary without debug symbols
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /examguard-server ./cmd/server/main.go

# Stage 2: Minimal, secure runtime container
FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata curl

# Create non-root unprivileged service account
RUN addgroup -S examguard && adduser -S examguard -G examguard

# Copy compiled binary from builder
COPY --from=builder /examguard-server /app/examguard-server

USER examguard

# Google Cloud Run routes traffic to PORT (default 8080)
EXPOSE 8080

CMD ["/app/examguard-server"]

package storage

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// NewRedisClient creates a Redis client with retry logic.
func NewRedisClient(ctx context.Context, addr string) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     "",
		DB:           0,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		PoolSize:     50,
		MinIdleConns: 10,
	})

	for i := 0; i < 10; i++ {
		if err := client.Ping(ctx).Err(); err == nil {
			log.Println("[redis] connection established")
			return client, nil
		}
		log.Printf("[redis] connection attempt %d/10 failed, retrying in 2s...", i+1)
		time.Sleep(2 * time.Second)
	}

	return nil, fmt.Errorf("redis: failed to connect after 10 attempts")
}

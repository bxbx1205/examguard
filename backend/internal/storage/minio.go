package storage

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// NewMinIOClient creates a MinIO S3 client and ensures the evidence bucket exists.
func NewMinIOClient(ctx context.Context, endpoint, accessKey, secretKey, bucket string, useSSL bool) (*minio.Client, error) {
	var client *minio.Client
	var err error

	const maxAttempts = 3
	for i := 0; i < maxAttempts; i++ {
		client, err = minio.New(endpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
			Secure: useSSL,
		})
		if err == nil {
			// Verify connectivity by checking if bucket exists
			var exists bool
			exists, err = client.BucketExists(ctx, bucket)
			if err == nil {
				if !exists {
					if mkErr := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); mkErr != nil {
						return nil, fmt.Errorf("minio: create bucket %q: %w", bucket, mkErr)
					}
					log.Printf("[minio] bucket %q created", bucket)
				} else {
					log.Printf("[minio] bucket %q verified", bucket)
				}
				log.Println("[minio] client connected")
				return client, nil
			}
		}
		log.Printf("[minio] connection attempt %d/%d failed: %v", i+1, maxAttempts, err)
		if i < maxAttempts-1 {
			time.Sleep(1 * time.Second)
		}
	}

	return nil, fmt.Errorf("minio: failed to connect after %d attempts: %w", maxAttempts, err)
}

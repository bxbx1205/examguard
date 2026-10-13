package concurrency

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

var testUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// helper to create a pair of connected WebSockets for testing
func createTestWSPair(t *testing.T) (serverConn *websocket.Conn, clientConn *websocket.Conn, cleanup func()) {
	var connChan = make(chan *websocket.Conn, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("failed to upgrade test websocket: %v", err)
			return
		}
		connChan <- c
	}))

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		server.Close()
		t.Fatalf("failed to dial test websocket: %v", err)
	}

	serverConn = <-connChan

	cleanup = func() {
		client.Close()
		serverConn.Close()
		server.Close()
	}

	return serverConn, client, cleanup
}

func TestNewInvigilatorHub(t *testing.T) {
	hub := NewInvigilatorHub()
	if hub == nil {
		t.Fatal("NewInvigilatorHub returned nil")
	}
	if hub.connections == nil {
		t.Fatal("connections map not initialized")
	}
	if hub.GetConnectionCount() != 0 {
		t.Fatalf("expected 0 connections, got %d", hub.GetConnectionCount())
	}
}

func TestInvigilatorHub_RegisterAndUnregister(t *testing.T) {
	hub := NewInvigilatorHub()
	srvConn, _, cleanup := createTestWSPair(t)
	defer cleanup()

	conn := &InvigilatorConn{
		ID:       "inv-conn-1",
		ExamID:   "exam-1",
		UserID:   "user-100",
		Conn:     srvConn,
		SendChan: make(chan []byte, 10),
	}

	hub.Register(conn)

	if count := hub.GetConnectionCount(); count != 1 {
		t.Fatalf("expected count 1, got %d", count)
	}

	// Idempotent/normal unregister
	hub.Unregister("inv-conn-1")
	if count := hub.GetConnectionCount(); count != 0 {
		t.Fatalf("expected count 0 after unregister, got %d", count)
	}

	// Calling unregister again on already removed connection should not panic
	hub.Unregister("inv-conn-1")
	hub.Unregister("non-existent-conn")
}

func TestInvigilatorHub_Broadcast(t *testing.T) {
	hub := NewInvigilatorHub()

	srv1, cli1, cleanup1 := createTestWSPair(t)
	defer cleanup1()
	srv2, cli2, cleanup2 := createTestWSPair(t)
	defer cleanup2()

	conn1 := &InvigilatorConn{
		ID:       "inv-1",
		ExamID:   "exam-CS101",
		UserID:   "proctor-1",
		Conn:     srv1,
		SendChan: make(chan []byte, 10),
	}
	conn2 := &InvigilatorConn{
		ID:       "inv-2",
		ExamID:   "exam-MATH202",
		UserID:   "proctor-2",
		Conn:     srv2,
		SendChan: make(chan []byte, 10),
	}

	hub.Register(conn1)
	hub.Register(conn2)

	msg := map[string]string{
		"event": "TEST_ALERT",
		"text":  "High suspicion detected",
	}

	// Broadcast only to CS101
	hub.Broadcast("exam-CS101", msg)

	// cli1 should receive it
	cli1.SetReadDeadline(time.Now().Add(1 * time.Second))
	_, received, err := cli1.ReadMessage()
	if err != nil {
		t.Fatalf("cli1 failed to receive broadcast: %v", err)
	}

	var parsed map[string]string
	if err := json.Unmarshal(received, &parsed); err != nil {
		t.Fatalf("failed to parse received JSON: %v", err)
	}
	if parsed["event"] != "TEST_ALERT" {
		t.Errorf("expected TEST_ALERT, got %s", parsed["event"])
	}

	// cli2 should NOT receive anything
	cli2.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	_, _, err = cli2.ReadMessage()
	if err == nil {
		t.Errorf("cli2 should not have received any message for exam-CS101")
	}
}

func TestInvigilatorHub_BroadcastBufferFull(t *testing.T) {
	hub := NewInvigilatorHub()

	srv, _, cleanup := createTestWSPair(t)
	defer cleanup()

	// Conn with tiny buffer
	conn := &InvigilatorConn{
		ID:       "inv-full",
		ExamID:   "exam-full",
		UserID:   "proctor-full",
		Conn:     srv,
		SendChan: make(chan []byte, 1),
	}

	// Fill buffer without calling Register (so writePump does not drain it)
	hub.mu.Lock()
	hub.connections[conn.ID] = conn
	hub.mu.Unlock()

	conn.SendChan <- []byte("first_message")

	// Now broadcast should drop cleanly without blocking or panicking
	done := make(chan bool)
	go func() {
		hub.Broadcast("exam-full", map[string]string{"foo": "bar"})
		done <- true
	}()

	select {
	case <-done:
		// success, did not block
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Broadcast blocked when channel buffer was full")
	}
}

func TestInvigilatorHub_BroadcastLoop(t *testing.T) {
	hub := NewInvigilatorHub()
	srv, cli, cleanup := createTestWSPair(t)
	defer cleanup()

	conn := &InvigilatorConn{
		ID:       "inv-loop",
		ExamID:   "exam-loop",
		UserID:   "proctor-loop",
		Conn:     srv,
		SendChan: make(chan []byte, 10),
	}
	hub.Register(conn)

	incidentChan := make(chan IncidentBroadcast, 10)
	var wg sync.WaitGroup
	wg.Add(1)

	go func() {
		defer wg.Done()
		hub.BroadcastLoop(incidentChan)
	}()

	incidentChan <- IncidentBroadcast{
		ExamID: "exam-loop",
		Alert: map[string]string{
			"type": "INCIDENT_ALERT",
		},
	}

	cli.SetReadDeadline(time.Now().Add(1 * time.Second))
	_, data, err := cli.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read from loop broadcast: %v", err)
	}

	if !strings.Contains(string(data), "INCIDENT_ALERT") {
		t.Errorf("expected INCIDENT_ALERT in message, got %s", string(data))
	}

	// Close incident chan to terminate BroadcastLoop
	close(incidentChan)
	wg.Wait()
}

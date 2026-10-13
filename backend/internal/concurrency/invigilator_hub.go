package concurrency

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// InvigilatorHub manages all invigilator WebSocket connections and fans out
// INCIDENT_ALERT, CANDIDATE_STATUS_UPDATE, and CANDIDATE_CONNECTION_CHANGE
// messages from the SessionManager to all connected invigilator dashboards.
type InvigilatorHub struct {
	mu          sync.RWMutex
	connections map[string]*InvigilatorConn // key: connection_id
}

// InvigilatorConn represents a single invigilator's WebSocket connection.
type InvigilatorConn struct {
	ID       string
	ExamID   string
	UserID   string
	Conn     *websocket.Conn
	SendChan chan []byte
	mu       sync.Mutex
	closed   bool
}

// NewInvigilatorHub creates a new invigilator broadcast hub.
func NewInvigilatorHub() *InvigilatorHub {
	return &InvigilatorHub{
		connections: make(map[string]*InvigilatorConn),
	}
}

// Register adds a new invigilator connection to the hub.
func (h *InvigilatorHub) Register(conn *InvigilatorConn) {
	h.mu.Lock()
	h.connections[conn.ID] = conn
	h.mu.Unlock()
	log.Printf("[invigilator-hub] registered: id=%s user=%s exam=%s", conn.ID, conn.UserID, conn.ExamID)

	// Start write pump
	go h.writePump(conn)
}

// Unregister removes an invigilator connection from the hub.
func (h *InvigilatorHub) Unregister(connID string) {
	h.mu.Lock()
	conn, exists := h.connections[connID]
	if exists {
		delete(h.connections, connID)
	}
	h.mu.Unlock()

	if exists {
		conn.mu.Lock()
		if !conn.closed {
			conn.closed = true
			close(conn.SendChan)
			conn.Conn.Close()
		}
		conn.mu.Unlock()
		log.Printf("[invigilator-hub] unregistered: id=%s", connID)
	}
}

// Broadcast sends a message to all invigilator connections watching a specific exam.
func (h *InvigilatorHub) Broadcast(examID string, message interface{}) {
	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("[invigilator-hub] marshal error: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, conn := range h.connections {
		if conn.ExamID == examID {
			conn.mu.Lock()
			if !conn.closed {
				select {
				case conn.SendChan <- data:
				default:
					log.Printf("[invigilator-hub] send buffer full, dropping for conn=%s", conn.ID)
				}
			}
			conn.mu.Unlock()
		}
	}
}

// BroadcastLoop continuously reads from the SessionManager's IncidentChan
// and broadcasts to appropriate invigilator connections.
func (h *InvigilatorHub) BroadcastLoop(incidentChan <-chan IncidentBroadcast) {
	for incident := range incidentChan {
		h.Broadcast(incident.ExamID, incident.Alert)
	}
}

// writePump writes queued messages to the invigilator's WebSocket.
func (h *InvigilatorHub) writePump(conn *InvigilatorConn) {
	for msg := range conn.SendChan {
		conn.mu.Lock()
		if conn.closed {
			conn.mu.Unlock()
			return
		}
		err := conn.Conn.WriteMessage(websocket.TextMessage, msg)
		conn.mu.Unlock()

		if err != nil {
			log.Printf("[invigilator-hub] write error conn=%s: %v", conn.ID, err)
			h.Unregister(conn.ID)
			return
		}
	}
}

// GetConnectionCount returns the number of active invigilator connections.
func (h *InvigilatorHub) GetConnectionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.connections)
}

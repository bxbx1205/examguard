import type { 
  TelemetryEvent, 
  ConnectionStatus, 
  InitialStatePayload, 
  CandidateStatusUpdatePayload, 
  CandidateConnectionChangePayload 
} from '../types';

type EventCallback = (event: TelemetryEvent) => void;
type StatusCallback = (status: ConnectionStatus) => void;
type InitialStateCallback = (data: InitialStatePayload) => void;
type StatusUpdateCallback = (data: CandidateStatusUpdatePayload) => void;
type ConnectionChangeCallback = (data: CandidateConnectionChangePayload) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private eventCallbacks: EventCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private initialStateCallbacks: InitialStateCallback[] = [];
  private statusUpdateCallbacks: StatusUpdateCallback[] = [];
  private connectionChangeCallbacks: ConnectionChangeCallback[] = [];
  private reconnectTimeout: number | null = null;
  private currentStatus: ConnectionStatus = 'DISCONNECTED';

  constructor(url: string) {
    this.url = url;
  }

  private setStatus(status: ConnectionStatus) {
    this.currentStatus = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  getStatus(): ConnectionStatus {
    return this.currentStatus;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setStatus(this.currentStatus === 'DISCONNECTED' ? 'CONNECTING' : 'RECONNECTING');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('🟢 [ExamGuard] Connected to Go Edge-Server:', this.url);
        this.setStatus('CONNECTED');
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          
          // 1. Initial State packet from DB
          if (raw?.type === 'INITIAL_STATE' && raw?.payload) {
            this.initialStateCallbacks.forEach(cb => cb(raw.payload as InitialStatePayload));
            return;
          }

          // 2. Candidate Status update (e.g. score changed, violation registered)
          if (raw?.type === 'CANDIDATE_STATUS_UPDATE' && raw?.payload) {
            this.statusUpdateCallbacks.forEach(cb => cb(raw.payload as CandidateStatusUpdatePayload));
            return;
          }

          // 3. Candidate Connection Change (e.g. camera off, network disconnect)
          if (raw?.type === 'CANDIDATE_CONNECTION_CHANGE' && raw?.payload) {
            this.connectionChangeCallbacks.forEach(cb => cb(raw.payload as CandidateConnectionChangePayload));
            return;
          }

          // 4. Telemetry Anomaly Event (both wrapped and raw formats)
          let anomaly: TelemetryEvent | null = null;
          if (raw?.type === 'INCIDENT_ALERT' && raw?.payload) {
            anomaly = raw.payload as TelemetryEvent;
          } else if (raw?.payload && (raw.payload.event_id || raw.payload.student_id)) {
            anomaly = raw.payload as TelemetryEvent;
          } else if (raw?.event_id || raw?.student_id) {
            anomaly = raw as TelemetryEvent;
          }

          if (anomaly) {
            this.eventCallbacks.forEach(cb => cb(anomaly!));
          }
        } catch (error) {
          console.error('🔴 [ExamGuard] Malformed WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('🟡 [ExamGuard] Connection lost. Attempting reconnect in 3s...');
        this.setStatus('RECONNECTING');
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = window.setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (error) => {
        console.error('🔴 [ExamGuard] WebSocket Error:', error);
        this.ws?.close();
      };
    } catch (err) {
      console.error('🔴 [ExamGuard] Connection attempt failed:', err);
      this.setStatus('DISCONNECTED');
      this.reconnectTimeout = window.setTimeout(() => this.connect(), 3000);
    }
  }

  // Subscribe to Telemetry Anomaly events
  subscribe(callback: EventCallback) {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
    };
  }

  // Subscribe to connection status changes
  onStatusChange(callback: StatusCallback) {
    this.statusCallbacks.push(callback);
    callback(this.currentStatus);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter(cb => cb !== callback);
    };
  }

  // Subscribe to initial exam state load
  onInitialState(callback: InitialStateCallback) {
    this.initialStateCallbacks.push(callback);
    return () => {
      this.initialStateCallbacks = this.initialStateCallbacks.filter(cb => cb !== callback);
    };
  }

  // Subscribe to candidate status updates
  onStatusUpdate(callback: StatusUpdateCallback) {
    this.statusUpdateCallbacks.push(callback);
    return () => {
      this.statusUpdateCallbacks = this.statusUpdateCallbacks.filter(cb => cb !== callback);
    };
  }

  // Subscribe to candidate connection changes
  onConnectionChange(callback: ConnectionChangeCallback) {
    this.connectionChangeCallbacks.push(callback);
    return () => {
      this.connectionChangeCallbacks = this.connectionChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  // Send invigilator action back to Go backend
  sendAction(actionType: 'WARN' | 'LOCK' | 'TERMINATE', studentId: string, message?: string, reason?: string, examId: string = 'exam_2026_cs501'): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ [ExamGuard] Cannot send action: WebSocket not open');
      return false;
    }

    const envelope = {
      action: 'INVIGILATOR_ACTION',
      exam_id: examId,
      payload: {
        action_type: actionType,
        student_id: studentId,
        message: message || `Proctor Action: ${actionType} triggered.`,
        reason: reason || 'Academic integrity deviation flagged.'
      }
    };

    try {
      this.ws.send(JSON.stringify(envelope));
      console.log('📤 [ExamGuard] Invigilator action sent:', envelope);
      return true;
    } catch (err) {
      console.error('🔴 [ExamGuard] Failed to send action over WebSocket:', err);
      return false;
    }
  }

  // Helper for simulating anomalies locally (instant dashboard demonstration)
  simulateAnomaly(event: Partial<TelemetryEvent>): void {
    const defaultEvent: TelemetryEvent = {
      event_id: `evt_sim_${Date.now().toString(36)}`,
      student_id: event.student_id || '46',
      student_name: event.student_name || 'Taher Sanawadwala',
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      category: event.category || 'VISION',
      subtype: event.subtype || 'GAZE_DEVIATION',
      severity: event.severity || 'HIGH',
      confidence: event.confidence ?? 0.94,
      message: event.message || 'Candidate gaze deviated beyond tolerance cone for > 3.5s.',
      penalty: event.penalty ?? 10
    };
    this.eventCallbacks.forEach(cb => cb(defaultEvent));
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.ws?.close();
    this.setStatus('DISCONNECTED');
  }
}

// Default Go backend WebSocket endpoint
const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname || 'localhost'}:8080/ws/invigilator?token=inv_token&exam_id=exam_2026_cs501`;
export const telemetrySocket = new WebSocketService((import.meta as any).env?.VITE_WS_URL || defaultWsUrl);

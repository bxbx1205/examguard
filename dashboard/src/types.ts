export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AnomalyCategory = 'VISION' | 'AUDIO' | 'ENVIRONMENT';
export type CandidateStatus = 'ACTIVE' | 'FLAGGED' | 'DISCONNECTED';

export type AnomalySubtype =
  | 'MULTIPLE_FACES_DETECTED'
  | 'FACE_NOT_DETECTED'
  | 'GAZE_DEVIATION'
  | 'HEAD_POSE_ANOMALY'
  | 'AUDIO_MULTIPLE_SPEAKERS'
  | 'AUDIO_WHISPER'
  | 'AUDIO_VOLUME_SPIKE'
  | 'TAB_SWITCH_BLUR'
  | 'FULLSCREEN_EXIT'
  | 'DEVTOOLS_ATTEMPT'
  | 'CLIPBOARD_VIOLATION';

export interface TelemetryEvent {
  event_id: string;
  student_id: string;
  student_name?: string;
  timestamp: string;
  category?: AnomalyCategory;
  subtype: AnomalySubtype | string;
  severity: SeverityLevel;
  confidence: number;
  message: string;
  snapshot_url?: string | null;
  metrics?: Record<string, any>;
  penalty?: number;
}

export interface Candidate {
  student_id: string;
  name: string;
  roll_id?: string;
  avatar?: string;
  trust_score: number;
  status: CandidateStatus;
  last_violation?: AnomalySubtype | string;
  hasDot?: boolean;
  camera_active?: boolean;
  microphone_active?: boolean;
  screen_active?: boolean;
  ip_address?: string;
  device?: string;
  biometric_match?: number;
  seat_number?: string;
  screen_preview?: string;
}

export interface InvigilatorActionPayload {
  action_type: 'WARN' | 'LOCK' | 'TERMINATE';
  student_id: string;
  message?: string;
  reason?: string;
}

export interface InitialStatePayload {
  exam_id: string;
  exam_name: string;
  summary: {
    total_registered: number;
    active_count: number;
    flagged_count: number;
    disconnected_count: number;
  };
  candidates: Candidate[];
}

export type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING';

export interface CandidateStatusUpdatePayload {
  exam_id: string;
  student_id: string;
  trust_score: number;
  status: CandidateStatus;
  last_violation?: string;
}

export interface CandidateConnectionChangePayload {
  exam_id: string;
  student_id: string;
  connected: boolean;
  timestamp: string;
}
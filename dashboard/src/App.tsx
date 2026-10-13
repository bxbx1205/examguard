import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Search, 
  Clock, 
  Radio, 
  Camera, 
  Mic, 
  Monitor, 
  X, 
  Zap
} from 'lucide-react';
import type { Candidate, TelemetryEvent, ConnectionStatus } from './types';
import { telemetrySocket } from './services/websocket';
import { Sidebar } from './components/Sidebar';
import { LiveVideoFeed } from './components/LiveVideoFeed';
import { AnomalyFeed } from './components/AnomalyFeed';
import { EvidenceModal } from './components/EvidenceModal';

function getInitials(name?: string, id?: string): string {
  if (!name) return id ? `S${id}` : 'ST';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function App() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('CONNECTING');
  const [activeAuditModal, setActiveAuditModal] = useState<{ event: TelemetryEvent; candidate: Candidate } | null>(null);
  const [examTitle, setExamTitle] = useState('CS501 Distributed Systems End-Semester');

  // Enterprise UI States: default to 'LIVE' fleet monitor so only active/flagged examinees show
  const [searchQuery, setSearchQuery] = useState('');
  const [fleetFilter, setFleetFilter] = useState<'LIVE' | 'FLAGGED' | 'ALL'>('LIVE');
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastNoticeSent, setBroadcastNoticeSent] = useState<string | null>(null);

  // Live Exam Countdown Timer
  const [secondsRemaining, setSecondsRemaining] = useState(7200); // 2 hours
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Incoming WebSocket Event Handler
  const handleIncomingEvent = useCallback((newEvent: TelemetryEvent) => {
    setEvents((prev) => [newEvent, ...prev.slice(0, 39)]);

    const studentId = String(newEvent.student_id);
    setCandidates((prev) => {
      const exists = prev.some((c) => c.student_id === studentId);
      if (exists) {
        return prev.map((c) => {
          if (c.student_id === studentId) {
            const penalty = newEvent.penalty || (newEvent.severity === 'CRITICAL' ? 15 : 10);
            const nextScore = Math.max(0, Number((c.trust_score - penalty).toFixed(1)));
            const updated: Candidate = {
              ...c,
              trust_score: nextScore,
              status: nextScore < 60 ? 'FLAGGED' : c.status,
              last_violation: newEvent.subtype,
              hasDot: true,
            };
            setSelectedCandidate((curr) => (curr?.student_id === studentId ? updated : curr));
            return updated;
          }
          return c;
        });
      } else {
        const penalty = newEvent.penalty || (newEvent.severity === 'CRITICAL' ? 15 : 10);
        const nextScore = Math.max(0, Number((100 - penalty).toFixed(1)));
        const newCandidate: Candidate = {
          student_id: studentId,
          name: newEvent.student_name || `Student ${studentId}`,
          roll_id: `ID: ${studentId}`,
          trust_score: nextScore,
          status: nextScore < 60 ? 'FLAGGED' : 'ACTIVE',
          last_violation: newEvent.subtype,
          camera_active: true,
          microphone_active: true,
          screen_active: true,
          hasDot: true,
        };
        setSelectedCandidate((curr) => curr || newCandidate);
        return [newCandidate, ...prev];
      }
    });
  }, []);

  // Handle real candidate roster from Go backend INITIAL_STATE
  const handleInitialState = useCallback((payload: any) => {
    if (payload?.exam_name) {
      setExamTitle(payload.exam_name);
    }

    if (Array.isArray(payload?.candidates)) {
      const realCandidates: Candidate[] = payload.candidates.map((c: any) => {
        const studentId = String(c.student_id);
        const status = c.status || 'DISCONNECTED';

        return {
          student_id: studentId,
          name: c.name || `Student ${studentId}`,
          roll_id: `ID: ${studentId}`,
          trust_score: typeof c.trust_score === 'number' ? c.trust_score : 100,
          status: status,
          last_violation: c.last_violation || undefined,
          camera_active: c.camera_active ?? (status === 'ACTIVE'),
          microphone_active: c.microphone_active ?? (status === 'ACTIVE'),
          screen_active: c.screen_active ?? (status === 'ACTIVE'),
          hasDot: status === 'FLAGGED' || (typeof c.trust_score === 'number' && c.trust_score < 60),
        };
      });

      setCandidates(realCandidates);
      setSelectedCandidate((curr) => {
        if (!curr) {
          const firstActive = realCandidates.find((c) => c.status === 'ACTIVE');
          return firstActive || null;
        }
        const found = realCandidates.find((c) => c.student_id === curr.student_id);
        return found || null;
      });
    }
  }, []);

  // Handle individual candidate status update from backend (promotes to ACTIVE on start exam)
  const handleStatusUpdate = useCallback((update: any) => {
    if (!update?.student_id) return;
    const studentId = String(update.student_id);

    setCandidates((prev) => {
      const exists = prev.some((c) => c.student_id === studentId);
      if (exists) {
        return prev.map((c) => {
          if (c.student_id === studentId) {
            const updated: Candidate = {
              ...c,
              name: update.name || c.name,
              trust_score: update.trust_score ?? c.trust_score,
              status: update.status ?? c.status,
              last_violation: update.last_violation !== undefined ? update.last_violation : c.last_violation,
              camera_active: update.camera_active !== undefined ? update.camera_active : c.camera_active,
              microphone_active: update.microphone_active !== undefined ? update.microphone_active : c.microphone_active,
              hasDot: update.status === 'FLAGGED' || (update.trust_score !== undefined && update.trust_score < 60),
            };
            setSelectedCandidate((curr) => (!curr || curr.student_id === studentId ? updated : curr));
            return updated;
          }
          return c;
        });
      } else {
        const newCandidate: Candidate = {
          student_id: studentId,
          name: update.name || `Student ${studentId}`,
          roll_id: `ID: ${studentId}`,
          trust_score: update.trust_score ?? 100,
          status: update.status || 'ACTIVE',
          last_violation: update.last_violation || undefined,
          camera_active: update.camera_active ?? true,
          microphone_active: update.microphone_active ?? true,
          screen_active: true,
          hasDot: update.status === 'FLAGGED',
        };
        setSelectedCandidate((curr) => (!curr || curr.status === 'DISCONNECTED' ? newCandidate : curr));
        return [newCandidate, ...prev];
      }
    });
  }, []);

  // Handle individual candidate connection change (disconnect / reconnect)
  const handleConnectionChange = useCallback((change: any) => {
    if (!change?.student_id) return;
    const studentId = String(change.student_id);
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.student_id === studentId) {
          const isConnected = change.connected ?? (change.status === 'ACTIVE');
          const updated: Candidate = {
            ...c,
            status: isConnected ? (c.trust_score < 60 ? 'FLAGGED' : 'ACTIVE') : 'DISCONNECTED',
            camera_active: isConnected ? (c.camera_active ?? true) : false,
            microphone_active: isConnected ? (c.microphone_active ?? true) : false,
          };
          setSelectedCandidate((curr) => (curr?.student_id === studentId ? updated : curr));
          return updated;
        }
        return c;
      })
    );
  }, []);

  // Connect to Go Edge Server via WebSocket
  useEffect(() => {
    telemetrySocket.connect();

    const unsubStatus = telemetrySocket.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    const unsubInitial = telemetrySocket.onInitialState(handleInitialState);
    const unsubStatusUpdate = telemetrySocket.onStatusUpdate(handleStatusUpdate);
    const unsubConnChange = telemetrySocket.onConnectionChange(handleConnectionChange);
    const unsubEvents = telemetrySocket.subscribe(handleIncomingEvent);

    return () => {
      unsubStatus();
      unsubInitial();
      unsubStatusUpdate();
      unsubConnChange();
      unsubEvents();
      telemetrySocket.disconnect();
    };
  }, [handleIncomingEvent, handleInitialState, handleStatusUpdate, handleConnectionChange]);

  // Invigilator Action Handler
  const handleProctorAction = (actionType: 'WARN' | 'LOCK' | 'TERMINATE', studentId: string) => {
    telemetrySocket.sendAction(actionType, studentId);
  };

  // Filtered & Searched Candidate List
  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const matchesSearch = 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.roll_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.student_id.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (fleetFilter === 'LIVE') return c.status === 'ACTIVE' || c.status === 'FLAGGED';
      if (fleetFilter === 'FLAGGED') return c.status === 'FLAGGED' || c.trust_score < 60;
      return true;
    });
  }, [candidates, searchQuery, fleetFilter]);

  const onlineCount = useMemo(() => {
    return candidates.filter((c) => c.status === 'ACTIVE').length;
  }, [candidates]);

  const flaggedCount = useMemo(() => {
    return candidates.filter((c) => c.status === 'FLAGGED' || c.trust_score < 60).length;
  }, [candidates]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] font-sans antialiased text-slate-800">
      {/* 1. Left Sidebar Component (Proctortrack / ExamSoft Style) */}
      <Sidebar
        connectionStatus={connectionStatus}
        onlineCount={onlineCount}
        flaggedCount={flaggedCount}
        onAuditClick={() => {
          const flaggedCandidate = candidates.find((c) => c.status === 'FLAGGED') || candidates[0];
          if (!flaggedCandidate) return;
          setActiveAuditModal({
            event: events[0] || {
              event_id: 'evt_audit_latest',
              student_id: flaggedCandidate.student_id,
              timestamp: '15:04:12',
              subtype: flaggedCandidate.last_violation || 'MULTIPLE_FACES_DETECTED',
              severity: 'CRITICAL',
              confidence: 0.99,
              message: 'Infraction audit snapshot captured by proctoring engine.',
            },
            candidate: flaggedCandidate,
          });
        }}
        onBroadcastClick={() => setIsBroadcastModalOpen(true)}
      />

      {/* 2. Main Workstation Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Institutional Command Bar */}
        <header className="h-16 bg-white border-b border-slate-200/90 px-6 flex items-center justify-between shrink-0 shadow-2xs">
          {/* Exam Title & Active Status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="font-extrabold text-sm text-slate-900 tracking-tight">
                {examTitle}
              </h1>
            </div>

            <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 hidden md:inline">
              Live Proctoring
            </span>

            {/* Countdown Timer Clock */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 font-mono text-xs font-bold shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-slate-600" />
              <span>{formatCountdown(secondsRemaining)} REMAINING</span>
            </div>
          </div>

          {/* Right Controls: Simulator Drawer Trigger + Proctor Avatar */}
          <div className="flex items-center gap-3">
            {/* Discreet Edge Telemetry Lab Trigger */}
            <button
              onClick={() => setIsSimulatorOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-2xs cursor-pointer hover:border-slate-300"
              title="Open Edge Telemetry Lab to simulate and test real-time violations"
            >
              <Zap className="w-3.5 h-3.5 text-slate-700" />
              <span className="hidden sm:inline">Telemetry Lab</span>
              <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-mono">
                SIM
              </span>
            </button>

            {/* Broadcast Notice Button */}
            <button
              onClick={() => setIsBroadcastModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-2xs cursor-pointer hover:border-slate-300"
            >
              <Radio className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Broadcast</span>
            </button>

            {/* Proctor Profile Badge */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="text-right hidden xl:block">
                <p className="text-xs font-bold text-slate-800 leading-tight">Invigilator Console</p>
                <p className="text-[10px] text-slate-500 font-medium">Active Proctor</p>
              </div>

              <div className="w-9 h-9 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center border border-slate-800 shadow-2xs">
                PROCTOR
              </div>
            </div>
          </div>
        </header>

        {/* Workspace Body: 2 Columns (Fleet Directory on Left, Dual Video & Forensic Feed on Right) */}
        <main className="flex-1 p-5 overflow-y-auto grid grid-cols-12 gap-5 min-h-0">
          {/* Center Column: Fleet Monitoring Grid */}
          <section className="col-span-12 lg:col-span-7 xl:col-span-7 flex flex-col space-y-3">
            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-white p-2.5 rounded-2xl border border-slate-200/90 shadow-2xs">
              {/* Search Candidate Input */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search candidate name or student ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition-all"
                />
              </div>

              {/* Status Filter Tabs */}
              <div className="flex items-center gap-1">
                {[
                  { id: 'LIVE', label: `Live Fleet (${onlineCount + flaggedCount})` },
                  { id: 'FLAGGED', label: `Flagged (${flaggedCount})` },
                  { id: 'ALL', label: `All Registered (${candidates.length})` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setFleetFilter(tab.id as any)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      fleetFilter === tab.id
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Candidate Directory Grid (2 Columns) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {filteredCandidates.length === 0 ? (
                <div className="col-span-full py-14 px-6 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-500">
                    <Radio className="w-6 h-6 animate-pulse text-slate-700" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800">
                      {fleetFilter === 'LIVE' ? 'Awaiting Candidate Connections' : 'No Candidates Matching Filter'}
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      {fleetFilter === 'LIVE'
                        ? 'No examinees have started the exam yet. When candidates launch the ExamGuard extension, they will appear here in real time.'
                        : `No registered candidates match your search or filter.`}
                    </p>
                  </div>
                </div>
              ) : (
                filteredCandidates.map((c) => {
                  const isDanger = c.status === 'FLAGGED' || c.trust_score < 60;
                  const isSelected = selectedCandidate?.student_id === c.student_id;
                  const progressBarColor = 'bg-slate-800';

                  return (
                    <div
                      key={c.student_id}
                      onClick={() => setSelectedCandidate(c)}
                      className={`bg-white rounded-2xl border p-3.5 shadow-2xs transition-all duration-150 cursor-pointer hover:shadow-sm space-y-2.5 relative ${
                        isSelected
                          ? 'border-slate-900 ring-2 ring-slate-900/10'
                          : isDanger
                          ? 'border-slate-300 bg-slate-50/50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Top Row: Candidate Name, Roll ID, Peripheral Badges */}
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {c.name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            Student ID: {c.student_id}
                          </p>
                        </div>

                        {/* Peripheral Hardware Status Badges */}
                        <div className="flex items-center gap-1.5">
                          <span title={c.camera_active ? 'Camera Active' : 'Camera Offline'}>
                            <Camera className={`w-3.5 h-3.5 ${c.camera_active ? 'text-emerald-600' : 'text-slate-300'}`} />
                          </span>
                          <span title={c.microphone_active ? 'Microphone Active' : 'Microphone Offline'}>
                            <Mic className={`w-3.5 h-3.5 ${c.microphone_active ? 'text-emerald-600' : 'text-slate-300'}`} />
                          </span>
                          <span title={c.screen_active ? 'Screen Active' : 'Screen Offline'}>
                            <Monitor className={`w-3.5 h-3.5 ${c.screen_active ? 'text-emerald-600' : 'text-slate-300'}`} />
                          </span>
                        </div>
                      </div>

                    {/* Centered Student Initials & Status Tag */}
                    <div className="flex items-center gap-3 py-1">
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-900 text-white font-extrabold text-sm flex items-center justify-center shrink-0 relative shadow-2xs border border-slate-800">
                        <span>{getInitials(c.name, c.student_id)}</span>
                        {c.hasDot && (
                          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" />
                        )}
                      </div>

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-[10px] font-mono">
                          <span className="text-slate-500">Status:</span>
                          <span className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                            c.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : c.status === 'FLAGGED'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}>
                            {c.status}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                          <span>Device:</span>
                          <span className="text-slate-700 font-medium truncate">
                            {c.status === 'DISCONNECTED' ? 'Offline' : 'Sentinel Proctoring'}
                          </span>
                        </div>

                        {c.last_violation && (
                          <p className="text-[10px] text-amber-700 font-mono font-bold truncate">
                            ⚠️ {c.last_violation}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Trust Score & Progress Bar */}
                    <div className="space-y-1 pt-1 border-t border-slate-100">
                      <div className="flex justify-between text-xs">
                        <span className="text-[11px] font-bold text-slate-600">Integrity Trust</span>
                        <span className="font-bold text-slate-900 font-mono">
                          {c.trust_score}%
                        </span>
                      </div>

                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${progressBarColor} rounded-full transition-all duration-300`}
                          style={{ width: `${Math.min(100, Math.max(0, c.trust_score))}%` }}
                        />
                      </div>
                    </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Right Column: Focus Stream Monitor & Live Forensic Feed */}
          <aside className="col-span-12 lg:col-span-5 xl:col-span-5 flex flex-col space-y-4">
            {/* 1. Live Video Feed HUD Component */}
            <LiveVideoFeed
              candidate={selectedCandidate}
              onWarn={(studentId) => handleProctorAction('WARN', studentId)}
              onLock={(studentId) => handleProctorAction('LOCK', studentId)}
              onTerminate={(studentId) => handleProctorAction('TERMINATE', studentId)}
              onIntercom={(studentId) => {
                alert(`Opening two-way live intercom channel with candidate ${studentId}`);
              }}
            />

            {/* 2. Live Incident Forensic Feed Component */}
            <AnomalyFeed
              events={events}
              candidates={candidates}
              onSelectEvent={(event, candidate) => {
                setSelectedCandidate(candidate);
                setActiveAuditModal({ event, candidate });
              }}
            />
          </aside>
        </main>
      </div>

      {/* 3. Evidentiary Forensic Capture & Audit Modal */}
      <EvidenceModal
        event={activeAuditModal?.event ?? null}
        candidate={activeAuditModal?.candidate ?? null}
        onClose={() => setActiveAuditModal(null)}
        onAction={(action) => {
          if (activeAuditModal?.candidate) {
            handleProctorAction(action, activeAuditModal.candidate.student_id);
          }
          setActiveAuditModal(null);
        }}
      />

      {/* 4. Slide-Out Edge Telemetry Simulator Drawer (Enterprise Testing Deck) */}
      {isSimulatorOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-2xs transition-all">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between border-l border-slate-200 animate-in slide-in-from-right duration-200">
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-slate-100 text-slate-800">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900">Edge Telemetry Simulator</h3>
                    <p className="text-xs text-slate-500">Inject real-time anomalies for testing</p>
                  </div>
                </div>

                <button
                  onClick={() => setIsSimulatorOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Select Violation Scenario
                </p>

                {[
                  {
                    title: 'Secondary Face in Viewport',
                    category: 'VISION',
                    subtype: 'MULTIPLE_FACES_DETECTED',
                    severity: 'CRITICAL',
                    confidence: 0.99,
                    message: 'Secondary face detected in camera viewport at (x: 0.72, y: 0.45).',
                    penalty: 14.5,
                  },
                  {
                    title: 'Unauthorized Tab Switch (Blur)',
                    category: 'ENVIRONMENT',
                    subtype: 'TAB_SWITCH_BLUR',
                    severity: 'HIGH',
                    confidence: 1.0,
                    message: 'Persistent Screen Blur: Candidate switched browser tab.',
                    penalty: 12.0,
                  },
                  {
                    title: 'Gaze Deviation Outside Cones',
                    category: 'VISION',
                    subtype: 'GAZE_DEVIATION',
                    severity: 'MEDIUM',
                    confidence: 0.95,
                    message: 'Gaze deviation outside frame detected for 3.8s.',
                    penalty: 7.5,
                  },
                  {
                    title: 'Consistent Acoustic Whisper',
                    category: 'AUDIO',
                    subtype: 'AUDIO_WHISPER',
                    severity: 'LOW',
                    confidence: 0.89,
                    message: 'Consistent whisper detected exceeding nominal audio threshold.',
                    penalty: 5.0,
                  },
                ].map((scenario, idx) => {
                  const targetCandidate = selectedCandidate || candidates[0];
                  const targetId = targetCandidate?.student_id || '50';
                  const targetName = targetCandidate?.name || 'Active Candidate';
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        telemetrySocket.simulateAnomaly({
                          ...scenario,
                          studentId: targetId,
                          studentName: targetName,
                        } as any);
                        setIsSimulatorOpen(false);
                      }}
                      className="w-full p-3 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-left transition-all cursor-pointer space-y-1 group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-800 group-hover:text-slate-900">
                          {scenario.title}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          scenario.severity === 'CRITICAL' ? 'bg-slate-900 text-white border border-slate-800' :
                          scenario.severity === 'HIGH' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          scenario.severity === 'MEDIUM' ? 'bg-slate-100 text-slate-700 border-slate-200' :
                          'bg-slate-50 text-slate-600 border border-slate-200'
                        }`}>
                          {scenario.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-1">
                        Target: {targetName} (-{scenario.penalty} trust penalty)
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => setIsSimulatorOpen(false)}
                className="w-full py-2 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors shadow-xs"
              >
                Close Simulator
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Emergency Fleet Broadcast Notice Modal */}
      {isBroadcastModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-slate-700" />
                <h3 className="font-bold text-sm text-slate-900">Broadcast Announcement</h3>
              </div>
              <button
                onClick={() => setIsBroadcastModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-600">
                Pushes a priority on-screen modal notification to all {onlineCount} active exam candidate screens.
              </p>
              <textarea
                rows={3}
                placeholder="e.g., Attention: 15 minutes remaining. Please ensure your face is well-lit and keep your camera centered."
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-slate-400"
              />
            </div>

            {broadcastNoticeSent && (
              <p className="text-xs font-bold text-slate-800">
                ✓ {broadcastNoticeSent}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setIsBroadcastModalOpen(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (broadcastMessage.trim()) {
                    setBroadcastNoticeSent(`Announcement dispatched to all ${onlineCount} candidate screens.`);
                    setTimeout(() => {
                      setIsBroadcastModalOpen(false);
                      setBroadcastNoticeSent(null);
                      setBroadcastMessage('');
                    }, 1200);
                  }
                }}
                className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-bold text-white shadow-2xs cursor-pointer"
              >
                Broadcast to Fleet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
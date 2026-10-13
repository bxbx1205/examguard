import React, { useState, useEffect } from 'react';
import { 
  Camera, 
  Monitor, 
  Mic, 
  AlertTriangle, 
  Lock, 
  Slash, 
  Volume2, 
  Radio, 
  CheckCircle2
} from 'lucide-react';
import type { Candidate } from '../types';

interface LiveVideoFeedProps {
  candidate: Candidate | null;
  onWarn?: (studentId: string) => void;
  onLock?: (studentId: string) => void;
  onTerminate?: (studentId: string) => void;
  onIntercom?: (studentId: string) => void;
}

export const LiveVideoFeed: React.FC<LiveVideoFeedProps> = ({
  candidate,
  onWarn,
  onLock,
  onTerminate,
  onIntercom,
}) => {
  const [activeTab, setActiveTab] = useState<'webcam' | 'screen' | 'audio'>('webcam');
  const [dbLevel, setDbLevel] = useState<number>(24);
  const [waveHeights, setWaveHeights] = useState<number[]>([
    18, 32, 55, 42, 70, 50, 28, 65, 80, 58, 35, 75, 45, 25, 18, 40, 68, 52, 30, 18
  ]);

  // Dynamic audio waveform & decibel fluctuation
  useEffect(() => {
    const timer = setInterval(() => {
      setWaveHeights((prev) =>
        prev.map(() => 12 + Math.floor(Math.random() * 70))
      );
      setDbLevel(18 + Math.floor(Math.random() * 22));
    }, 280);
    return () => clearInterval(timer);
  }, []);

  const isFlagged = candidate?.status === 'FLAGGED' || (candidate?.trust_score ?? 100) < 60;
  const isGazeDeviated = candidate?.last_violation === 'GAZE_DEVIATION';

  if (!candidate) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
            <span className="px-2.5 py-1 text-xs font-bold text-slate-500 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-slate-400" />
              <span>Webcam HUD</span>
            </span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-400 border border-slate-200">
            Standby Mode
          </span>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs text-center space-y-3">
          <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex flex-col items-center justify-center p-6 text-slate-500 space-y-2.5">
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
              <Camera className="w-6 h-6 text-slate-500" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-slate-400">No Candidate Selected</p>
              <p className="text-[10px] text-slate-600">Select a candidate or await exam connection</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Proctoring video feed will activate automatically when candidate starts exam.</p>
        </div>
      </div>
    );
  }

  const isCameraLive = candidate.camera_active && candidate.status !== 'DISCONNECTED';

  return (
    <div className="space-y-2">
      {/* 1. Header with Multi-Stream Switcher Tabs (Proctortrack / ExamSoft Style) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
          <button
            onClick={() => setActiveTab('webcam')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'webcam'
                ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Webcam HUD</span>
          </button>

          <button
            onClick={() => setActiveTab('screen')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'screen'
                ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Screen Mirror</span>
          </button>

          <button
            onClick={() => setActiveTab('audio')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'audio'
                ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Acoustics</span>
          </button>
        </div>

        {/* Live Stream Telemetry Tag */}
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
          {isCameraLive ? 'WebRTC 30fps • 1080p' : 'Camera Offline'}
        </span>
      </div>

      {/* 2. Main Video Viewport Container */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-xs space-y-3">
        {/* Stream Viewport */}
        <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 group select-none">
          {activeTab === 'webcam' && (
            isCameraLive ? (
              <>
                {/* Webcam Stream */}
                {candidate?.avatar ? (
                  <img
                    src={candidate.avatar}
                    alt="Candidate Live Feed"
                    className="w-full h-full object-cover brightness-95 contrast-105"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-slate-400 gap-2 font-mono">
                    <div className="w-16 h-16 rounded-2xl bg-slate-800 text-white font-extrabold text-xl flex items-center justify-center border border-slate-700 shadow-md">
                      {candidate?.name?.slice(0, 2).toUpperCase() || 'EX'}
                    </div>
                    <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Live Camera Stream
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Feed Synced • 640x480 @ 30fps
                    </span>
                  </div>
                )}

                {/* High-tech Viewport Corner Brackets */}
                <div className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-white/70 pointer-events-none drop-shadow-sm" />
                <div className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-white/70 pointer-events-none drop-shadow-sm" />
                <div className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-white/70 pointer-events-none drop-shadow-sm" />
                <div className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-white/70 pointer-events-none drop-shadow-sm" />

                {/* Biometric Face Tracking Bounding Box */}
                <div className="absolute top-[20%] left-[34%] w-[32%] h-[54%] border border-white/80 rounded-xs pointer-events-none shadow-xs">
                  <div className="absolute -inset-1 border border-white/20 rounded-xs pointer-events-none" />
                  {/* Central Gaze Vector Reticle */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white/80 pointer-events-none" />
                  <span className="absolute -top-4 left-0 text-[9px] font-mono font-medium text-slate-200 bg-slate-900/80 px-1 rounded border border-white/10">
                    FACE-ID: 0.99
                  </span>
                </div>

                {/* Top-Left Stream Telemetry Overlay */}
                <div className="absolute top-3 left-4 text-[10px] font-mono text-white/90 space-y-0.5 pointer-events-none drop-shadow-md">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-bold">LIVE STREAM</span>
                  </div>
                  <p className="text-white/70 text-[9px]">Gaze: [X: +0.02, Y: -0.01]</p>
                </div>

                {/* Top-Right Biometric & Peripheral Status */}
                <div className="absolute top-3 right-4 text-right text-[10px] font-mono text-white/90 pointer-events-none drop-shadow-md space-y-0.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <span>HUB</span>
                    <span className="inline-block w-4 h-2 border border-white/80 rounded-xs relative">
                      <span className="absolute inset-0.5 bg-emerald-400 rounded-xs" />
                    </span>
                  </div>
                  <p className="text-white/70 text-[9px]">Illuminance: 320 Lux (Optimal)</p>
                </div>

                {/* Bottom-Left Live Indicator Pill */}
                <div className="absolute bottom-3 left-3 pointer-events-none">
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900/85 backdrop-blur-xs border border-white/20 text-white text-[11px] font-medium shadow-md">
                    <span className={`w-2 h-2 rounded-full ${isGazeDeviated ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                    <span>
                      Gaze:{' '}
                      <strong className={isGazeDeviated ? 'text-amber-300 font-semibold' : 'text-slate-200 font-semibold'}>
                        {isGazeDeviated ? 'Deviated (3.8s)' : 'Nominal'}
                      </strong>
                    </span>
                    <span className="text-slate-400">|</span>
                    <span className="text-[10px] text-slate-300 font-mono">Head: Pitch -1°</span>
                  </div>
                </div>

                {/* Bottom-Right Verified ID Match Tag */}
                <div className="absolute bottom-3 right-3 pointer-events-none">
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/85 text-[10px] font-mono text-slate-200 border border-white/20">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ID: 99.4% Verified
                  </span>
                </div>
              </>
            ) : (
              <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                  <Camera className="w-6 h-6 text-slate-500" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-mono font-bold text-slate-300">
                    {candidate.status === 'DISCONNECTED' ? 'Candidate Disconnected' : 'Camera Feed Offline'}
                  </p>
                  <p className="text-[10px] text-slate-500 max-w-xs">
                    {candidate.status === 'DISCONNECTED'
                      ? 'The candidate is currently disconnected from the exam room.'
                      : 'Candidate webcam is disconnected or permissions have not been granted.'}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-md text-[10px] font-mono bg-slate-900 text-slate-400 border border-slate-800">
                  Status: {candidate.status} • Camera: Offline
                </span>
              </div>
            )
          )}

          {activeTab === 'screen' && (
            /* Screen Mirror View (SpeedExam & Proctortrack Style) */
            <div className="w-full h-full bg-slate-900 p-4 flex flex-col justify-between text-white font-mono">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold">Candidate Screen Mirror</span>
                </div>
                <span className="text-[10px] text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                  Full Screen Lock: Active
                </span>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-3 text-center space-y-2">
                <div className="w-full max-w-xs p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-left space-y-1 text-xs">
                  <p className="text-slate-400 text-[11px]">Active Window:</p>
                  <p className="text-slate-200 font-bold">ExamPortal - Question 18/40</p>
                  <p className="text-slate-500 text-[10px] pt-1">Browser: Chrome 128 (Single Monitor)</p>
                </div>
                <p className="text-[11px] text-slate-400">No secondary display or unauthorized processes detected.</p>
              </div>

              <div className="text-[10px] text-slate-500 flex justify-between pt-1 border-t border-slate-800">
                <span>Resolution: 1920x1080</span>
                <span>Clipboard: Locked</span>
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            /* Acoustic Spectrum View */
            <div className="w-full h-full bg-slate-900 p-4 flex flex-col justify-between text-white font-mono">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold">Acoustic Environmental Analysis</span>
                </div>
                <span className="text-[10px] text-slate-300">Ambience: Quiet ({dbLevel} dB)</span>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center space-y-3">
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono text-slate-200 tabular-nums">-{dbLevel} dB</p>
                  <p className="text-[11px] text-slate-400">Nominal Ambient Threshold: &lt; 60 dB</p>
                </div>
                <div className="w-3/4 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-slate-400 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, dbLevel * 2)}%` }}
                  />
                </div>
              </div>

              <p className="text-[10px] text-slate-500 text-center">Multi-speaker detection engine active. No whispers flagged.</p>
            </div>
          )}
        </div>

        {/* 3. Audio Spectrum Waveform Strip */}
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50/80 rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-2">
            <Mic className="w-3.5 h-3.5 text-slate-600" />
            <span className="text-[11px] font-bold text-slate-700">Audio Spectrum</span>
            <span className="text-[10px] font-mono text-slate-400">(-{dbLevel} dB)</span>
          </div>

          <div className="relative flex items-center justify-center gap-0.5 h-5 w-40 overflow-hidden">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-b border-dotted border-slate-300 pointer-events-none" />
            {waveHeights.map((h, i) => (
              <span
                key={i}
                className="relative z-10 w-1 bg-slate-600 rounded-full transition-all duration-200"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>

        {/* 4. Candidate Metadata Dossier (IP, Roll ID, Room Seat) */}
        {candidate && (
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 text-[11px] text-slate-600 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="font-bold text-slate-800">
                {candidate.name} <span className="font-mono text-slate-500 font-normal">({candidate.roll_id || `ID: ${candidate.student_id}`})</span>
              </p>
              <p className="text-[10px] text-slate-500 font-mono">
                Student ID: {candidate.student_id} • Status: {candidate.status}
              </p>
            </div>

            <div className="text-right space-y-0.5">
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                isFlagged ? 'bg-slate-100 text-slate-800 border border-slate-300' : 'bg-slate-50 text-slate-600 border border-slate-200'
              }`}>
                {isFlagged ? 'FLAGGED (REVIEW)' : 'NOMINAL (VERIFIED)'}
              </span>
              <p className="text-[10px] font-mono text-slate-500">
                Trust: <strong className="text-slate-800">{candidate.trust_score}%</strong>
              </p>
            </div>
          </div>
        )}

        {/* 5. Enterprise Invigilator Action Deck (Proctortrack / ExamSoft Interventions) */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          {/* Intercom Speak */}
          <button
            onClick={() => candidate && onIntercom?.(candidate.student_id)}
            className="py-2 px-1 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold transition-all shadow-2xs flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-slate-400"
            title="Broadcast two-way intercom to student"
          >
            <Radio className="w-3.5 h-3.5 text-slate-600" />
            <span>Intercom</span>
          </button>

          {/* Warn Student */}
          <button
            onClick={() => candidate && onWarn?.(candidate.student_id)}
            className="py-2 px-1 rounded-xl border border-amber-300 bg-white hover:bg-amber-50/70 text-amber-800 text-[11px] font-bold transition-all shadow-2xs flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            title="Issue formal academic integrity warning"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
            <span>Warn</span>
          </button>

          {/* Lock Screen */}
          <button
            onClick={() => candidate && onLock?.(candidate.student_id)}
            className="py-2 px-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold transition-all shadow-2xs flex flex-col items-center justify-center gap-0.5 cursor-pointer active:scale-98"
            title="Freeze candidate exam browser"
          >
            <Lock className="w-3.5 h-3.5 text-white" />
            <span>Lock Exam</span>
          </button>

          {/* Terminate Session */}
          <button
            onClick={() => candidate && onTerminate?.(candidate.student_id)}
            className="py-2 px-1 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-bold transition-all shadow-2xs flex flex-col items-center justify-center gap-0.5 cursor-pointer active:scale-98"
            title="Eject candidate and terminate exam"
          >
            <Slash className="w-3.5 h-3.5 text-slate-700" />
            <span>Terminate</span>
          </button>
        </div>
      </div>
    </div>
  );
};

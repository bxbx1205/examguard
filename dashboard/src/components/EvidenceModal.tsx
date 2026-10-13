import React from 'react';
import { 
  X, 
  AlertOctagon, 
  ShieldAlert, 
  UserX, 
  Camera, 
  Lock,
  Cpu
} from 'lucide-react';
import type { TelemetryEvent, Candidate } from '../types';

interface EvidenceModalProps {
  event: TelemetryEvent | null;
  candidate: Candidate | null;
  onClose: () => void;
  onAction: (actionType: 'WARN' | 'LOCK' | 'TERMINATE') => void;
}

export const EvidenceModal: React.FC<EvidenceModalProps> = ({
  event,
  candidate,
  onClose,
  onAction,
}) => {
  if (!event || !candidate) return null;

  const isCritical = event.severity === 'CRITICAL';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-slate-800 flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <span className={`p-2 rounded-xl border ${
              isCritical 
                ? 'bg-slate-100 text-slate-800 border-slate-200' 
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              <AlertOctagon className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">Telemetry Infraction Audit</h3>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                  isCritical ? 'bg-slate-900 text-white border-slate-800' : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}>
                  {event.severity}
                </span>
              </div>
              <p className="text-xs font-mono text-slate-500">Event ID: {event.event_id}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Snapshot Frame */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-slate-600" /> Evidentiary Frame
              </label>
              <span className="text-[10px] font-mono text-slate-400">{event.timestamp}</span>
            </div>

            <div className="relative aspect-video rounded-xl border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center group shadow-inner">
              {candidate.avatar ? (
                <img 
                  src={candidate.avatar} 
                  alt="Candidate Flagged Frame" 
                  className="w-full h-full object-cover" 
                />
              ) : (
                <div className="text-center p-4 z-20 flex flex-col items-center">
                  <div className="p-3 rounded-full bg-white border border-slate-200 text-slate-400 mb-2 shadow-xs">
                    <UserX className="w-8 h-8 text-slate-600" />
                  </div>
                  <p className="text-xs font-bold text-slate-600">Flagged Frame Captured</p>
                </div>
              )}

              {/* Red watermark flag */}
              <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-slate-900/90 text-white text-[10px] font-mono tracking-wider shadow-xs border border-white/20">
                FLAG: {event.subtype}
              </div>
            </div>

            <p className="text-[11px] text-slate-500 font-medium italic">
              Encrypted on-device snapshot stored in MinIO S3 evidence bucket.
            </p>
          </div>

          {/* Right: AI Breakdown & Actions */}
          <div className="flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-slate-600" /> AI Diagnostic Breakdown
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Candidate:</span>
                  <span className="font-bold text-slate-900">
                    {candidate.name} <span className="text-slate-400 font-normal">({candidate.roll_id || `#${candidate.student_id}`})</span>
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Infraction:</span>
                  <span className="font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    {event.subtype.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">AI Confidence:</span>
                  <span className="font-bold text-slate-900">
                    {(event.confidence * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                  <span className="text-slate-500 font-medium">Trust Score:</span>
                  <span className="font-bold text-sm text-slate-900">
                    {candidate.trust_score}% / 100%
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 font-medium">
                <span className="text-slate-500 block text-[10px] font-bold uppercase tracking-wider mb-0.5">Diagnostic Log:</span>
                {event.message}
              </div>
            </div>

            {/* Direct Invigilator Actions */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onAction('WARN')}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white hover:bg-amber-50/70 text-amber-800 border border-amber-300 font-bold text-xs transition cursor-pointer shadow-xs"
                >
                  <ShieldAlert className="w-3.5 h-3.5" /> Warn Student
                </button>

                <button
                  onClick={() => onAction('LOCK')}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer shadow-xs"
                >
                  <Lock className="w-3.5 h-3.5 text-white" /> Lock Screen
                </button>
              </div>

              <button
                onClick={() => onAction('TERMINATE')}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                <UserX className="w-3.5 h-3.5 text-white" /> Force Terminate Exam
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-between items-center text-xs">
          <span className="text-slate-400 font-medium">ExamGuard ProctorSentinel Engine</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 font-bold transition shadow-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
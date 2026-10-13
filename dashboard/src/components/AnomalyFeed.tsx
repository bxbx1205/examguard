import React, { useState } from 'react';
import { 
  Eye, 
  Volume2, 
  Monitor, 
  AlertCircle, 
  Clock, 
  ChevronRight, 
  Camera
} from 'lucide-react';
import type { TelemetryEvent, Candidate } from '../types';

interface AnomalyFeedProps {
  events: TelemetryEvent[];
  candidates: Candidate[];
  onSelectEvent: (event: TelemetryEvent, candidate: Candidate) => void;
}

export const AnomalyFeed: React.FC<AnomalyFeedProps> = ({
  events,
  candidates,
  onSelectEvent,
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'CRITICAL':
        return 'bg-slate-900 text-white border border-slate-800';
      case 'HIGH':
        return 'bg-amber-50 text-amber-800 border border-amber-200';
      case 'MEDIUM':
        return 'bg-slate-100 text-slate-800 border border-slate-200';
      default:
        return 'bg-slate-50 text-slate-600 border border-slate-200';
    }
  };

  const getCategoryTags = (cat?: string, subtype?: string) => {
    if (cat === 'VISION' || subtype?.includes('FACE') || subtype?.includes('GAZE')) {
      return [{ label: 'Vision AI', icon: Eye, color: 'bg-slate-100 text-slate-700 border-slate-200' }];
    }
    if (cat === 'AUDIO' || subtype?.includes('AUDIO') || subtype?.includes('WHISPER')) {
      return [{ label: 'Audio Engine', icon: Volume2, color: 'bg-slate-100 text-slate-700 border-slate-200' }];
    }
    return [{ label: 'Sandbox / OS', icon: Monitor, color: 'bg-slate-100 text-slate-700 border-slate-200' }];
  };

  const filteredList = events.filter((item: any) => {
    if (filterCategory === 'ALL') return true;
    if (filterCategory === 'CRITICAL') return item.severity === 'CRITICAL';
    if (filterCategory === 'VISION') return item.category === 'VISION' || item.subtype?.includes('FACE') || item.subtype?.includes('GAZE');
    if (filterCategory === 'AUDIO') return item.category === 'AUDIO' || item.subtype?.includes('AUDIO');
    return true;
  });

  return (
    <div className="space-y-2">
      {/* 1. Header with Filters (Proctortrack Style) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-slate-700" />
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Incident Forensic Stream
          </h3>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold border border-slate-200">
            {filteredList.length} Events
          </span>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1 text-[11px] font-bold">
          {['ALL', 'CRITICAL', 'VISION', 'AUDIO'].map((f) => (
            <button
              key={f}
              onClick={() => setFilterCategory(f)}
              className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                filterCategory === f
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Scrollable Incidents List Container */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-2.5 shadow-xs space-y-2 max-h-[290px] overflow-y-auto">
        {filteredList.length === 0 ? (
          <div className="py-10 px-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50 space-y-2">
            <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-500">
              <Eye className="w-4 h-4 text-slate-400" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-slate-700">No Violations Logged</p>
              <p className="text-[10px] text-slate-500 max-w-xs mx-auto">
                Candidate integrity nominal. Real-time vision, audio, and lockdown infractions will stream here as detected.
              </p>
            </div>
          </div>
        ) : (
          filteredList.map((item: any) => {
            const candidate = candidates.find((c) => c.student_id === item.student_id || c.student_id === item.studentId) || candidates[0];
          const tags = item.tags || getCategoryTags(item.category, item.subtype);
          const studentName = item.student_name || item.studentName || candidate?.name || 'Candidate';
          const rollId = candidate?.roll_id || item.rollId || 'BTech-CS';
          const time = item.timestamp || item.time || '15:04:00';
          const confidence = item.confidence ? `${Math.round(item.confidence * 100)}% Conf` : '98% Conf';
          const title = item.title || `${item.severity} | ${item.subtype?.replace(/_/g, ' ')}`;

          return (
            <div
              key={item.id || item.event_id}
              onClick={() => {
                const eventToPass: TelemetryEvent = {
                  event_id: item.event_id || item.id,
                  student_id: item.student_id || item.studentId,
                  timestamp: time,
                  subtype: item.subtype || 'ANOMALY',
                  severity: item.severity,
                  confidence: item.confidence || 0.98,
                  message: item.message || title,
                };
                if (candidate) onSelectEvent(eventToPass, candidate);
              }}
              className="p-2.5 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50/80 transition-all cursor-pointer space-y-1.5 group shadow-2xs"
            >
              {/* Row Top: Severity Badge + Student Info + Timestamp */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide shrink-0 ${getSeverityBadge(item.severity)}`}>
                    {item.severity}
                  </span>
                  <p className="text-xs font-bold text-slate-800 truncate">
                    {studentName} <span className="text-[10px] text-slate-400 font-mono font-normal">({rollId})</span>
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono text-slate-400 group-hover:text-slate-600">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>{time}</span>
                </div>
              </div>

              {/* Row Middle: Violation Description */}
              <p className="text-xs text-slate-600 font-medium leading-tight line-clamp-1 group-hover:text-slate-900">
                {title}
              </p>

              {/* Row Bottom: Category Tags + AI Confidence + Action Trigger */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
                <div className="flex items-center gap-1.5">
                  {tags.map((t: any, idx: number) => {
                    const Icon = t.icon;
                    return (
                      <span
                        key={idx}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold flex items-center gap-1 ${t.color}`}
                      >
                        <Icon className="w-3 h-3" />
                        {t.label}
                      </span>
                    );
                  })}
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono font-bold">
                    {confidence}
                  </span>
                </div>

                <div className="flex items-center gap-1 text-slate-700 font-bold opacity-0 group-hover:opacity-100 transition-opacity group-hover:text-slate-900">
                  <Camera className="w-3 h-3 text-slate-700 group-hover:text-slate-900" />
                  <span>Inspect Audit Snapshot</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              </div>
            </div>
          );
        })
      )}
      </div>
    </div>
  );
};

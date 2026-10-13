import React from 'react';
import { 
  ShieldCheck, 
  Users, 
  AlertTriangle, 
  Wifi, 
  Activity, 
  FileText, 
  Sliders, 
  Lock, 
  Radio, 
  Eye
} from 'lucide-react';
import type { ConnectionStatus } from '../types';

interface SidebarProps {
  connectionStatus: ConnectionStatus;
  onlineCount?: number;
  flaggedCount?: number;
  activeNavTab?: string;
  onNavTabChange?: (tab: string) => void;
  onAuditClick?: () => void;
  onBroadcastClick?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  connectionStatus,
  onlineCount = 0,
  flaggedCount = 0,
  activeNavTab = 'fleet',
  onNavTabChange,
  onAuditClick,
  onBroadcastClick,
}) => {
  const isConnected = connectionStatus === 'CONNECTED';

  const navItems = [
    { id: 'fleet', label: 'Live Fleet Monitor', icon: Eye, count: onlineCount },
    { id: 'incidents', label: 'Incident Audit Log', icon: FileText, count: flaggedCount, badgeColor: 'bg-slate-100 text-slate-800 border border-slate-200' },
    { id: 'verification', label: 'Biometric Verification', icon: ShieldCheck, sub: 'ExamID 100%' },
    { id: 'rules', label: 'Exam Integrity Rules', icon: Sliders },
  ];

  return (
    <aside className="w-68 bg-white border-r border-slate-200/90 flex flex-col justify-between shrink-0 select-none shadow-[1px_0_3px_rgba(0,0,0,0.02)]">
      <div className="flex flex-col overflow-y-auto">
        {/* 1. Institutional Brand Header */}
        <div className="h-16 px-4 bg-white flex items-center justify-between border-b border-slate-200/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-xs">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm tracking-tight text-slate-900">ExamGuard</span>
                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                  v2.4
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium tracking-tight">Enterprise Invigilation</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-[10px] font-medium text-slate-600" title={isConnected ? 'Edge Engine Active' : 'Connecting to Edge'}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-slate-800' : 'bg-slate-400'}`} />
            <span className="font-mono text-[9px]">{isConnected ? 'LIVE' : 'CONN'}</span>
          </div>
        </div>

        {/* 2. Active Exam Session Card */}
        <div className="p-3.5 space-y-3.5 border-b border-slate-100">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-700 bg-slate-200/70 px-2 py-0.5 rounded-md border border-slate-300/70">
                Live Proctoring
              </span>
              <span className="text-[11px] font-mono text-slate-500 font-semibold">CS501-FIN</span>
            </div>
            <p className="font-bold text-xs text-slate-900 leading-snug">
              Distributed Systems End-Semester
            </p>
            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500 border-t border-slate-200/60">
              <span>Mode: Web Lockdown</span>
              <span className="font-medium text-slate-700">Sentinel Active</span>
            </div>
          </div>

          {/* Real-time Telemetry Pills */}
          <div className="grid grid-cols-2 gap-2">
            <div className="px-2.5 py-2 rounded-xl bg-slate-100 text-slate-800 border border-slate-200 flex items-center justify-between shadow-2xs">
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-600" />
                <span className="text-[11px] font-bold">Online</span>
              </div>
              <span className="text-xs font-extrabold text-slate-900 tabular-nums">{onlineCount}</span>
            </div>

            <div className="px-2.5 py-2 rounded-xl bg-slate-100 text-slate-800 border border-slate-200 flex items-center justify-between shadow-2xs">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-slate-600" />
                <span className="text-[11px] font-bold">Flagged</span>
              </div>
              <span className="text-xs font-extrabold text-slate-900 tabular-nums">{flaggedCount}</span>
            </div>
          </div>

          {/* Edge Server Connection Badge */}
          <div className="py-1.5 px-2.5 rounded-lg bg-slate-100/80 text-slate-700 text-[11px] font-medium flex items-center justify-between border border-slate-200/80">
            <div className="flex items-center gap-1.5">
              <Wifi className={`w-3.5 h-3.5 ${isConnected ? 'text-slate-700' : 'text-slate-400'}`} />
              <span className="font-mono text-[10px]">Go:8080 (12ms)</span>
            </div>
            <span className="text-[10px] uppercase font-bold text-slate-500">
              {isConnected ? 'Sync: 100%' : 'Reconnecting'}
            </span>
          </div>
        </div>

        {/* 3. Navigation Menu Items */}
        <div className="p-3 space-y-1">
          <p className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Navigation Deck
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNavTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavTabChange?.(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span
                    className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full tabular-nums ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : item.badgeColor || 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
                {item.sub && (
                  <span className={`text-[10px] font-mono ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>
                    {item.sub}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 4. Active Integrity Policy Thresholds (Proctortrack / ExamSoft Style) */}
        <div className="px-3.5 py-2">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1">
                <Activity className="w-3 h-3 text-slate-700" />
                Active Security Rules
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            </div>
            <div className="space-y-1 text-[11px] text-slate-600 font-medium">
              <div className="flex justify-between">
                <span>Face Missing:</span>
                <span className="font-mono text-slate-800 font-bold">≤ 5.0s</span>
              </div>
              <div className="flex justify-between">
                <span>Gaze Deviation:</span>
                <span className="font-mono text-slate-800 font-bold">≤ 15.0° (3.5s)</span>
              </div>
              <div className="flex justify-between">
                <span>Max Tab Switches:</span>
                <span className="font-mono text-slate-800 font-bold">2 Allowed</span>
              </div>
              <div className="flex justify-between">
                <span>Disqualification:</span>
                <span className="font-mono text-slate-900 font-bold">&lt; 40% Trust</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Institutional Interventions & Footer Actions */}
      <div className="p-3 border-t border-slate-200/80 bg-slate-50/50 space-y-2">
        <button
          onClick={onBroadcastClick}
          className="w-full py-2 px-3 rounded-xl border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs hover:border-slate-400"
        >
          <Radio className="w-3.5 h-3.5 text-slate-600" />
          <span>Broadcast Notice</span>
        </button>

        <button
          onClick={onAuditClick}
          className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
        >
          <Lock className="w-3.5 h-3.5 text-white" />
          <span>Audit Snapshots & Action</span>
        </button>
      </div>
    </aside>
  );
};

import React from 'react';

export const MapLegend: React.FC = () => {
  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-slate-800 bg-[#090e1a]/90 backdrop-blur-md px-3.5 py-2.5 text-xs shadow-xl">
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 font-mono">
        Map Legend & Severity
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse border border-red-300" />
          <span className="text-slate-300">Critical Road Incident</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500 border border-orange-300" />
          <span className="text-slate-300">High Risk / Major Hazard</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400 border border-amber-200" />
          <span className="text-slate-300">Medium Congestion / Roadwork</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 border border-emerald-200" />
          <span className="text-slate-300">Low Severity / Monitored Flow</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500 border border-amber-300 font-mono text-[7px] text-white flex items-center justify-center font-bold">
            TT
          </span>
          <span className="text-slate-300">TomTom Live Incident</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] text-slate-400">
        Click marker to inspect corridor telemetry
      </div>
    </div>
  );
};

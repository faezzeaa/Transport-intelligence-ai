import React from 'react';
import {
  Zap,
  RotateCw,
  AlertTriangle,
  Flame,
  Gauge,
  Clock,
  Layers,
  MapPin,
  CheckCircle2,
  Navigation,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { TomTomAnalyticsData, LocationPreset } from '../../types';

export const LOCATION_PRESETS: LocationPreset[] = [
  // Tamil Nadu locations
  {
    id: 'chennai',
    name: 'Chennai',
    state: 'Tamil Nadu',
    lat: 13.0827,
    lng: 80.2707,
    zoom: 12.0,
    description: 'State Capital & Arterial Grid',
    badge: 'Metro Corridor',
  },
  {
    id: 'coimbatore',
    name: 'Coimbatore',
    state: 'Tamil Nadu',
    lat: 11.0168,
    lng: 76.9558,
    zoom: 12.5,
    description: 'Western Industrial & Freight Hub',
    badge: 'Industrial Grid',
  },
  {
    id: 'madurai',
    name: 'Madurai',
    state: 'Tamil Nadu',
    lat: 9.9252,
    lng: 78.1198,
    zoom: 12.5,
    description: 'Central Tamil Nadu Arterial',
    badge: 'Transit Hub',
  },
  {
    id: 'trichy',
    name: 'Tiruchirappalli',
    state: 'Tamil Nadu',
    lat: 10.7905,
    lng: 78.7047,
    zoom: 12.5,
    description: 'Central Junction & NH Arterials',
    badge: 'Central Junction',
  },
  {
    id: 'salem',
    name: 'Salem',
    state: 'Tamil Nadu',
    lat: 11.6643,
    lng: 78.1460,
    zoom: 12.5,
    description: 'Northern Steel & Transit Highway',
    badge: 'Highway Crossing',
  },
  {
    id: 'tirunelveli',
    name: 'Tirunelveli',
    state: 'Tamil Nadu',
    lat: 8.7139,
    lng: 77.7567,
    zoom: 12.5,
    description: 'Southern Arterial Corridor',
    badge: 'Southern Hub',
  },
  {
    id: 'kanyakumari',
    name: 'Kanyakumari',
    state: 'Tamil Nadu',
    lat: 8.0883,
    lng: 77.5385,
    zoom: 12.5,
    description: 'Southernmost Coastal Highway Node',
    badge: 'Coastal Sector',
  },
  // Karnataka locations
  {
    id: 'bengaluru',
    name: 'Bengaluru',
    state: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    zoom: 12.0,
    description: 'Tech Capital & Major Metro Arterial',
    badge: 'Interstate Metro',
  },
];

interface LiveTrafficAnalyticsPanelProps {
  analytics: TomTomAnalyticsData | null;
  isLoading: boolean;
  onRefresh: () => void;
  onSelectPreset: (preset: LocationPreset) => void;
  activePresetId?: string;
  onSelectSlowSegment?: (segment: { lat: number; lng: number; road: string }) => void;
}

export const LiveTrafficAnalyticsPanel: React.FC<LiveTrafficAnalyticsPanelProps> = ({
  analytics,
  isLoading,
  onRefresh,
  onSelectPreset,
  activePresetId,
  onSelectSlowSegment,
}) => {
  const metrics = analytics?.metrics;
  const slowSegments = analytics?.slow_segments || [];
  const breakdown = metrics?.incident_breakdown;

  // Format timestamp nicely
  const formattedTime = analytics?.timestamp
    ? new Date(analytics.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120] p-4 sm:p-5 shadow-xs transition-colors space-y-4">
      {/* Header with Title, Status & Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Zap className="h-5 w-5 fill-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-mono uppercase tracking-wide">
                Live TomTom Traffic Intelligence
              </h3>
              <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 text-[10px] font-mono font-semibold">
                REAL API
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Sector: <span className="font-semibold text-slate-800 dark:text-slate-200">{analytics?.location_name || 'Active Viewport'}</span>
              {analytics?.is_clamped && (
                <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 font-mono">(Visible 8,500 km² window)</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {formattedTime && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-2.5 py-1 rounded-lg">
              <Clock className="h-3.5 w-3.5 text-sky-500" />
              <span>Synced {formattedTime}</span>
            </span>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-xs disabled:opacity-50"
            title="Fetch latest traffic flow and incidents from TomTom"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-sky-500' : ''}`} />
            <span>{isLoading ? 'Updating...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Quick Location Presets Grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <MapPin className="h-3 w-3 text-sky-500" />
            Quick Geographic Exploration (Tamil Nadu & Bengaluru):
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LOCATION_PRESETS.map((loc) => {
            const isActive = activePresetId === loc.id;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => onSelectPreset(loc)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-sky-600 text-white font-semibold shadow-xs ring-2 ring-sky-400/40'
                    : 'bg-slate-50 dark:bg-slate-900/70 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{loc.name}</span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                    isActive
                      ? 'bg-sky-700 text-sky-100'
                      : loc.state === 'Karnataka'
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {loc.state === 'Karnataka' ? 'KA' : 'TN'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Metric 1: Congestion Level */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40 p-3">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-[11px] font-mono uppercase">Congestion Index</span>
            <Gauge className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {metrics ? `${metrics.congestion_pct}%` : '---'}
            </span>
          </div>
          <p className="text-[11px] font-semibold mt-1 text-slate-600 dark:text-slate-300">
            {metrics?.congestion_label || 'Awaiting live sync'}
          </p>
        </div>

        {/* Metric 2: Observed Speed */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40 p-3">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-[11px] font-mono uppercase">Observed Speed</span>
            <Navigation className="h-4 w-4 text-sky-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {metrics?.current_speed_kmh !== null && metrics?.current_speed_kmh !== undefined
                ? `${metrics.current_speed_kmh} km/h`
                : 'N/A'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Free flow: {metrics?.free_flow_speed_kmh ? `${metrics.free_flow_speed_kmh} km/h` : 'N/A'}
          </p>
        </div>

        {/* Metric 3: Active Incidents */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40 p-3">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-[11px] font-mono uppercase">Live Incidents</span>
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {metrics ? metrics.total_incidents : '---'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {metrics?.total_incidents === 0
              ? 'No disruptions reported'
              : `${metrics?.total_incidents || 0} alerts in view`}
          </p>
        </div>

        {/* Metric 4: Cumulative Delay */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40 p-3">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="text-[11px] font-mono uppercase">Estimated Delay</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {metrics ? `${metrics.total_delay_minutes}m` : '---'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {metrics?.total_delay_seconds ? `${metrics.total_delay_seconds}s total delay` : 'No delay registered'}
          </p>
        </div>
      </div>

      {/* Incident Breakdown Chips */}
      {breakdown && metrics.total_incidents > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[10px] font-mono uppercase text-slate-400">Incident Breakdown:</span>
          {breakdown.congestion_jams > 0 && (
            <span className="rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/40 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300 font-mono">
              Jams: <strong>{breakdown.congestion_jams}</strong>
            </span>
          )}
          {breakdown.road_closures > 0 && (
            <span className="rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/40 px-2 py-0.5 text-xs text-rose-800 dark:text-rose-300 font-mono">
              Closures: <strong>{breakdown.road_closures}</strong>
            </span>
          )}
          {breakdown.roadworks > 0 && (
            <span className="rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/40 px-2 py-0.5 text-xs text-sky-800 dark:text-sky-300 font-mono">
              Roadwork: <strong>{breakdown.roadworks}</strong>
            </span>
          )}
          {breakdown.accidents > 0 && (
            <span className="rounded bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/40 px-2 py-0.5 text-xs text-red-800 dark:text-red-300 font-mono font-bold">
              Accidents: <strong>{breakdown.accidents}</strong>
            </span>
          )}
        </div>
      )}

      {/* Top Slow Road Segments */}
      {slowSegments.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Critical Slow Road Segments / Bottlenecks:</span>
            <span className="text-[10px]">Click segment to locate on map</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {slowSegments.map((seg, idx) => (
              <button
                key={seg.id || idx}
                type="button"
                onClick={() => {
                  if (onSelectSlowSegment && seg.latitude && seg.longitude) {
                    onSelectSlowSegment({ lat: seg.latitude, lng: seg.longitude, road: seg.road });
                  }
                }}
                className="w-full text-left p-2.5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-sky-500 transition-colors">
                      {seg.road}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {seg.description}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
                      +{seg.delay_minutes}m
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Zero Incident Notice if none detected */}
      {metrics && metrics.total_incidents === 0 && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>
            TomTom Live Traffic reports <strong>normal traffic flow</strong> with zero active road closures, accidents, or major delays in this sector.
          </span>
        </div>
      )}
    </div>
  );
};


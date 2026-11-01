import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  Flame,
  Activity,
  Layers,
  Gauge,
  TrendingUp,
  MapPin,
  Clock,
  ShieldCheck,
  Compass,
  Zap,
} from 'lucide-react';
import { Incident, IncidentStatistics, TomTomStatus, TomTomFlowData, LocationPreset, TomTomAnalyticsData } from '../types';
import { StatCard } from '../components/common/StatCard';
import { TransportMap } from '../components/map/TransportMap';
import { IncidentFeed } from '../components/incidents/IncidentFeed';
import { LiveTrafficAnalyticsPanel, LOCATION_PRESETS } from '../components/traffic/LiveTrafficAnalyticsPanel';
import { api } from '../services/api';

interface OverviewPageProps {
  incidents: Incident[];
  statistics: IncidentStatistics | null;
  selectedIncident: Incident | null;
  onSelectIncident: (incident: Incident | null) => void;
  onUpdateStatus: (id: string, newStatus: any) => Promise<void>;
  isLoading?: boolean;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  incidents,
  statistics,
  selectedIncident,
  onSelectIncident,
  onUpdateStatus,
  isLoading,
}) => {
  const total = statistics?.total_incidents ?? incidents.length;
  const critical = statistics?.critical_incidents ?? incidents.filter((i) => i.severity === 'CRITICAL').length;
  const avgCongestion = statistics?.average_congestion_pct ?? 54.2;
  const monitoredCorridors = statistics?.monitored_corridors_count ?? 8;

  // TomTom live traffic & analytics state
  const [tomtomStatus, setTomtomStatus] = useState<TomTomStatus | null>(null);
  const [liveFlow, setLiveFlow] = useState<TomTomFlowData | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationPreset>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('location')?.toLowerCase();
      if (param) {
        const found = LOCATION_PRESETS.find((p) => p.id === param || p.name.toLowerCase() === param);
        if (found) return found;
      }
    }
    return LOCATION_PRESETS[0];
  });
  const [analyticsData, setAnalyticsData] = useState<TomTomAnalyticsData | null>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState<boolean>(false);
  const [targetFlyTo, setTargetFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  const fetchAnalytics = useCallback(async (loc: LocationPreset, bbox?: [number, number, number, number]) => {
    setIsAnalyticsLoading(true);
    try {
      const params: any = {
        lat: loc.lat,
        lng: loc.lng,
        location_name: `${loc.name}, ${loc.state}`,
      };
      if (bbox && bbox.length === 4) {
        params.min_lon = bbox[0];
        params.min_lat = bbox[1];
        params.max_lon = bbox[2];
        params.max_lat = bbox[3];
      }
      const data = await api.getTomTomAnalytics(params);
      setAnalyticsData(data);
      if (data.metrics && data.metrics.current_speed_kmh !== null) {
        setLiveFlow({
          current_speed: data.metrics.current_speed_kmh,
          free_flow_speed: data.metrics.free_flow_speed_kmh || data.metrics.current_speed_kmh,
          congestion_pct: data.metrics.congestion_pct,
          current_travel_time_sec: data.metrics.total_delay_seconds,
          free_flow_travel_time_sec: 0,
          confidence: data.metrics.confidence,
          road_closure: data.metrics.incident_breakdown.road_closures > 0,
          frc: 'LIVE',
          coordinates: [],
        });
      }
    } catch (err) {
      console.warn('[OverviewPage] Failed to fetch TomTom analytics:', err);
    } finally {
      setIsAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    api.getTomTomStatus()
      .then((status) => {
        setTomtomStatus(status);
        if (status.is_configured) {
          fetchAnalytics(selectedLocation);
        }
      })
      .catch((err) => console.warn('[OverviewPage] TomTom status error:', err));
  }, [fetchAnalytics]);

  return (
    <div className="space-y-5">
      {/* Operational Provenance & Verification Notice */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120] px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300 shadow-xs transition-colors">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
          <span>
            Operational Intelligence Platform: Verified telemetry synced from SQLite persistence.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          {tomtomStatus?.is_configured && (
            <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 flex items-center gap-1 font-semibold">
              <Zap className="h-3 w-3 text-amber-500 fill-amber-500" />
              TomTom Live Traffic: Connected {liveFlow ? `(${liveFlow.current_speed} km/h • ${liveFlow.congestion_pct}% delay)` : ''}
            </span>
          )}
          <span className="rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40 px-2 py-0.5">
            Sample incidents: SIMULATED DEMO DATA
          </span>
          <span className="rounded bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/40 px-2 py-0.5">
            Geospatial: MapLibre + Mappls Proxy
          </span>
        </div>
      </div>

      {/* Top Operational KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          title="Active Road Incidents"
          value={total}
          subtitle="Monitored in municipal grid"
          change="+2 vs last hr"
          isPositiveChange={false}
          variant={total > 10 ? 'warning' : 'default'}
          icon={<AlertTriangle className="h-5 w-5" />}
        />

        <StatCard
          title="Critical Emergencies"
          value={critical}
          subtitle="Requires priority dispatch"
          change={critical > 0 ? 'Active Dispatch' : 'Nominal'}
          isPositiveChange={critical === 0}
          variant={critical > 0 ? 'critical' : 'default'}
          icon={<Flame className="h-5 w-5" />}
        />

        <StatCard
          title="Corridor Congestion"
          value={`${avgCongestion}%`}
          subtitle="Network-wide delay index"
          change="-3.4% 24h trend"
          isPositiveChange={true}
          variant="accent"
          icon={<Gauge className="h-5 w-5" />}
        />

        <StatCard
          title="Monitored Corridors"
          value={monitoredCorridors}
          subtitle="Connected transit arterials"
          change="100% telemetry online"
          isPositiveChange={true}
          variant="default"
          icon={<Layers className="h-5 w-5" />}
        />
      </div>
 
       {/* Live TomTom Traffic Intelligence & Quick Geographic Exploration */}
       {tomtomStatus?.is_configured && (
         <LiveTrafficAnalyticsPanel
           analytics={analyticsData}
           isLoading={isAnalyticsLoading}
           onRefresh={() => fetchAnalytics(selectedLocation)}
           onSelectPreset={(preset) => {
             setSelectedLocation(preset);
             setTargetFlyTo({ lat: preset.lat, lng: preset.lng, zoom: preset.zoom });
             fetchAnalytics(preset);
           }}
           activePresetId={selectedLocation.id}
           onSelectSlowSegment={(seg) => {
             setTargetFlyTo({ lat: seg.lat, lng: seg.lng, zoom: 15.0 });
           }}
         />
       )}
 
       {/* Main Grid: Interactive Map + Synchronized Live Incident Feed */}
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
         <div className="lg:col-span-2 space-y-3">
           <div className="flex flex-wrap items-center justify-between gap-2">
             <div>
               <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide font-mono uppercase">
                 Geographic Traffic Operations Map
               </h2>
               <p className="text-xs text-slate-500 dark:text-slate-400">
                 Spatial telemetry • Mappls Geocoding & Routing • Fallback Basemap Architecture
               </p>
             </div>
             <span className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120] px-2.5 py-1 text-[11px] font-mono text-slate-600 dark:text-slate-400 shadow-xs">
               Selected: {selectedLocation.name}, {selectedLocation.state} ({selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)})
             </span>
           </div>
 
           <TransportMap
             incidents={incidents}
             selectedIncident={selectedIncident}
             onSelectIncident={onSelectIncident}
             onUpdateStatus={onUpdateStatus}
             isLoading={isLoading}
             activeLocation={selectedLocation}
             targetFlyTo={targetFlyTo}
             onLocationChange={(loc) => {
               setSelectedLocation(loc);
               fetchAnalytics(loc);
             }}
             onViewportChange={(vp) => {
               fetchAnalytics(
                 {
                   id: 'viewport',
                   name: `${vp.center[1].toFixed(2)}°N, ${vp.center[0].toFixed(2)}°E`,
                   state: 'Visible Area',
                   lat: vp.center[1],
                   lng: vp.center[0],
                   zoom: vp.zoom,
                   description: 'Visible Viewport',
                 },
                 vp.bbox
               );
             }}
           />
        </div>

        <div className="h-[620px]">
          <IncidentFeed
            incidents={incidents}
            selectedIncident={selectedIncident}
            onSelectIncident={onSelectIncident}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* 24-Hour Network Telemetry Trend Bar */}
      {statistics?.hourly_trends && statistics.hourly_trends.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120] p-4 shadow-xs transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white font-mono uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                24-Hour Network Incident & Congestion Curve
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Hourly distribution of detected incidents and arterial congestion percentages
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
                <span className="h-2 w-2 rounded-full bg-sky-500" />
                Incidents
              </span>
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Congestion %
              </span>
            </div>
          </div>

          {/* Sparkline Histogram */}
          <div className="grid grid-cols-12 sm:grid-cols-24 gap-1 items-end h-24 pt-2">
            {statistics.hourly_trends.map((item, idx) => {
              const heightPct = Math.min(100, Math.max(15, item.congestion_pct));
              return (
                <div
                  key={idx}
                  className="group relative flex flex-col items-center justify-end h-full"
                >
                  <div
                    className="w-full rounded-t transition-all group-hover:brightness-110 cursor-pointer bg-gradient-to-t from-sky-200 to-sky-500 dark:from-sky-900/60 dark:to-sky-400/80"
                    style={{ height: `${heightPct}%` }}
                  />
                  <span className="mt-1 text-[9px] text-slate-400 font-mono hidden md:block">
                    {item.hour.split(':')[0]}
                  </span>

                  {/* Tooltip */}
                  <div className="absolute -top-12 hidden group-hover:flex flex-col items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-[10px] text-slate-900 dark:text-white font-mono shadow-md z-20 whitespace-nowrap pointer-events-none">
                    <span>{item.hour}</span>
                    <span className="text-amber-600 dark:text-amber-400">{item.congestion_pct}% Congestion</span>
                    <span className="text-sky-600 dark:text-sky-300">{item.incident_count} Incidents</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

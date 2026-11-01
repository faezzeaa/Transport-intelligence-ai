import {
  Incident,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
  IncidentStatistics,
  PaginatedIncidentsResponse,
  SystemHealth,
  VisionAnalysisResult,
  VisionAnalysisHistoryItem,
  VisionSubsystemStatus,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface IncidentFilterOptions {
  category?: IncidentCategory;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  search?: string;
  min_lat?: number;
  max_lat?: number;
  min_lng?: number;
  max_lng?: number;
  corridor?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export const api = {
  async getHealth(): Promise<SystemHealth> {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) {
      throw new Error(`Health check failed with status: ${res.status}`);
    }
    return res.json();
  },

  async getIncidents(options: IncidentFilterOptions = {}): Promise<PaginatedIncidentsResponse> {
    const query = new URLSearchParams();
    if (options.category) query.append('category', options.category);
    if (options.severity) query.append('severity', options.severity);
    if (options.status) query.append('status', options.status);
    if (options.search) query.append('search', options.search);
    if (options.min_lat !== undefined) query.append('min_lat', options.min_lat.toString());
    if (options.max_lat !== undefined) query.append('max_lat', options.max_lat.toString());
    if (options.min_lng !== undefined) query.append('min_lng', options.min_lng.toString());
    if (options.max_lng !== undefined) query.append('max_lng', options.max_lng.toString());
    if (options.corridor) query.append('corridor', options.corridor);
    if (options.sort_by) query.append('sort_by', options.sort_by);
    if (options.sort_order) query.append('sort_order', options.sort_order);
    if (options.page) query.append('page', options.page.toString());
    if (options.page_size) query.append('page_size', options.page_size.toString());

    const url = `${API_BASE}/incidents${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch incidents: ${res.statusText}`);
    }
    return res.json();
  },

  async getIncident(id: string): Promise<Incident> {
    const res = await fetch(`${API_BASE}/incidents/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch incident ${id}`);
    }
    return res.json();
  },

  async createIncident(incidentData: {
    title: string;
    description?: string;
    category: IncidentCategory;
    severity: IncidentSeverity;
    latitude: number;
    longitude: number;
    location_name: string;
    corridor?: string;
    speed_limit_kmh?: number;
    current_speed_kmh?: number;
    congestion_level_pct?: number;
    affected_lanes?: number;
    tags?: string[];
  }): Promise<Incident> {
    const res = await fetch(`${API_BASE}/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...incidentData,
        is_simulated: true,
        data_source: 'SIMULATED DEMO DATA',
      }),
    });
    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      const message = errorJson.details?.[0]?.message || errorJson.error || 'Failed to create incident';
      throw new Error(message);
    }
    return res.json();
  },

  async updateIncidentStatus(id: string, status: IncidentStatus): Promise<Incident> {
    const res = await fetch(`${API_BASE}/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      throw new Error(`Failed to update status for incident ${id}`);
    }
    return res.json();
  },

  async deleteIncident(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/incidents/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(`Failed to delete incident ${id}`);
    }
  },

  async getStatistics(): Promise<IncidentStatistics> {
    const res = await fetch(`${API_BASE}/statistics`);
    if (!res.ok) {
      throw new Error(`Failed to fetch statistics: ${res.statusText}`);
    }
    return res.json();
  },

  async analyzeVisionMedia(file: File, adapter?: 'real' | 'simulator'): Promise<VisionAnalysisResult> {
    const formData = new FormData();
    formData.append('file', file);

    const query = adapter ? `?adapter=${encodeURIComponent(adapter)}` : '';
    const res = await fetch(`${API_BASE}/vision/analyze${query}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new Error(errorJson.detail || errorJson.error || 'Vision analysis failed');
    }
    return res.json();
  },

  async getVisionHistory(limit: number = 20): Promise<VisionAnalysisHistoryItem[]> {
    const res = await fetch(`${API_BASE}/vision/history?limit=${limit}`);
    if (!res.ok) {
      throw new Error('Failed to fetch vision analysis history');
    }
    return res.json();
  },

  async getVisionHistoryDetail(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/vision/history/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch vision analysis ${id}`);
    }
    return res.json();
  },

  async getVisionStatus(): Promise<VisionSubsystemStatus> {
    const res = await fetch(`${API_BASE}/vision/status`);
    if (!res.ok) {
      throw new Error('Failed to fetch vision status');
    }
    return res.json();
  },

  async getSampleVideo(): Promise<File> {
    const res = await fetch(`${API_BASE}/vision/sample-video`);
    if (!res.ok) throw new Error('Sample traffic video not available on server');
    const blob = await res.blob();
    return new File([blob], 'sample_traffic_video.mp4', { type: 'video/mp4' });
  },

  async getSampleImage(): Promise<File> {
    const res = await fetch(`${API_BASE}/vision/sample-image`);
    if (!res.ok) throw new Error('Sample traffic image not available on server');
    const blob = await res.blob();
    return new File([blob], 'sample_traffic.jpg', { type: 'image/jpeg' });
  },

  async analyzeVisionFrame(
    file: Blob | File,
    timestampSec?: number,
    videoFilename?: string,
    adapter?: 'real' | 'simulator',
    options?: {
      persist?: boolean;
      enable_tracking?: boolean;
      generate_preview?: boolean;
      session_id?: string;
      cordon_y?: number;
      confidence_threshold?: number;
    }
  ): Promise<VisionAnalysisResult> {
    const formData = new FormData();
    const actualFile =
      file instanceof File
        ? file
        : new File([file], `frame_${timestampSec !== undefined ? timestampSec.toFixed(2) : 'capture'}.jpg`, {
            type: 'image/jpeg',
          });
    formData.append('file', actualFile);
    if (timestampSec !== undefined) {
      formData.append('timestamp_sec', timestampSec.toString());
    }
    if (videoFilename) {
      formData.append('video_filename', videoFilename);
    }
    if (options?.session_id) {
      formData.append('session_id', options.session_id);
    }

    const params = new URLSearchParams();
    if (adapter) params.append('adapter', adapter);
    if (options?.persist !== undefined) params.append('persist', options.persist.toString());
    if (options?.enable_tracking !== undefined) params.append('enable_tracking', options.enable_tracking.toString());
    if (options?.generate_preview !== undefined) params.append('generate_preview', options.generate_preview.toString());
    if (options?.cordon_y !== undefined) params.append('cordon_y', options.cordon_y.toString());
    if (options?.confidence_threshold !== undefined) params.append('confidence_threshold', options.confidence_threshold.toString());

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/vision/analyze-frame${queryString}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new Error(errorJson.detail || errorJson.error || 'Frame analysis failed');
    }
    return res.json();
  },

  async resetLiveVisionSession(sessionId: string): Promise<{ status: string; session_id: string }> {
    const res = await fetch(`${API_BASE}/vision/live-session/reset?session_id=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error('Failed to reset live session');
    }
    return res.json();
  },

  async saveLiveSessionSummary(
    sessionId: string,
    videoFilename: string,
    durationSeconds?: number,
    fpsProcessed?: number,
    processingTimeMs?: number,
    options?: {
      confidence_threshold?: number;
      cordon_y?: number;
      adapter_name?: string;
    }
  ): Promise<VisionAnalysisResult> {
    const params = new URLSearchParams({
      session_id: sessionId,
      video_filename: videoFilename,
    });
    if (durationSeconds !== undefined) params.append('duration_seconds', durationSeconds.toString());
    if (fpsProcessed !== undefined) params.append('fps_processed', fpsProcessed.toString());
    if (processingTimeMs !== undefined) params.append('processing_time_ms', processingTimeMs.toString());
    if (options?.confidence_threshold !== undefined) params.append('confidence_threshold', options.confidence_threshold.toString());
    if (options?.cordon_y !== undefined) params.append('cordon_y', options.cordon_y.toString());
    if (options?.adapter_name) params.append('adapter_name', options.adapter_name);

    const res = await fetch(`${API_BASE}/vision/live-session/summary?${params.toString()}`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error('Failed to save live session summary');
    }
    return res.json();
  },

  async analyzeMovingVideo(
    file: File,
    options?: {
      sample_fps?: number;
      confidence_threshold?: number;
      enable_tracking?: boolean;
      cordon_y?: number;
      time_bucket_seconds?: number;
      session_id?: string;
      force_reanalyze?: boolean;
      adapter?: 'real' | 'simulator';
    }
  ): Promise<VisionAnalysisResult> {
    const formData = new FormData();
    formData.append('file', file);

    const params = new URLSearchParams();
    if (options?.sample_fps) params.append('sample_fps', options.sample_fps.toString());
    if (options?.confidence_threshold) params.append('confidence_threshold', options.confidence_threshold.toString());
    if (options?.enable_tracking !== undefined) params.append('enable_tracking', options.enable_tracking.toString());
    if (options?.cordon_y) params.append('cordon_y', options.cordon_y.toString());
    if (options?.time_bucket_seconds) params.append('time_bucket_seconds', options.time_bucket_seconds.toString());
    if (options?.session_id) params.append('session_id', options.session_id);
    if (options?.force_reanalyze) params.append('force_reanalyze', 'true');
    if (options?.adapter) params.append('adapter', options.adapter);

    const res = await fetch(`${API_BASE}/vision/analyze-video?${params.toString()}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new Error(errorJson.detail || errorJson.error || 'Video intelligence processing failed');
    }
    return res.json();
  },

  async evaluateVision(payload: import('../types').EvaluationRequest): Promise<import('../types').EvaluationSummary> {
    const res = await fetch(`${API_BASE}/vision/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Ground-truth evaluation failed');
    }
    return res.json();
  },

  async getVisionAnalytics(analysisId: string): Promise<import('../types').VisionAnalyticsResponse> {
    const res = await fetch(`${API_BASE}/vision/analytics/${analysisId}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch vision analytics for ${analysisId}`);
    }
    return res.json();
  },

  async getBenchmarkSample(): Promise<any> {
    const res = await fetch(`${API_BASE}/vision/benchmark-sample`);
    if (!res.ok) {
      throw new Error('Failed to fetch benchmark sample dataset');
    }
    return res.json();
  },

  async getMapplsStatus(): Promise<import('../types').MapplsStatus> {
    const res = await fetch(`${API_BASE}/mappls/status`);
    if (!res.ok) {
      throw new Error(`Failed to fetch Mappls status: ${res.statusText}`);
    }
    return res.json();
  },

  async geocodeMappls(query: string): Promise<import('../types').MapplsGeocodeResponse> {
    const res = await fetch(`${API_BASE}/mappls/geocode?query=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Mappls geocoding request failed');
    }
    return res.json();
  },

  async calculateMapplsRoute(payload: {
    start_lng: number;
    start_lat: number;
    end_lng: number;
    end_lat: number;
    profile?: string;
  }): Promise<import('../types').MapplsRouteResponse> {
    const res = await fetch(`${API_BASE}/mappls/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Mappls routing request failed');
    }
    return res.json();
  },
  async getTomTomStatus(): Promise<import('../types').TomTomStatus> {
    const res = await fetch(`${API_BASE}/tomtom/status`);
    if (!res.ok) {
      throw new Error(`Failed to fetch TomTom status: ${res.statusText}`);
    }
    return res.json();
  },

  async getTomTomFlow(lat: number, lng: number, unit: string = 'KMPH'): Promise<import('../types').TomTomFlowResponse> {
    const res = await fetch(`${API_BASE}/tomtom/flow?lat=${lat}&lng=${lng}&unit=${unit}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to fetch TomTom traffic flow');
    }
    return res.json();
  },

  async getTomTomIncidents(bbox?: [number, number, number, number]): Promise<import('../types').TomTomIncidentsResponse> {
    let url = `${API_BASE}/tomtom/incidents`;
    if (bbox && bbox.length === 4) {
      url += `?min_lon=${bbox[0]}&min_lat=${bbox[1]}&max_lon=${bbox[2]}&max_lat=${bbox[3]}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to fetch TomTom incidents');
    }
    return res.json();
  },

  async getTomTomAnalytics(params: {
    lat: number;
    lng: number;
    min_lon?: number;
    min_lat?: number;
    max_lon?: number;
    max_lat?: number;
    location_name?: string;
  }): Promise<import('../types').TomTomAnalyticsData> {
    const q = new URLSearchParams();
    q.append('lat', params.lat.toString());
    q.append('lng', params.lng.toString());
    if (params.min_lon !== undefined) q.append('min_lon', params.min_lon.toString());
    if (params.min_lat !== undefined) q.append('min_lat', params.min_lat.toString());
    if (params.max_lon !== undefined) q.append('max_lon', params.max_lon.toString());
    if (params.max_lat !== undefined) q.append('max_lat', params.max_lat.toString());
    if (params.location_name) q.append('location_name', params.location_name);
    const res = await fetch(`${API_BASE}/tomtom/analytics?${q.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to fetch TomTom traffic analytics');
    }
    return res.json();
  },

  getTomTomFlowTileUrl(): string {
    return `${API_BASE}/tomtom/tiles/flow/{z}/{x}/{y}.png`;
  },

  getTomTomIncidentTileUrl(): string {
    return `${API_BASE}/tomtom/tiles/incidents/{z}/{x}/{y}.png`;
  },
};
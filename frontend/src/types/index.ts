export type IncidentCategory =
  | 'ACCIDENT'
  | 'CONGESTION'
  | 'ROADWORK'
  | 'HAZARD'
  | 'VEHICLE_BREAKDOWN'
  | 'PEDESTRIAN_CROSSING_RISK'
  | 'WEATHER_EVENT';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type IncidentStatus = 'REPORTED' | 'VERIFIED' | 'DISPATCHED' | 'RESOLVED';

export interface Incident {
  id: string;
  title: string;
  description: string | null;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  latitude: number;
  longitude: number;
  location_name: string;
  corridor: string | null;
  speed_limit_kmh: number | null;
  current_speed_kmh: number | null;
  congestion_level_pct: number;
  affected_lanes: number;
  tags: string[];
  is_simulated: boolean;
  data_source: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface PaginatedIncidentsResponse {
  items: Incident[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  is_simulated_notice: string;
}

export interface HourlyTrend {
  timestamp: string;
  hour: string;
  incident_count: number;
  congestion_pct: number;
  average_speed_kmh: number;
}

export interface IncidentStatistics {
  total_incidents: number;
  active_incidents: number;
  critical_incidents: number;
  high_priority_incidents: number;
  average_congestion_pct: number;
  monitored_corridors_count: number;
  severity_breakdown: Record<IncidentSeverity, number>;
  category_breakdown: Record<IncidentCategory, number>;
  status_breakdown: Record<IncidentStatus, number>;
  hourly_trends: HourlyTrend[];
  simulated_data_tag: string;
}

export interface BoundingBox {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

export interface DetectedObject {
  id: string;
  class_name: string;
  confidence: number;
  box: BoundingBox;
  track_id?: number;
  speed_estimate_kmh?: number;
  hazard_flag: boolean;
}

export interface FrameDetectionSummary {
  frame_index: number;
  timestamp_sec: number;
  vehicle_count: number;
  pedestrian_count: number;
  objects?: DetectedObject[];
}

export interface TrafficEvent {
  event_id: string;
  track_id: number;
  class_name: string;
  event_type: string;
  timestamp_sec: number;
  direction?: string;
  confidence?: number;
  cordon_y?: number;
}

export interface TimeBucketSummary {
  bucket_index: number;
  start_sec: number;
  end_sec: number;
  total_detections: number;
  unique_vehicles: number;
  class_breakdown: Record<string, number>;
  pedestrian_count: number;
  average_congestion: string;
}

export interface TrackTrajectoryPoint {
  x: number;
  y: number;
  timestamp_sec: number;
}

export interface TrackedVehicleItem {
  track_id: number;
  class_name: string;
  first_seen_sec: number;
  last_seen_sec: number;
  duration_sec: number;
  detection_count: number;
  trajectory: TrackTrajectoryPoint[];
  last_box?: BoundingBox;
}

export interface TrackingSummary {
  unique_vehicles_tracked: number;
  unique_pedestrians_tracked: number;
  vehicle_breakdown: Record<string, number>;
  total_tracks_assigned: number;
  tracks: TrackedVehicleItem[];
  events: TrafficEvent[];
  tracking_algorithm: string;
  limitations_notice: string;
}

export interface ClassEvaluationMetrics {
  ground_truth_count: number;
  predicted_count: number;
  true_positives: number;
  false_positives: number;
  missed_detections: number;
  precision: number;
  recall: number;
  f1_score: number;
  mean_iou: number;
}

export interface EvaluationPerformance {
  total_inference_time_ms: number;
  avg_frame_latency_ms: number;
  effective_processing_fps: number;
}

export interface EvaluationSummary {
  status: string;
  iou_threshold: number;
  evaluated_frames_count: number;
  total_ground_truth_objects: number;
  total_predicted_objects: number;
  true_positives: number;
  false_positives: number;
  missed_detections: number;
  precision: number;
  recall: number;
  f1_score: number;
  mean_iou: number;
  class_metrics: Record<string, ClassEvaluationMetrics>;
  performance?: EvaluationPerformance;
  evaluation_conditions: Record<string, any>;
}

export interface VisionAnalysisResult {
  analysis_id: string;
  media_name: string;
  media_type: 'image' | 'video' | 'frame';
  width: number;
  height: number;
  file_size_bytes: number;
  processing_time_ms: number;
  adapter_name: string;
  is_simulated: boolean;
  status: 'COMPLETED' | 'FAILED';
  error_message?: string | null;
  session_id?: string | null;
  video_hash?: string | null;
  duration_seconds?: number | null;
  frame_count_sampled?: number;
  frame_timestamp_sec?: number | null;
  source_video_name?: string | null;
  representative_frame_base64?: string | null;
  frame_timeline?: FrameDetectionSummary[] | null;
  total_vehicles: number;
  vehicle_breakdown: Record<string, number>;
  total_pedestrians: number;
  unique_vehicles_tracked: number;
  total_frame_detections: number;
  estimated_congestion_level: 'LOW' | 'MODERATE' | 'HEAVY' | 'SEVERE';
  collision_risk_score: number;
  lane_blockage_detected: boolean;
  detected_hazards: string[];
  detected_objects: DetectedObject[];
  tracking_summary?: TrackingSummary | null;
  time_buckets?: TimeBucketSummary[] | null;
  events?: TrafficEvent[] | null;
  evaluation_summary?: EvaluationSummary | null;
  fps_processed?: number;
  inference_config?: Record<string, any>;
  recommendations: string[];
  timestamp: string;
  data_source?: string;
  provenance_notice: string;
}

export interface VisionAnalysisHistoryItem {
  id: string;
  filename: string;
  media_type: string;
  file_size_bytes: number;
  duration_seconds?: number | null;
  frame_count_sampled: number;
  frame_timestamp_sec?: number | null;
  source_video_name?: string | null;
  session_id?: string | null;
  status: string;
  error_message?: string | null;
  adapter_name: string;
  is_simulated: boolean;
  data_source: string;
  total_vehicles: number;
  total_pedestrians: number;
  unique_vehicles_tracked: number;
  total_frame_detections: number;
  events_count: number;
  fps_processed: number;
  has_tracking: boolean;
  has_evaluation: boolean;
  is_legacy?: boolean;
  vehicle_breakdown: Record<string, number>;
  processing_time_ms: number;
  created_at: string;
  representative_frame_base64?: string | null;
}

export interface VisionAnalyticsResponse {
  analysis_id: string;
  session_id?: string | null;
  filename: string;
  media_type: string;
  duration_seconds?: number | null;
  frame_count_sampled: number;
  fps_processed: number;
  unique_vehicles_tracked: number;
  total_frame_detections: number;
  vehicle_breakdown: Record<string, number>;
  total_pedestrians: number;
  estimated_congestion_level: string;
  time_buckets: TimeBucketSummary[];
  events: TrafficEvent[];
  tracking_summary?: TrackingSummary | null;
  evaluation_summary?: EvaluationSummary | null;
  inference_config: Record<string, any>;
  limitations_notice: string;
}

export interface EvaluationRequest {
  analysis_id?: string;
  ground_truth_json: Record<string, any>;
  iou_threshold?: number;
}

export interface VisionSubsystemStatus {
  adapter_name: string;
  is_simulated: boolean;
  is_available: boolean;
  mode: string;
  real_model?: {
    name: string;
    weights_path: string;
    is_available: boolean;
    execution_provider: string;
    supported_classes: string[];
  };
  simulator?: {
    name: string;
    is_available: boolean;
  };
  description: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'offline';
  service: string;
  version: string;
  timestamp: string;
  database: {
    status: string;
    latency_ms: number;
    engine: string;
  };
  vision_subsystem: {
    active_adapter: string;
    is_simulated: boolean;
    is_available: boolean;
    execution_provider?: string;
    available_providers?: string[];
  };
  storage: {
    total_gb: number;
    used_gb: number;
    free_gb: number;
  };
  hardware_detection: {
    gpu_detected: string;
    host_gpu?: string;
    inference_runtime?: string;
    execution_provider?: string;
    cuda_driver_ready: boolean;
    phase: string;
  };
  notice: string;
}

export interface MapplsStatus {
  provider: string;
  status: 'OPERATIONAL' | 'AUTH_FAILED' | 'NOT_CONFIGURED' | 'SERVICE_UNAVAILABLE';
  is_configured: boolean;
  is_operational: boolean;
  client_id_present: boolean;
  client_secret_present: boolean;
  rest_key_present: boolean;
  masked_client_id: string;
  http_status_code: number | null;
  diagnostic_message: string;
  entitled_capabilities: string[];
  fallback_active: boolean;
  fallback_provider: string;
  attribution: string;
}

export interface MapplsGeocodeItem {
  formatted_address: string;
  latitude: number;
  longitude: number;
  place_id?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface MapplsGeocodeResponse {
  success: boolean;
  provider: string;
  query?: string;
  results_count?: number;
  results: MapplsGeocodeItem[];
  http_status_code?: number;
  error?: string;
  attribution?: string;
  fallback_active?: boolean;
}

export interface MapplsRouteResponse {
  success: boolean;
  provider: string;
  distance_meters?: number;
  duration_seconds?: number;
  geometry?: any;
  http_status_code?: number;
  error?: string;
  attribution?: string;
  fallback_active?: boolean;
}

export type AppModule =
  | 'overview'
  | 'map'
  | 'traffic-intelligence'
  | 'safety'
  | 'traffic'
  | 'explorer'
  | 'planning'
  | 'sustainability'
  | 'accessibility'
  | 'settings';


export interface TomTomStatus {
  provider: string;
  status: string;
  is_configured: boolean;
  is_operational: boolean;
  masked_api_key: string;
  capabilities: string[];
  diagnostic_message: string;
  attribution: string;
}

export interface TomTomFlowData {
  current_speed: number;
  free_flow_speed: number;
  congestion_pct: number;
  current_travel_time_sec: number;
  free_flow_travel_time_sec: number;
  confidence: number;
  road_closure: boolean;
  frc: string;
  coordinates?: [number, number][];
}

export interface TomTomFlowResponse {
  success: boolean;
  provider: string;
  latitude: number;
  longitude: number;
  unit: string;
  flow: TomTomFlowData;
  attribution: string;
}

export interface TomTomIncidentItem {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  latitude: number;
  longitude: number;
  location_name: string;
  delay_seconds: number;
  magnitude_of_delay: number;
  length_meters: number;
  geometry: any;
  start_time?: string;
  end_time?: string;
  is_simulated: boolean;
  data_source: string;
}

export interface TomTomIncidentsResponse {
  success: boolean;
  provider: string;
  bbox: [number, number, number, number];
  incidents_count: number;
  incidents: TomTomIncidentItem[];
  attribution: string;
}

export interface LocationPreset {
  id: string;
  name: string;
  state: 'Tamil Nadu' | 'Karnataka' | string;
  lat: number;
  lng: number;
  zoom: number;
  description: string;
  badge?: string;
}

export interface SlowSegmentItem {
  id: string;
  road: string;
  delay_seconds: number;
  delay_minutes: number;
  severity: string;
  category: string;
  description: string;
  latitude: number;
  longitude: number;
}

export interface TomTomAnalyticsData {
  success: boolean;
  provider: string;
  location_name: string;
  center: [number, number];
  bbox: [number, number, number, number];
  is_clamped?: boolean;
  timestamp: string;
  coverage_status: 'VERIFIED_LIVE' | 'LOW_DENSITY_ROAD' | 'NOT_CONFIGURED';
  metrics: {
    congestion_pct: number;
    congestion_level: 'OPTIMAL_FLOW' | 'MODERATE' | 'HEAVY' | 'SEVERE';
    congestion_label: string;
    congestion_color: 'emerald' | 'sky' | 'amber' | 'rose';
    current_speed_kmh: number | null;
    free_flow_speed_kmh: number | null;
    speed_ratio_pct: number | null;
    total_delay_seconds: number;
    total_delay_minutes: number;
    total_incidents: number;
    incident_breakdown: {
      accidents: number;
      congestion_jams: number;
      roadworks: number;
      road_closures: number;
      hazards: number;
    };
    confidence: number;
  };
  slow_segments: SlowSegmentItem[];
  attribution: string;
}


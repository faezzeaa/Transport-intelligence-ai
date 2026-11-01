import base64
import io
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.config import get_settings
from app.schemas.vision import (
    BoundingBox,
    DetectedObject,
    FrameDetectionSummary,
    TimeBucketSummary,
    TrafficEvent,
    TrackingSummary,
    TrackedVehicleItem,
    TrackTrajectoryPoint,
    VisionAnalysisResult,
)
from app.services.vision.base import BaseVisionService
from app.services.vision.tracker import IoUTracker

settings = get_settings()

# In-memory live session trackers for synchronized video playback
_LIVE_SESSION_TRACKERS: Dict[str, Tuple[IoUTracker, float]] = {}


def get_or_create_live_tracker(session_id: str, cordon_y: float = 0.60) -> IoUTracker:
    """Retrieve or initialize an IoUTracker for an active video playback session."""
    now = time.time()
    # Prune stale trackers (> 120s inactive)
    expired = [sid for sid, (_, last_seen) in _LIVE_SESSION_TRACKERS.items() if now - last_seen > 120.0]
    for sid in expired:
        _LIVE_SESSION_TRACKERS.pop(sid, None)

    if session_id in _LIVE_SESSION_TRACKERS:
        tracker, _ = _LIVE_SESSION_TRACKERS[session_id]
        tracker.cordon_y = cordon_y
        _LIVE_SESSION_TRACKERS[session_id] = (tracker, now)
        return tracker

    tracker = IoUTracker(iou_threshold=0.25, max_lost=3, min_hits_for_unique=1, cordon_y=cordon_y)
    _LIVE_SESSION_TRACKERS[session_id] = (tracker, now)
    return tracker


def reset_live_tracker(session_id: str) -> bool:
    """Reset the live tracker for a given session."""
    if session_id in _LIVE_SESSION_TRACKERS:
        _LIVE_SESSION_TRACKERS.pop(session_id, None)
        return True
    return False


def get_live_tracker_summary(session_id: str) -> Optional[Dict]:
    """Retrieve finalized summary from live tracker if available."""
    if session_id in _LIVE_SESSION_TRACKERS:
        tracker, _ = _LIVE_SESSION_TRACKERS[session_id]
        tracker.finalize()
        return tracker.get_summary()
    return None

COCO_CLASSES: Dict[int, str] = {
    0: "pedestrian",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    9: "traffic_light",
    11: "stop_sign",
}

TARGET_TRANSPORT_CLASSES = set(COCO_CLASSES.keys())


def nms_numpy(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.45) -> List[int]:
    """Pure NumPy Non-Maximum Suppression."""
    if len(boxes) == 0:
        return []
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        inds = np.where(iou <= iou_threshold)[0]
        order = order[inds + 1]
    return keep


class RealVisionAdapter(BaseVisionService):
    """
    Genuine Pretrained Transport Vision Adapter using YOLOv8n in ONNX Runtime.
    Performs real object detection and multi-object tracking across sequential video frames.
    Does NOT fabricate vehicle speeds, GPS coordinates, or simulated incidents.
    """

    def __init__(self, weights_path: Optional[str] = None):
        self.custom_path_provided = weights_path is not None
        self.raw_weights_path = weights_path if weights_path is not None else settings.VISION_MODEL_PATH
        self.weights_path = self._resolve_weights_path(self.raw_weights_path, allow_default_fallback=not self.custom_path_provided)
        self._session = None
        self._execution_provider = "CPUExecutionProvider"

    def _resolve_weights_path(self, path: str, allow_default_fallback: bool = False) -> str:
        """Resolve model weights path relative to workspace root or current directory."""
        candidates = [
            path,
            os.path.abspath(path),
            os.path.join(os.getcwd(), path),
            os.path.join(os.path.dirname(__file__), "..", "..", "..", path),
        ]
        if allow_default_fallback:
            candidates.extend([
                os.path.join(os.getcwd(), "backend", "weights", "yolov8n.onnx"),
                os.path.join(os.getcwd(), "weights", "yolov8n.onnx"),
                os.path.join(os.path.dirname(__file__), "..", "..", "..", "weights", "yolov8n.onnx"),
            ])

        for c in candidates:
            if c and os.path.exists(c) and os.path.isfile(c):
                return os.path.abspath(c)
        return path

    @property
    def adapter_name(self) -> str:
        return "Real-Time Neural Vision Adapter (YOLOv8n ONNX Engine)"

    @property
    def is_simulated(self) -> bool:
        return False

    def is_available(self) -> bool:
        """Verifies if model weights exist and onnxruntime is functional."""
        resolved = self._resolve_weights_path(
            self.raw_weights_path, allow_default_fallback=not self.custom_path_provided
        )
        if not (os.path.exists(resolved) and os.path.isfile(resolved)):
            return False
        try:
            import onnxruntime  # noqa: F401
            return True
        except ImportError:
            return False

    def _get_session(self):
        """Lazy loader for ONNX inference session."""
        if self._session is None:
            resolved = self._resolve_weights_path(
                self.raw_weights_path, allow_default_fallback=not self.custom_path_provided
            )
            if not os.path.exists(resolved):
                raise RuntimeError(
                    f"Production Vision Model is currently unavailable: weights file '{self.raw_weights_path}' "
                    "was not found. Please download model weights using 'python backend/app/services/vision/download_weights.py' "
                    "or verify 'backend/weights/yolov8n.onnx' exists."
                )
            try:
                import onnxruntime as ort
                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 4
                self._session = ort.InferenceSession(resolved, sess_options=opts, providers=["CPUExecutionProvider"])
                self.weights_path = resolved
            except Exception as e:
                raise RuntimeError(f"Production Vision Model is currently unavailable: failed to initialize ONNX Runtime: {e}")
        return self._session

    def _preprocess_image(self, img: Image.Image) -> Tuple[np.ndarray, float, int, int]:
        """Letterbox resize to 640x640 with preserved aspect ratio."""
        orig_w, orig_h = img.size
        scale = min(640 / orig_w, 640 / orig_h)
        new_w, new_h = max(1, int(round(orig_w * scale))), max(1, int(round(orig_h * scale)))
        pad_x = (640 - new_w) // 2
        pad_y = (640 - new_h) // 2

        img_resized = img.resize((new_w, new_h), Image.Resampling.BILINEAR)
        canvas = Image.new("RGB", (640, 640), (114, 114, 114))
        canvas.paste(img_resized, (pad_x, pad_y))

        arr = np.array(canvas, dtype=np.float32) / 255.0
        arr = np.transpose(arr, (2, 0, 1))
        arr = np.expand_dims(arr, axis=0)
        return arr, scale, pad_x, pad_y

    def _detect_on_pil_image(
        self,
        img: Image.Image,
        confidence_threshold: float = 0.35,
        iou_threshold: float = 0.45,
    ) -> List[DetectedObject]:
        """Execute YOLOv8n ONNX inference on a PIL image and return post-NMS detected objects."""
        session = self._get_session()
        orig_w, orig_h = img.size
        input_data, scale, pad_x, pad_y = self._preprocess_image(img)

        input_name = session.get_inputs()[0].name
        raw_output = session.run(None, {input_name: input_data})[0]

        # Shape is (1, 84, 8400) -> transpose to (8400, 84)
        preds = np.transpose(raw_output[0])
        boxes_cxcywh = preds[:, :4]
        scores = preds[:, 4:]

        class_ids = np.argmax(scores, axis=1)
        confidences = np.max(scores, axis=1)

        mask = confidences >= confidence_threshold
        boxes_cxcywh = boxes_cxcywh[mask]
        confidences = confidences[mask]
        class_ids = class_ids[mask]

        if len(boxes_cxcywh) == 0:
            return []

        # Convert cx, cy, w, h -> x1, y1, x2, y2 on 640x640 canvas
        x1 = boxes_cxcywh[:, 0] - boxes_cxcywh[:, 2] / 2
        y1 = boxes_cxcywh[:, 1] - boxes_cxcywh[:, 3] / 2
        x2 = boxes_cxcywh[:, 0] + boxes_cxcywh[:, 2] / 2
        y2 = boxes_cxcywh[:, 1] + boxes_cxcywh[:, 3] / 2
        boxes_xyxy = np.stack([x1, y1, x2, y2], axis=1)

        detected_objects: List[DetectedObject] = []
        obj_counter = 1

        for target_class in np.unique(class_ids):
            if int(target_class) not in TARGET_TRANSPORT_CLASSES:
                continue

            c_mask = class_ids == target_class
            c_boxes = boxes_xyxy[c_mask]
            c_scores = confidences[c_mask]
            keep_indices = nms_numpy(c_boxes, c_scores, iou_threshold=iou_threshold)

            for idx in keep_indices:
                box = c_boxes[idx]
                # Invert letterbox back to original image
                orig_x1 = max(0.0, (box[0] - pad_x) / scale)
                orig_y1 = max(0.0, (box[1] - pad_y) / scale)
                orig_x2 = min(float(orig_w), (box[2] - pad_x) / scale)
                orig_y2 = min(float(orig_h), (box[3] - pad_y) / scale)

                norm_x_min = max(0.0, min(1.0, round(orig_x1 / orig_w, 4)))
                norm_y_min = max(0.0, min(1.0, round(orig_y1 / orig_h, 4)))
                norm_x_max = max(0.0, min(1.0, round(orig_x2 / orig_w, 4)))
                norm_y_max = max(0.0, min(1.0, round(orig_y2 / orig_h, 4)))

                class_name = COCO_CLASSES.get(int(target_class), "vehicle")
                conf = float(round(c_scores[idx], 3))

                detected_objects.append(
                    DetectedObject(
                        id=f"det-{obj_counter}",
                        class_name=class_name,
                        confidence=conf,
                        box=BoundingBox(
                            x_min=norm_x_min,
                            y_min=norm_y_min,
                            x_max=norm_x_max,
                            y_max=norm_y_max,
                        ),
                        track_id=None,
                        speed_estimate_kmh=None,  # Not fabricated without camera calibration
                        hazard_flag=(class_name == "pedestrian"),
                    )
                )
                obj_counter += 1

        return detected_objects

    def _draw_annotations(
        self,
        img: Image.Image,
        detections: List[DetectedObject],
        cordon_y: Optional[float] = None,
        tracks: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """Annotate representative frame with bounding boxes, track IDs, and cordon indicator."""
        annotated = img.copy()
        draw = ImageDraw.Draw(annotated)
        w, h = annotated.size

        # Color palette for classes
        colors = {
            "car": "#38bdf8",         # Sky Blue
            "bus": "#818cf8",         # Indigo
            "truck": "#fbbf24",       # Amber
            "motorcycle": "#34d399",  # Emerald
            "bicycle": "#2dd4bf",     # Teal
            "pedestrian": "#facc15",  # Yellow
            "traffic_light": "#f43f5e",
            "stop_sign": "#ef4444",
        }

        # Optional virtual cordon line
        if cordon_y is not None and 0.0 < cordon_y < 1.0:
            cord_pixel_y = int(cordon_y * h)
            draw.line([(0, cord_pixel_y), (w, cord_pixel_y)], fill="#f43f5e", width=2)
            draw.text((10, max(2, cord_pixel_y - 14)), "VIRTUAL CORDON LINE", fill="#f43f5e")

        # Draw trajectory trails for tracked vehicles if available
        if tracks:
            for t in tracks:
                traj = t.get("trajectory", [])
                if len(traj) >= 2:
                    pts = [(int(p["x"] * w), int(p["y"] * h)) for p in traj[-6:]]
                    for i in range(len(pts) - 1):
                        draw.line([pts[i], pts[i + 1]], fill="#38bdf8", width=2)

        for det in detections:
            color = colors.get(det.class_name, "#38bdf8")
            x1 = int(det.box.x_min * w)
            y1 = int(det.box.y_min * h)
            x2 = int(det.box.x_max * w)
            y2 = int(det.box.y_max * h)

            # Draw outer rectangle
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)

            # Draw label banner with track ID if present
            if det.track_id is not None:
                label = f"#{det.track_id} {det.class_name} {int(det.confidence * 100)}%"
            else:
                label = f"{det.class_name} {int(det.confidence * 100)}%"

            text_y = max(0, y1 - 18)
            draw.rectangle([x1, text_y, x1 + (len(label) * 8) + 8, text_y + 16], fill="#0f172a")
            draw.text((x1 + 4, text_y + 1), label, fill=color)

        buf = io.BytesIO()
        annotated.save(buf, format="JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    def _probe_video_metadata(self, video_path: str) -> Tuple[float, int, int]:
        """Extract video duration and resolution using ffprobe or fallback."""
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration:stream=width,height",
            "-of", "json",
            video_path,
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=10)
            data = json.loads(res.stdout)
            duration = float(data.get("format", {}).get("duration", 0.0))
            streams = data.get("streams", [{}])
            width = int(streams[0].get("width", 1280)) if streams else 1280
            height = int(streams[0].get("height", 720)) if streams else 720
            return duration, width, height
        except Exception:
            return 3.0, 1280, 720

    def _sample_video_frames(
        self,
        video_path: str,
        output_dir: str,
        fps: float = 1.0,
        max_frames: int = 60,
    ) -> List[Tuple[str, float]]:
        """
        Sample frames from video using ffmpeg at specified FPS.
        Returns list of (frame_filepath, timestamp_seconds) strictly sorted by timestamp.
        """
        output_pattern = os.path.join(output_dir, "frame_%04d.jpg")
        cmd = [
            "ffmpeg",
            "-v", "error",
            "-i", video_path,
            "-vf", f"fps={fps}",
            output_pattern,
        ]
        try:
            subprocess.run(cmd, check=True, timeout=45)
        except Exception as e:
            raise RuntimeError(f"FFmpeg frame extraction failed: {e}")

        extracted = sorted([f for f in os.listdir(output_dir) if f.startswith("frame_") and f.endswith(".jpg")])
        if not extracted:
            raise RuntimeError("Video frame extraction yielded zero frames. Video may be corrupt or empty.")

        frames_with_ts = []
        for i, fname in enumerate(extracted[:max_frames]):
            ts = round(i / fps, 2)
            frames_with_ts.append((os.path.join(output_dir, fname), ts))
        return frames_with_ts

    async def analyze_media(
        self,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        sample_fps: Optional[float] = None,
        confidence_threshold: Optional[float] = None,
        enable_tracking: bool = True,
        cordon_y: float = 0.60,
        time_bucket_seconds: float = 2.0,
        session_id: Optional[str] = None,
        generate_preview: bool = True,
        timestamp_sec: Optional[float] = None,
    ) -> VisionAnalysisResult:
        start_time = time.perf_counter()

        if not self.is_available():
            raise RuntimeError(
                f"Production Vision Model is currently unavailable: weights file '{self.raw_weights_path}' "
                "or deep learning framework (e.g., onnxruntime) is not installed. "
                "Use the 'SimulatedVisionAdapter' for testing or download weights for Real Inference."
            )

        is_video = any(filename.lower().endswith(ext) for ext in [".mp4", ".mov", ".webm", ".avi"])
        video_hash = hashlib.sha256(file_bytes).hexdigest()

        if is_video:
            return await self._analyze_video(
                file_bytes=file_bytes,
                filename=filename,
                start_time=start_time,
                sample_fps=sample_fps or settings.SAMPLE_FPS,
                confidence_threshold=confidence_threshold or 0.35,
                enable_tracking=enable_tracking,
                cordon_y=cordon_y,
                time_bucket_seconds=time_bucket_seconds,
                session_id=session_id,
                video_hash=video_hash,
            )
        else:
            return await self._analyze_image(
                file_bytes=file_bytes,
                filename=filename,
                start_time=start_time,
                confidence_threshold=confidence_threshold or 0.35,
                session_id=session_id,
                video_hash=video_hash,
                enable_tracking=enable_tracking,
                cordon_y=cordon_y,
                timestamp_sec=timestamp_sec,
                generate_preview=generate_preview,
            )

    async def _analyze_image(
        self,
        file_bytes: bytes,
        filename: str,
        start_time: float,
        confidence_threshold: float = 0.35,
        session_id: Optional[str] = None,
        video_hash: Optional[str] = None,
        enable_tracking: bool = False,
        cordon_y: float = 0.60,
        timestamp_sec: Optional[float] = None,
        generate_preview: bool = True,
    ) -> VisionAnalysisResult:
        try:
            img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        except Exception as e:
            raise ValueError(f"Failed to decode image file: {e}")

        width, height = img.size
        detections = self._detect_on_pil_image(img, confidence_threshold=confidence_threshold)

        # In-flight live tracking association across consecutive playback frames
        event_items: List[TrafficEvent] = []
        unique_vehicles_tracked = None

        if enable_tracking and session_id:
            tracker = get_or_create_live_tracker(session_id, cordon_y=cordon_y)
            ts = timestamp_sec if timestamp_sec is not None else 0.0
            det_dicts = [
                {
                    "id": d.id,
                    "class_name": d.class_name,
                    "confidence": d.confidence,
                    "box": d.box.model_dump(),
                }
                for d in detections
            ]
            tracked_det_dicts = tracker.update_frame(det_dicts, timestamp_sec=ts)
            detections = [
                DetectedObject(
                    id=td["id"],
                    class_name=td["class_name"],
                    confidence=td["confidence"],
                    box=BoundingBox(**td["box"]),
                    track_id=td.get("track_id"),
                    hazard_flag=(td["class_name"] == "pedestrian"),
                )
                for td in tracked_det_dicts
            ]

            # Recent cordon events from this frame
            for ev in tracker.events[-3:]:
                if abs(ev.get("timestamp_sec", 0.0) - ts) <= 0.6:
                    event_items.append(
                        TrafficEvent(
                            event_id=ev["event_id"],
                            track_id=ev["track_id"],
                            class_name=ev["class_name"],
                            event_type=ev["event_type"],
                            timestamp_sec=ev["timestamp_sec"],
                            direction=ev.get("direction"),
                            confidence=ev.get("confidence"),
                            cordon_y=ev.get("cordon_y"),
                        )
                    )

            live_summary = tracker.get_summary()
            unique_vehicles_tracked = live_summary.get("unique_vehicles_tracked", 0)

        representative_b64 = self._draw_annotations(img, detections, cordon_y=cordon_y) if generate_preview else None

        # Aggregate counts
        vehicle_classes = {"car", "bus", "truck", "motorcycle", "bicycle"}
        vehicle_breakdown: Dict[str, int] = {k: 0 for k in vehicle_classes}
        pedestrian_count = 0

        for d in detections:
            if d.class_name in vehicle_breakdown:
                vehicle_breakdown[d.class_name] += 1
            elif d.class_name == "pedestrian":
                pedestrian_count += 1

        total_vehicles = sum(vehicle_breakdown.values())

        # Density-based congestion assessment
        if total_vehicles >= 10:
            congestion_level = "HEAVY"
            collision_risk_score = 0.75
        elif total_vehicles >= 5:
            congestion_level = "MODERATE"
            collision_risk_score = 0.45
        else:
            congestion_level = "LOW"
            collision_risk_score = 0.20

        if pedestrian_count > 0:
            collision_risk_score = min(1.0, collision_risk_score + (pedestrian_count * 0.08))

        recommendations = []
        if total_vehicles >= 8:
            recommendations.append("High vehicle volume observed in frame. Monitor arterial queuing.")
        if pedestrian_count > 0:
            recommendations.append(f"{pedestrian_count} vulnerable road user(s) detected. Ensure pedestrian phase clearance.")
        if not recommendations:
            recommendations.append("Nominal road traffic density observed. Standard signal split recommended.")

        processing_time_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return VisionAnalysisResult(
            analysis_id=str(uuid.uuid4()),
            session_id=session_id,
            video_hash=video_hash,
            media_name=filename,
            media_type="image",
            width=width,
            height=height,
            file_size_bytes=len(file_bytes),
            processing_time_ms=processing_time_ms,
            adapter_name=self.adapter_name,
            is_simulated=False,
            status="COMPLETED",
            duration_seconds=None,
            frame_count_sampled=1,
            frame_timestamp_sec=timestamp_sec,
            representative_frame_base64=representative_b64,
            frame_timeline=None,
            total_vehicles=total_vehicles,
            vehicle_breakdown=vehicle_breakdown,
            total_pedestrians=pedestrian_count,
            unique_vehicles_tracked=unique_vehicles_tracked if unique_vehicles_tracked is not None else total_vehicles,
            total_frame_detections=total_vehicles,
            estimated_congestion_level=congestion_level,
            collision_risk_score=round(collision_risk_score, 2),
            lane_blockage_detected=False,
            detected_hazards=["Vulnerable road user activity present"] if pedestrian_count > 0 else [],
            detected_objects=detections,
            events=event_items if event_items else None,
            recommendations=recommendations,
            timestamp=datetime.now(timezone.utc),
            fps_processed=round(1000.0 / processing_time_ms, 2) if processing_time_ms > 0 else 0.0,
            inference_config={
                "model": "YOLOv8n ONNX",
                "confidence_threshold": confidence_threshold,
                "execution_provider": "CPUExecutionProvider",
                "enable_tracking": enable_tracking,
            },
            data_source="GENUINE MODEL INFERENCE (YOLOv8n ONNX / MS COCO)",
            provenance_notice=(
                "GENUINE MODEL INFERENCE: Analyzed using local pretrained YOLOv8n ONNX model. "
                "Bounding boxes and counts represent actual detections. Speeds, GPS coordinates, "
                "and accident states are not fabricated."
            ),
        )


    async def _analyze_video(
        self,
        file_bytes: bytes,
        filename: str,
        start_time: float,
        sample_fps: float = 1.0,
        confidence_threshold: float = 0.35,
        enable_tracking: bool = True,
        cordon_y: float = 0.60,
        time_bucket_seconds: float = 2.0,
        session_id: Optional[str] = None,
        video_hash: Optional[str] = None,
    ) -> VisionAnalysisResult:
        _, ext = os.path.splitext(filename.lower())
        if not ext:
            ext = ".mp4"

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as temp_video:
            temp_video_path = temp_video.name
            temp_video.write(file_bytes)

        temp_frames_dir = tempfile.mkdtemp(prefix="transport_ai_frames_")

        try:
            duration_sec, width, height = self._probe_video_metadata(temp_video_path)
            if duration_sec > settings.MAX_VIDEO_DURATION_SECONDS:
                raise ValueError(
                    f"Video duration ({duration_sec:.1f}s) exceeds maximum allowed limit of "
                    f"{settings.MAX_VIDEO_DURATION_SECONDS:.0f} seconds."
                )

            # Sample frames sequentially
            sampled_frames = self._sample_video_frames(
                video_path=temp_video_path,
                output_dir=temp_frames_dir,
                fps=sample_fps,
                max_frames=settings.MAX_SAMPLED_FRAMES,
            )

            # Initialize tracker
            tracker = IoUTracker(
                iou_threshold=0.25,
                max_lost=2,
                min_hits_for_unique=1,
                cordon_y=cordon_y,
            )

            frame_summaries: List[FrameDetectionSummary] = []
            all_frame_detections_count = 0
            peak_detections: List[DetectedObject] = []
            peak_frame_path = sampled_frames[0][0]
            max_detected_count = -1

            # Accumulate per-frame vehicle detections
            vehicle_classes = {"car", "bus", "truck", "motorcycle", "bicycle"}
            vehicle_breakdown_cumulative = {c: 0 for c in vehicle_classes}
            total_pedestrians_cumulative = 0

            # Execute sequential inference in exact timestamp order
            for idx, (frame_path, ts) in enumerate(sampled_frames):
                try:
                    frame_img = Image.open(frame_path).convert("RGB")
                except Exception as frame_err:
                    print(f"[Transport AI] Warning: Corrupted frame {frame_path} skipped: {frame_err}")
                    continue

                raw_dets = self._detect_on_pil_image(frame_img, confidence_threshold=confidence_threshold)
                all_frame_detections_count += len(raw_dets)

                # Convert to dict for tracker
                det_dicts = [
                    {
                        "id": d.id,
                        "class_name": d.class_name,
                        "confidence": d.confidence,
                        "box": d.box.model_dump(),
                    }
                    for d in raw_dets
                ]

                if enable_tracking:
                    tracked_det_dicts = tracker.update_frame(det_dicts, timestamp_sec=ts)
                else:
                    tracked_det_dicts = det_dicts

                # Reconstruct DetectedObject list with assigned track_id
                frame_dets: List[DetectedObject] = []
                for td in tracked_det_dicts:
                    frame_dets.append(
                        DetectedObject(
                            id=td["id"],
                            class_name=td["class_name"],
                            confidence=td["confidence"],
                            box=BoundingBox(**td["box"]),
                            track_id=td.get("track_id"),
                            hazard_flag=(td["class_name"] == "pedestrian"),
                        )
                    )

                v_count = sum(1 for d in frame_dets if d.class_name in vehicle_classes)
                p_count = sum(1 for d in frame_dets if d.class_name == "pedestrian")

                for d in frame_dets:
                    if d.class_name in vehicle_breakdown_cumulative:
                        vehicle_breakdown_cumulative[d.class_name] += 1
                    elif d.class_name == "pedestrian":
                        total_pedestrians_cumulative += 1

                frame_summaries.append(
                    FrameDetectionSummary(
                        frame_index=idx + 1,
                        timestamp_sec=ts,
                        vehicle_count=v_count,
                        pedestrian_count=p_count,
                        objects=frame_dets,
                    )
                )

                if (v_count + p_count) > max_detected_count:
                    max_detected_count = v_count + p_count
                    peak_detections = frame_dets
                    peak_frame_path = frame_path

            # Finalize tracker
            tracker.finalize()
            raw_tracking_summary = tracker.get_summary()

            # Structured TrackingSummary
            track_items: List[TrackedVehicleItem] = []
            for t in raw_tracking_summary["tracks"]:
                traj_pts = [
                    TrackTrajectoryPoint(x=p["x"], y=p["y"], timestamp_sec=p["timestamp_sec"])
                    for p in t["trajectory"]
                ]
                track_items.append(
                    TrackedVehicleItem(
                        track_id=t["track_id"],
                        class_name=t["class_name"],
                        first_seen_sec=t["first_seen_sec"],
                        last_seen_sec=t["last_seen_sec"],
                        duration_sec=t["duration_sec"],
                        detection_count=t["detection_count"],
                        trajectory=traj_pts,
                        last_box=BoundingBox(**t["last_box"]) if t.get("last_box") else None,
                    )
                )

            event_items: List[TrafficEvent] = []
            for ev in raw_tracking_summary["events"]:
                event_items.append(
                    TrafficEvent(
                        event_id=ev["event_id"],
                        track_id=ev["track_id"],
                        class_name=ev["class_name"],
                        event_type=ev["event_type"],
                        timestamp_sec=ev["timestamp_sec"],
                        direction=ev.get("direction"),
                        confidence=ev.get("confidence"),
                        cordon_y=ev.get("cordon_y"),
                    )
                )

            tracking_summary = TrackingSummary(
                unique_vehicles_tracked=raw_tracking_summary["unique_vehicles_tracked"],
                unique_pedestrians_tracked=raw_tracking_summary["unique_pedestrians_tracked"],
                vehicle_breakdown=raw_tracking_summary["vehicle_breakdown"],
                total_tracks_assigned=raw_tracking_summary["total_tracks_assigned"],
                tracks=track_items,
                events=event_items,
                tracking_algorithm=raw_tracking_summary["tracking_algorithm"],
                limitations_notice=raw_tracking_summary["limitations_notice"],
            )

            # Construct aggregated time buckets
            time_buckets: List[TimeBucketSummary] = []
            if duration_sec > 0:
                bucket_count = max(1, int(np.ceil(duration_sec / time_bucket_seconds)))
                for b_idx in range(bucket_count):
                    b_start = b_idx * time_bucket_seconds
                    b_end = min(duration_sec, (b_idx + 1) * time_bucket_seconds)

                    # Frames inside this bucket
                    bucket_frames = [
                        f for f in frame_summaries
                        if b_start <= f.timestamp_sec < b_end or (b_idx == bucket_count - 1 and f.timestamp_sec <= b_end)
                    ]

                    b_dets = sum(len(f.objects) for f in bucket_frames)
                    b_pedestrians = sum(f.pedestrian_count for f in bucket_frames)
                    b_class_breakdown = {c: 0 for c in vehicle_classes}

                    # Unique track IDs observed in this bucket
                    b_track_ids = set()
                    for f in bucket_frames:
                        for obj in f.objects:
                            if obj.class_name in b_class_breakdown:
                                b_class_breakdown[obj.class_name] += 1
                            if obj.track_id is not None and obj.class_name in vehicle_classes:
                                b_track_ids.add(obj.track_id)

                    b_unique_vehicles = len(b_track_ids) if b_track_ids else sum(b_class_breakdown.values())

                    b_congestion = "LOW"
                    if b_unique_vehicles >= 8:
                        b_congestion = "HEAVY"
                    elif b_unique_vehicles >= 4:
                        b_congestion = "MODERATE"

                    time_buckets.append(
                        TimeBucketSummary(
                            bucket_index=b_idx + 1,
                            start_sec=round(b_start, 2),
                            end_sec=round(b_end, 2),
                            total_detections=b_dets,
                            unique_vehicles=b_unique_vehicles,
                            class_breakdown=b_class_breakdown,
                            pedestrian_count=b_pedestrians,
                            average_congestion=b_congestion,
                        )
                    )

            # Draw representative preview with tracks and cordon line
            rep_img = Image.open(peak_frame_path).convert("RGB")
            representative_b64 = self._draw_annotations(
                rep_img,
                peak_detections,
                cordon_y=cordon_y,
                tracks=[t.to_dict() for t in tracker.closed_tracks],
            )

            # Unique vehicles vs per-frame counts
            unique_vehicles_tracked = tracking_summary.unique_vehicles_tracked
            if unique_vehicles_tracked == 0 and any(d.class_name in vehicle_classes for d in peak_detections):
                # Fallback to peak vehicle count if tracking could not bridge frames
                unique_vehicles_tracked = sum(1 for d in peak_detections if d.class_name in vehicle_classes)

            avg_vehicles_per_frame = int(round(sum(v for v in vehicle_breakdown_cumulative.values()) / max(1, len(sampled_frames))))
            
            # Congestion level based on unique volume
            if unique_vehicles_tracked >= 10:
                congestion_level = "HEAVY"
                collision_risk_score = 0.78
            elif unique_vehicles_tracked >= 5:
                congestion_level = "MODERATE"
                collision_risk_score = 0.48
            else:
                congestion_level = "LOW"
                collision_risk_score = 0.22

            if tracking_summary.unique_pedestrians_tracked > 0:
                collision_risk_score = min(1.0, collision_risk_score + (tracking_summary.unique_pedestrians_tracked * 0.1))

            recommendations = []
            if unique_vehicles_tracked >= 7:
                recommendations.append("Elevated corridor volume observed over video duration. Review downstream queue length.")
            if tracking_summary.unique_pedestrians_tracked > 0:
                recommendations.append(
                    f"{tracking_summary.unique_pedestrians_tracked} pedestrian(s) observed interacting with roadway. Ensure adequate crossing visibility."
                )
            if event_items:
                recommendations.append(f"{len(event_items)} vehicle cordon crossings recorded. Traffic flow moving in active direction.")
            if not recommendations:
                recommendations.append("Free-flow traffic conditions observed across all sampled frames.")

            total_elapsed_sec = time.perf_counter() - start_time
            processing_time_ms = round(total_elapsed_sec * 1000, 2)
            fps_processed = round(len(sampled_frames) / total_elapsed_sec, 2) if total_elapsed_sec > 0 else 0.0

            inference_config = {
                "model": "YOLOv8n ONNX",
                "sample_fps": sample_fps,
                "confidence_threshold": confidence_threshold,
                "tracking_algorithm": "IoUTracker",
                "cordon_y": cordon_y,
                "time_bucket_seconds": time_bucket_seconds,
                "execution_provider": "CPUExecutionProvider",
            }

            return VisionAnalysisResult(
                analysis_id=str(uuid.uuid4()),
                session_id=session_id,
                video_hash=video_hash,
                media_name=filename,
                media_type="video",
                width=width,
                height=height,
                file_size_bytes=len(file_bytes),
                processing_time_ms=processing_time_ms,
                adapter_name=self.adapter_name,
                is_simulated=False,
                status="COMPLETED",
                duration_seconds=round(duration_sec, 2),
                frame_count_sampled=len(sampled_frames),
                representative_frame_base64=representative_b64,
                frame_timeline=frame_summaries,
                total_vehicles=avg_vehicles_per_frame,
                vehicle_breakdown=tracking_summary.vehicle_breakdown or vehicle_breakdown_cumulative,
                total_pedestrians=tracking_summary.unique_pedestrians_tracked,
                unique_vehicles_tracked=unique_vehicles_tracked,
                total_frame_detections=all_frame_detections_count,
                estimated_congestion_level=congestion_level,
                collision_risk_score=round(collision_risk_score, 2),
                lane_blockage_detected=False,
                detected_hazards=["Pedestrian crossing interaction detected"] if tracking_summary.unique_pedestrians_tracked > 0 else [],
                detected_objects=peak_detections,
                recommendations=recommendations,
                tracking_summary=tracking_summary,
                time_buckets=time_buckets,
                events=event_items,
                evaluation_summary=None,
                fps_processed=fps_processed,
                inference_config=inference_config,
                timestamp=datetime.now(timezone.utc),
                data_source="GENUINE MODEL INFERENCE (YOLOv8n ONNX / MS COCO)",
                provenance_notice=(
                    "GENUINE MODEL INFERENCE: Analyzed using local pretrained YOLOv8n ONNX model across sequentially ordered frames. "
                    "Detected bounding boxes and counts reflect actual model outputs. Speeds, GPS coordinates, "
                    "and accident states are not fabricated. Unique vehicles are estimated via IoU tracking across consecutive frames."
                ),
            )

        finally:
            if os.path.exists(temp_video_path):
                try:
                    os.unlink(temp_video_path)
                except OSError:
                    pass
            if os.path.exists(temp_frames_dir):
                shutil.rmtree(temp_frames_dir, ignore_errors=True)

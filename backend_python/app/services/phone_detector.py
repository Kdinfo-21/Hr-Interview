"""YOLOv8 live proctoring detector.

Runs on real camera frames received from the React interview client.
The model is loaded once per backend process and reused for every frame.
"""

from pathlib import Path
from threading import Lock
from typing import Any

from ultralytics import YOLO

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "yolov8n.pt"
PHONE_CLASS = "cell phone"
PERSON_CLASS = "person"
DEFAULT_CONFIDENCE = 0.25
PERSON_CONFIDENCE = 0.35

_model = None
_model_lock = Lock()


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                if MODEL_PATH.exists():
                    _model = YOLO(str(MODEL_PATH))
                else:
                    # Ultralytics downloads the standard yolov8n.pt on first use.
                    # After download, copy it to backend_python/models/ for
                    # deterministic startup on the next run.
                    _model = YOLO("yolov8n.pt")
    return _model


def detect_frame(frame) -> dict[str, Any]:
    """Detect phones, people and supported prohibited objects in one frame."""
    model = _get_model()
    results = model.predict(source=frame, conf=DEFAULT_CONFIDENCE, iou=0.45, max_det=30, verbose=False)

    detections: list[dict[str, Any]] = []
    for result in results:
        names = result.names or {}
        for box in result.boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            label = str(names.get(class_id, class_id))
            xyxy = [round(float(v), 2) for v in box.xyxy[0].tolist()]
            detections.append({
                "label": label,
                "confidence": round(confidence, 4),
                "bbox": xyxy,
            })

    phones = [d for d in detections if d["label"] == PHONE_CLASS]
    people = [d for d in detections if d["label"] == PERSON_CLASS and d["confidence"] >= PERSON_CONFIDENCE]

    # A person at the extreme edge or occupying only a tiny part of the frame
    # is treated as not properly in-frame. This is a real YOLO bounding-box
    # heuristic, not a synthetic event.
    candidate_in_frame = len(people) > 0
    if len(people) == 1:
        x1, y1, x2, y2 = people[0]["bbox"]
        # bbox coordinates are pixels; recover frame dimensions from the input.
        h, w = frame.shape[:2]
        cx = ((x1 + x2) / 2) / max(w, 1)
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1) / max(w * h, 1)
        if cx < 0.08 or cx > 0.92 or area < 0.025:
            candidate_in_frame = False

    return {
        "model": "YOLOv8n",
        "phone_detected": bool(phones),
        "phone_confidence": max((d["confidence"] for d in phones), default=0.0),
        "person_count": len(people),
        "human_detected": len(people) > 0,
        "candidate_in_frame": candidate_in_frame,
        "detections": detections,
    }


def detect_phone(frame):
    """Backward-compatible helper used by simple image tests."""
    result = detect_frame(frame)
    return result["phone_detected"], frame

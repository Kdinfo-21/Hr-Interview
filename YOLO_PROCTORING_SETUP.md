# YOLO Proctoring Setup

This version removes the browser COCO-SSD/TensorFlow object detector and the face-api.js sampling hook from the live interview path.

## Backend
Install:
`pip install -r requirements.txt`

Put your working `yolov8n.pt` at:
`backend_python/models/yolov8n.pt`

Run:
`python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

If the model is missing, Ultralytics may download the standard `yolov8n.pt` on first detection.

## Frontend
Make sure `frontend/.env` contains:
`VITE_API_BASE_URL=http://localhost:8000/api`

Then:
`npm install`
`npm run dev`

During an active interview, the browser captures a real JPEG from the existing camera element every ~1.5 seconds and sends it to FastAPI. FastAPI runs YOLOv8 and returns phone/person/object detections. Real phone detections are sent through the existing `MOBILE_PHONE_DETECTED` proctoring event API, so the existing database/report path remains in use.

Browser-only signals such as TAB_SWITCH/WINDOW_BLUR/FULLSCREEN_EXIT remain in `useProctoring`; YOLO cannot detect those.

The included project does not contain `yolov8n.pt` because model weights are binary and were not present in the uploaded ZIP. Copy your tested model into `backend_python/models/`.

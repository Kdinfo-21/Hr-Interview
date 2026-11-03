# Proctoring fix — live phone/person detection

Changes made to the existing project:

- Strengthened the real COCO-SSD camera-frame pipeline by running detection on the live video frame plus overlapping zoomed crops. This is still based only on actual camera pixels; no demo/fake detections were added.
- Lowered the phone trigger to a model confidence of 0.15 so small/angled phones can be reported when COCO-SSD produces a genuine low-confidence `cell phone` result.
- Explicitly prefers the TensorFlow.js WebGL backend when available, with CPU fallback.
- Kept the existing cooldown/deduplication and backend event flow.
- Added immediate frontend warning text when the real detector reports a phone, prohibited object, or multiple people, before the backend response returns.
- Added `NO_HUMAN_DETECTED` as a real audit event and soft warning.
- Kept `CANDIDATE_OUT_OF_FRAME` as the face/presence warning and preserved existing multiple-face, gaze, camera, browser and report behavior.
- Object detection remains armed during the live interview/narration and starts automatically after the model finishes loading if the interview has already started.

Validation:
- Backend Python source passes `python -m compileall`.
- A full frontend build could not be completed in this environment because the package registry install (`npm ci`) timed out; the supplied source/package-lock remain intact and no `node_modules` directory is included in the archive.

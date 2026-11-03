import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export type ProctoringEventType =
  | "FULLSCREEN_EXIT"
  | "TAB_SWITCH"
  | "WINDOW_BLUR"
  | "RESUME_CLICKED"
  | "MULTIPLE_FACES"
  | "PROHIBITED_OBJECT"
  | "SUSPICIOUS_GAZE"
  | "NAVIGATION_VIOLATION"
  | "MOBILE_PHONE_DETECTED"
  | "CANDIDATE_OUT_OF_FRAME"
  | "NO_HUMAN_DETECTED"
  | "CAMERA_UNAVAILABLE"
  | "HIGH_BACKGROUND_NOISE";

// Soft/ambient warnings get a non-blocking banner and never count toward the
// termination cap (see backend routes/proctoring.py SOFT_EVENTS, which is the
// source of truth — this mirrors it purely for local UI branching).
const SOFT_EVENT_TYPES = new Set<ProctoringEventType>([
  "CANDIDATE_OUT_OF_FRAME",
  "NO_HUMAN_DETECTED",
  "HIGH_BACKGROUND_NOISE",
  "CAMERA_UNAVAILABLE",
]);
export function isSoftProctoringEvent(type: ProctoringEventType): boolean {
  return SOFT_EVENT_TYPES.has(type);
}

interface UseProctoringOptions {
  token: string;
  active: boolean; // only fire/log violations while the interview is actively in progress
  onViolation?: (type: ProctoringEventType, warningCount: number, maxWarnings: number) => void;
  /** Called once the server reports the 4th violation — the interview is now TERMINATED server-side. */
  onTerminated?: (reason: string) => void;
  /** Called for soft/ambient warnings (out-of-frame, background noise) — shows a
   * non-blocking banner instead of the blocking violation modal. Auto-clears when
   * the condition resolves (see the frame-presence/noise-level debounce logic below). */
  onSoftWarning?: (type: ProctoringEventType, message: string) => void;
  /** Called when a soft/ambient warning condition resolves (candidate back in frame, noise subsided). */
  onSoftWarningCleared?: (type: ProctoringEventType) => void;
}

// How long a "looking away" gaze reading must persist before it's treated as
// a genuine violation, so brief natural glances don't get flagged.
const SUSTAINED_GAZE_MS = 4000;
// How long the candidate must be fully out of frame (faceCount === 0) before
// it's treated as a genuine "please be in the frame" warning.
const OUT_OF_FRAME_MS = 4000;
// How long background noise must stay above threshold before it's flagged.
const SUSTAINED_NOISE_MS = 3000;
// Smoothed RMS threshold. The detector samples frequently and smooths the
// recent levels, so this can be lower than the old 0.35 threshold while still
// ignoring short spikes. Exact microphone levels vary by device.
const BACKGROUND_NOISE_THRESHOLD = 0.06;
// Minimum gap between two logged CAMERA_UNAVAILABLE events for the same
// continuous outage, so a still-blocked camera doesn't re-log every tick.
const CAMERA_COOLDOWN_MS = 8000;
// Minimum gap between two logged MOBILE_PHONE_DETECTED events, so a phone
// held up continuously across several detection ticks logs once per window
// instead of once per tick (the backend applies its own dedupe too, as a
// second layer — see ROW_DEDUPE_EVENTS in routes/proctoring.py).
const MOBILE_COOLDOWN_MS = 6000;
// Keyboard shortcuts that would open a new tab/window — logged as a
// navigation violation. Browsers won't let JS truly block these, so this is
// a best-effort deterrent + audit signal, backed by the server-side warning cap.
const NEW_TAB_SHORTCUTS = new Set(["t", "n"]);

/**
 * Attaches fullscreenchange / visibilitychange / blur / new-tab-shortcut
 * listeners and logs a proctoring_events row (via the backend) whenever one
 * fires while the interview is active. Also exposes reportGaze/reportFaceCount/
 * reportProhibitedObject for the face-api and object-detection hooks to feed
 * their own violation signals through the same enforcement pipeline.
 *
 * All warning-count math and the "4th violation terminates the interview"
 * rule are enforced server-side (see backend routes/proctoring.ts) — this
 * hook just reflects whatever the server reports back, so a tampered client
 * can log fewer violations but can never talk its way past the real cap.
 */
export function useProctoring({ token, active, onViolation, onTerminated, onSoftWarning, onSoftWarningCleared }: UseProctoringOptions) {
  const [warningCount, setWarningCount] = useState(0);
  const [maxWarnings, setMaxWarnings] = useState(3);
  const activeRef = useRef(active);
  const gazeAwaySinceRef = useRef<number | null>(null);
  const lastGazeEventRef = useRef<number>(0);
  const outOfFrameSinceRef = useRef<number | null>(null);
  const lastOutOfFrameEventRef = useRef<number>(0);
  const wasOutOfFrameRef = useRef<boolean>(false);
  const noHumanSinceRef = useRef<number | null>(null);
  const lastNoHumanEventRef = useRef<number>(0);
  const noiseAboveSinceRef = useRef<number | null>(null);
  const lastNoiseEventRef = useRef<number>(0);
  const lastMobileEventRef = useRef<number>(0);
  const cameraUnavailableRef = useRef<boolean>(false);
  const lastCameraEventRef = useRef<number>(0);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      gazeAwaySinceRef.current = null;
      outOfFrameSinceRef.current = null;
      noHumanSinceRef.current = null;
      noiseAboveSinceRef.current = null;
    }
  }, [active]);

  const logAndNotify = useCallback(
    (type: ProctoringEventType, notes?: string, extra?: { confidence?: number; metadata?: Record<string, unknown> }) => {
      if (!activeRef.current) return;
      api
        .logProctoringEvent(token, { event_type: type, notes, confidence: extra?.confidence, metadata: extra?.metadata })
        .then((result) => {
          setWarningCount(result.warning_count);
          setMaxWarnings(result.max_warnings);
          if (result.terminated) {
            onTerminated?.(
              "This interview was ended automatically after repeated proctoring violations."
            );
          } else if (result.is_soft) {
            // Soft/ambient warning: non-blocking banner, doesn't count toward termination.
            onSoftWarning?.(type, notes || "");
          } else {
            onViolation?.(type, result.warning_count, result.max_warnings);
          }
        })
        .catch((err) => {
          console.error("Failed to log proctoring event:", err);
          // Fail safe: still surface the violation locally even if logging failed,
          // so the candidate isn't silently let through.
          if (isSoftProctoringEvent(type)) {
            onSoftWarning?.(type, notes || "");
          } else {
            onViolation?.(type, warningCount + 1, maxWarnings);
          }
        });
    },
    [token, onViolation, onTerminated, onSoftWarning, warningCount, maxWarnings]
  );

  // ---- Browser-level signals: fullscreen exit / tab switch / window blur / new-tab shortcuts ----
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        logAndNotify("FULLSCREEN_EXIT", "Candidate exited fullscreen mode.");
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        logAndNotify("TAB_SWITCH", "Candidate switched away from the interview tab.");
      }
    };

    const onWindowBlur = () => {
      logAndNotify("WINDOW_BLUR", "Interview window lost focus.");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key?.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key && NEW_TAB_SHORTCUTS.has(key)) {
        logAndNotify("NAVIGATION_VIOLATION", `Candidate attempted a new-tab/window shortcut (Ctrl/Cmd+${key.toUpperCase()}).`);
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /** Feed each face-api sampling tick's face count in here — flags MULTIPLE_FACES,
   * and (once sustained) OUT_OF_FRAME when the candidate isn't visible at all. */
  const reportFaceCount = useCallback(
    (count: number) => {
      if (count > 1) {
        logAndNotify("MULTIPLE_FACES", `${count} faces detected in frame.`, { metadata: { face_count: count } });
      }
      reportFramePresence(count > 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logAndNotify]
  );

  /** Feed a "is the candidate currently visible" boolean in here (from face
   * count) — flags CANDIDATE_OUT_OF_FRAME once faceCount stays at 0 for
   * OUT_OF_FRAME_MS, and clears the soft banner (+ notifies the backend the
   * candidate is visible again, via the status-only CANDIDATE_IN_FRAME
   * signal) once a face is visible again. */
  const reportFramePresence = useCallback(
    (present: boolean) => {
      const now = Date.now();
      if (present) {
        if (outOfFrameSinceRef.current !== null) {
          outOfFrameSinceRef.current = null;
          onSoftWarningCleared?.("CANDIDATE_OUT_OF_FRAME");
        }
        if (wasOutOfFrameRef.current) {
          wasOutOfFrameRef.current = false;
          // Status-only ping: updates the "Human Detected" state on the
          // interview row without writing another row to the audit log.
          api.logProctoringEvent(token, { event_type: "CANDIDATE_IN_FRAME" }).catch(() => {});
        }
        return;
      }
      if (outOfFrameSinceRef.current === null) {
        outOfFrameSinceRef.current = now;
        return;
      }
      const sustainedFor = now - outOfFrameSinceRef.current;
      // Debounced: fire once per sustained excursion, then keep the banner up
      // (via onSoftWarning being called again on a slower cadence) rather than
      // spamming a log entry every tick while the candidate stays out of frame.
      if (sustainedFor >= OUT_OF_FRAME_MS && now - lastOutOfFrameEventRef.current > OUT_OF_FRAME_MS) {
        lastOutOfFrameEventRef.current = now;
        wasOutOfFrameRef.current = true;
        logAndNotify(
          "CANDIDATE_OUT_OF_FRAME",
          `Candidate out of frame for over ${Math.round(sustainedFor / 1000)}s.`,
          { metadata: { sustained_ms: sustainedFor } }
        );
      }
    },
    [logAndNotify, onSoftWarningCleared, token]
  );

  /** Feed an RMS/volume level (0-1) in here on a ~1-2s cadence — flags
   * HIGH_BACKGROUND_NOISE once the level stays above `threshold` for
   * SUSTAINED_NOISE_MS, and clears the soft banner once the level drops back down. */
  const reportNoiseLevel = useCallback(
    (level: number, threshold = BACKGROUND_NOISE_THRESHOLD) => {
      const now = Date.now();
      if (level < threshold) {
        if (noiseAboveSinceRef.current !== null) {
          noiseAboveSinceRef.current = null;
          onSoftWarningCleared?.("HIGH_BACKGROUND_NOISE");
        }
        return;
      }
      if (noiseAboveSinceRef.current === null) {
        noiseAboveSinceRef.current = now;
        return;
      }
      const sustainedFor = now - noiseAboveSinceRef.current;
      if (sustainedFor >= SUSTAINED_NOISE_MS && now - lastNoiseEventRef.current > SUSTAINED_NOISE_MS) {
        lastNoiseEventRef.current = now;
        logAndNotify(
          "HIGH_BACKGROUND_NOISE",
          "High background noise detected. Please move to a quieter environment.",
          { confidence: level, metadata: { level, sustained_ms: sustainedFor } }
        );
      }
    },
    [logAndNotify, onSoftWarningCleared]
  );

  /** Feed a webcam availability boolean in here — flags CAMERA_UNAVAILABLE
   * once the camera is lost/blocked/can't capture, and clears the soft
   * banner once it's available again. Debounced via lastCameraEventRef so a
   * flaky stream doesn't spam the audit log while it stays down. */
  const reportCameraStatus = useCallback(
    (available: boolean) => {
      if (available) {
        if (cameraUnavailableRef.current) {
          cameraUnavailableRef.current = false;
          onSoftWarningCleared?.("CAMERA_UNAVAILABLE");
        }
        return;
      }
      const now = Date.now();
      if (cameraUnavailableRef.current && now - lastCameraEventRef.current < CAMERA_COOLDOWN_MS) return;
      cameraUnavailableRef.current = true;
      lastCameraEventRef.current = now;
      logAndNotify("CAMERA_UNAVAILABLE", "Camera is unavailable, blocked, or cannot capture the candidate.");
    },
    [logAndNotify, onSoftWarningCleared]
  );


  /** Object detector fallback: distinguish a frame with no detected person
   * from a face that is simply poorly positioned. */
  const reportHumanPresence = useCallback(
    (present: boolean, personCount: number) => {
      const now = Date.now();
      if (present) {
        noHumanSinceRef.current = null;
        return;
      }
      if (noHumanSinceRef.current === null) {
        noHumanSinceRef.current = now;
        return;
      }
      const sustainedFor = now - noHumanSinceRef.current;
      if (sustainedFor >= 3000 && now - lastNoHumanEventRef.current >= 5000) {
        lastNoHumanEventRef.current = now;
        logAndNotify(
          "NO_HUMAN_DETECTED",
          "Candidate not detected. Please remain visible in the camera.",
          { metadata: { person_count: personCount, sustained_ms: sustainedFor, source: "object_detection" } }
        );
      }
    },
    [logAndNotify]
  );
  /** Feed each face-api sampling tick's gaze direction in here — flags SUSPICIOUS_GAZE once sustained. */
  const reportGaze = useCallback(
    (gaze: "center" | "left" | "right" | "up" | "down" | "unknown") => {
      const now = Date.now();
      if (gaze === "center" || gaze === "unknown") {
        gazeAwaySinceRef.current = null;
        return;
      }
      if (gazeAwaySinceRef.current === null) {
        gazeAwaySinceRef.current = now;
        return;
      }
      const sustainedFor = now - gazeAwaySinceRef.current;
      // Only fire once per sustained excursion (debounced), not once per second while it persists.
      if (sustainedFor >= SUSTAINED_GAZE_MS && now - lastGazeEventRef.current > SUSTAINED_GAZE_MS) {
        lastGazeEventRef.current = now;
        logAndNotify("SUSPICIOUS_GAZE", `Candidate looked ${gaze} for over ${Math.round(sustainedFor / 1000)}s.`, {
          metadata: { direction: gaze, sustained_ms: sustainedFor },
        });
      }
    },
    [logAndNotify]
  );

  /** Feed a YOLO "person" class count in here (from object detection) — a
   * secondary extra-person signal folded into the same MULTIPLE_FACES event
   * type as face-api's detection, for when a second person is visible but
   * not clearly face-detected (e.g. facing away). Does not touch out-of-frame
   * tracking, unlike reportFaceCount. */
  const reportExtraPerson = useCallback(
    (count: number) => {
      if (count > 1) {
        logAndNotify("MULTIPLE_FACES", `${count} people detected via object detection.`, {
          metadata: { person_count: count, source: "object_detection" },
        });
      }
    },
    [logAndNotify]
  );

  /** Feed a YOLO detection of a non-phone prohibited item (book, laptop,
   * tv, remote, tablet) in here — flags PROHIBITED_OBJECT. */
  const reportProhibitedObject = useCallback(
    (label: string, confidence: number) => {
      logAndNotify("PROHIBITED_OBJECT", `Detected "${label}" in frame.`, {
        confidence,
        metadata: { object: label },
      });
    },
    [logAndNotify]
  );

  /** Feed a YOLO "cell phone" detection in here — flags
   * MOBILE_PHONE_DETECTED specifically (kept distinct from the generic
   * PROHIBITED_OBJECT bucket, per policy: a phone is the strongest signal).
   * Debounced client-side via MOBILE_COOLDOWN_MS so a phone held up across
   * several detection ticks doesn't create a new audit-log row every tick. */
  const reportMobileDetected = useCallback(
    (confidence: number) => {
      const now = Date.now();
      if (now - lastMobileEventRef.current < MOBILE_COOLDOWN_MS) return;
      lastMobileEventRef.current = now;
      logAndNotify("MOBILE_PHONE_DETECTED", "A mobile phone was detected in the camera view.", {
        confidence,
        metadata: { object: "cell phone" },
      });
    },
    [logAndNotify]
  );

  const logResumeClicked = useCallback(() => {
    return api.logProctoringEvent(token, { event_type: "RESUME_CLICKED" });
  }, [token]);

  return {
    warningCount,
    maxWarnings,
    reportFaceCount,
    reportFramePresence,
    reportGaze,
    reportProhibitedObject,
    reportMobileDetected,
    reportHumanPresence,
    reportExtraPerson,
    reportNoiseLevel,
    reportCameraStatus,
    logResumeClicked,
  };
}

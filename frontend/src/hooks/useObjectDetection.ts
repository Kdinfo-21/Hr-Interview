import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export const DEFAULT_PROHIBITED_OBJECTS = ["book", "laptop", "tv", "remote", "tablet"];

interface DetectedObject {
  label: string;
  confidence: number;
}
interface UseObjectDetectionOptions {
  token?: string;
  prohibitedObjects?: string[];
  minConfidence?: number;
  intervalMs?: number;
  onProhibitedObject?: (obj: DetectedObject) => void;
  onMobileDetected?: (obj: DetectedObject) => void;
  onExtraPerson?: (count: number) => void;
  onHumanPresence?: (present: boolean, personCount: number) => void;
  personMinConfidence?: number;
}

export function useObjectDetection(
  videoRef: React.RefObject<HTMLVideoElement>,
  {
    prohibitedObjects = DEFAULT_PROHIBITED_OBJECTS,
    token = "",
    minConfidence = 0.25,
    intervalMs = 1500,
    onProhibitedObject,
    onMobileDetected,
    onExtraPerson,
    onHumanPresence,
    personMinConfidence = 0.35,
  }: UseObjectDetectionOptions = {}
) {
  const [modelLoaded, setModelLoaded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const wantsDetectingRef = useRef(false);
  const inferenceBusyRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastMobileRef = useRef(0);
  const lastObjectRef = useRef<Record<string, number>>({});

  const onDetectRef = useRef(onProhibitedObject);
  onDetectRef.current = onProhibitedObject;
  const onMobileRef = useRef(onMobileDetected);
  onMobileRef.current = onMobileDetected;
  const onExtraPersonRef = useRef(onExtraPerson);
  onExtraPersonRef.current = onExtraPerson;
  const onHumanPresenceRef = useRef(onHumanPresence);
  onHumanPresenceRef.current = onHumanPresence;

  const detectOnce = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    if (inferenceBusyRef.current) return;

    inferenceBusyRef.current = true;
    try {
      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;
      // Keep uploads small enough for a continuous live interview.
      const width = Math.min(video.videoWidth, 640);
      const height = Math.round(video.videoHeight * (width / video.videoWidth));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.72)
      );
      if (!blob) return;

      const result = await api.detectProctoringFrame(token, blob);
      if (!result.active) return;

      onHumanPresenceRef.current?.(result.candidate_in_frame, result.person_count);

      if (result.person_count > 1) {
        onExtraPersonRef.current?.(result.person_count);
      }

      if (result.phone_detected && result.phone_confidence >= 0.20) {
        const now = Date.now();
        if (now - lastMobileRef.current >= 5000) {
          lastMobileRef.current = now;
          onMobileRef.current?.({
            label: "cell phone",
            confidence: result.phone_confidence,
          });
        }
      }

      const now = Date.now();
      for (const detection of result.detections) {
        if (
          detection.label !== "cell phone" &&
          prohibitedObjects.includes(detection.label) &&
          detection.confidence >= minConfidence
        ) {
          const previous = lastObjectRef.current[detection.label] || 0;
          if (now - previous >= 8000) {
            lastObjectRef.current[detection.label] = now;
            onDetectRef.current?.({
              label: detection.label,
              confidence: detection.confidence,
            });
          }
        }
      }
    } catch (err) {
      console.error("YOLO live proctoring request failed:", err);
      setError("YOLO proctoring backend is unavailable.");
    } finally {
      inferenceBusyRef.current = false;
    }
  }, [videoRef, prohibitedObjects, minConfidence, token]);

  const startDetecting = useCallback(() => {
    wantsDetectingRef.current = true;
    if (intervalRef.current) return;

    detectOnce().catch((err) => console.warn("Initial YOLO detection failed:", err));
    intervalRef.current = window.setInterval(() => {
      detectOnce().catch((err) => console.warn("YOLO detection frame failed:", err));
    }, intervalMs);
  }, [detectOnce, intervalMs]);

  const stopDetecting = useCallback(() => {
    wantsDetectingRef.current = false;
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => stopDetecting(), [stopDetecting]);

  return { modelLoaded, error, startDetecting, stopDetecting };
}

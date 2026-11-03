import { forwardRef, useEffect, useState } from "react";
import { IconCamera } from "../ui/icons";

interface FaceAnalyzerProps {
  modelsLoaded: boolean;
  error: string | null;
  onStreamReady?: () => void;
  onCameraError?: (message: string) => void;
  onCameraAvailable?: () => void;
}

/**
 * Owns the candidate webcam stream. Face/object analysis is performed by the
 * parent hooks against the same video element; this component only manages
 * camera access and the small live-camera status badge.
 */
const FaceAnalyzer = forwardRef<HTMLVideoElement, FaceAnalyzerProps>(
  ({ modelsLoaded, error, onStreamReady, onCameraError, onCameraAvailable }, ref) => {
    const [cameraReady, setCameraReady] = useState(false);

    useEffect(() => {
      let stream: MediaStream | null = null;
      let cancelled = false;
      (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          const videoEl = (ref as React.RefObject<HTMLVideoElement>)?.current;
          if (videoEl) {
            videoEl.srcObject = stream;
            await videoEl.play();
            setCameraReady(true);
            onStreamReady?.();
            onCameraAvailable?.();
          }

          const [track] = stream.getVideoTracks();
          if (track) {
            track.addEventListener("ended", () => {
              setCameraReady(false);
              onCameraError?.("Camera track ended — the camera may be disconnected or blocked.");
            });
            track.addEventListener("mute", () => {
              setCameraReady(false);
              onCameraError?.("Camera feed is muted/blocked — no frames are being received.");
            });
            track.addEventListener("unmute", () => {
              setCameraReady(true);
              onCameraAvailable?.();
            });
          }
        } catch (err) {
          console.error("Webcam access failed:", err);
          setCameraReady(false);
          onCameraError?.("Could not access the camera. It may be unavailable, blocked, or in use by another app.");
        }
      })();
      return () => {
        cancelled = true;
        stream?.getTracks().forEach((t) => t.stop());
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const cameraUnavailable = !cameraReady;
    const statusText = cameraUnavailable
      ? "Unavailable"
      : error
        ? "Camera active"
        : modelsLoaded
          ? "Monitoring"
          : "Monitoring";

    return (
      <div className="fixed bottom-5 right-5 z-10 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-card-hover ring-1 ring-black/40">
        <video ref={ref} muted playsInline className="h-28 w-36 object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              cameraUnavailable ? "bg-red-400" : "bg-emerald-400"
            }`}
          />
          <IconCamera width={11} height={11} className="text-white/70" />
          <span className="text-[10px] font-medium leading-none text-white/90">{statusText}</span>
        </div>
      </div>
    );
  }
);

FaceAnalyzer.displayName = "FaceAnalyzer";
export default FaceAnalyzer;

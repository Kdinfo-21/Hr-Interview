import { IconVolume, IconCamera } from "../ui/icons";
import { ProctoringEventType } from "../hooks/useProctoring";

interface ProctoringBannerProps {
  /** Soft-warning types currently active, keyed by event type, valued by a short message. */
  warnings: Partial<Record<ProctoringEventType, string>>;
}

const LABELS: Partial<Record<ProctoringEventType, { text: string; icon: (p: { width: number; height: number }) => JSX.Element }>> = {
  CANDIDATE_OUT_OF_FRAME: { text: "Please stay in front of the camera and keep your face visible.", icon: (p) => <IconCamera {...p} /> },
  NO_HUMAN_DETECTED: { text: "Candidate not detected. Please remain visible in the camera.", icon: (p) => <IconCamera {...p} /> },
  HIGH_BACKGROUND_NOISE: {
    text: "High background noise detected. Please move to a quieter environment.",
    icon: (p) => <IconVolume {...p} />,
  },
  CAMERA_UNAVAILABLE: {
    text: "Your camera appears to be unavailable or blocked — please check it's connected and not covered.",
    icon: (p) => <IconCamera {...p} />,
  },
};

/**
 * Non-blocking, persistent banner for ambient/soft proctoring warnings
 * (out-of-frame, background noise, camera unavailable) — unlike
 * ProctoringOverlay, this never pauses the interview or requires a click to
 * dismiss. It's visible only while the underlying condition persists and
 * auto-clears once resolved (see useProctoring's
 * reportFramePresence/reportNoiseLevel/reportCameraStatus debounce logic).
 * Hard violations (mobile phone / prohibited object, multiple faces, tab
 * switch, fullscreen exit) still use the blocking ProctoringOverlay instead.
 */
export default function ProctoringBanner({ warnings }: ProctoringBannerProps) {
  const active = (Object.keys(warnings) as ProctoringEventType[]).filter((k) => warnings[k]);
  if (active.length === 0) return null;

  return (
    <div className="fixed left-1/2 top-4 z-40 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      {active.map((type) => {
        const meta = LABELS[type];
        if (!meta) return null;
        return (
          <div
            key={type}
            className="animate-fadeIn flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm font-medium text-amber-800 shadow-lg backdrop-blur-sm"
          >
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-600">
              {meta.icon({ width: 13, height: 13 })}
            </span>
            {meta.text}
          </div>
        );
      })}
    </div>
  );
}

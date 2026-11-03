import { IconAlertTriangle, IconShield } from "../ui/icons";

interface ProctoringOverlayProps {
  visible: boolean;
  violationType: string | null;
  warningCount: number;
  maxWarnings: number;
  terminated: boolean;
  onResume: () => void;
}

const MESSAGES: Record<string, string> = {
  FULLSCREEN_EXIT: "You exited fullscreen mode.",
  TAB_SWITCH: "You switched away from this tab.",
  WINDOW_BLUR: "This window lost focus.",
  MULTIPLE_FACES: "More than one face was detected in your camera.",
  PROHIBITED_OBJECT: "A prohibited object was detected in your camera view.",
  MOBILE_PHONE_DETECTED: "A mobile phone was detected in your camera view.",
  SUSPICIOUS_GAZE: "You looked away from the screen for a sustained period.",
  NAVIGATION_VIOLATION: "A new-tab/window shortcut was detected.",
};

/**
 * Full-screen blocking overlay shown whenever a proctoring violation pauses
 * the interview. Progression is only possible via an explicit user click
 * (which re-triggers fullscreen) — unless the interview has been
 * auto-terminated server-side after the 4th violation, in which case there
 * is no way to resume and the session is over.
 */
export default function ProctoringOverlay({
  visible,
  violationType,
  warningCount,
  maxWarnings,
  terminated,
  onResume,
}: ProctoringOverlayProps) {
  if (!visible) return null;

  if (terminated) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 backdrop-blur-sm">
        <div className="w-full max-w-md animate-popIn rounded-2xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
            <IconShield width={26} height={26} />
          </div>
          <h2 className="mb-2 font-display text-xl font-semibold tracking-tight text-ink-900">
            Interview Terminated
          </h2>
          <p className="mb-1 text-ink-600">
            This interview was ended automatically after repeated proctoring violations.
          </p>
          <p className="mb-2 text-sm text-ink-500">
            All events have been recorded and sent to the recruiter for review. This session cannot be resumed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/70 backdrop-blur-sm">
      <div className="w-full max-w-md animate-popIn rounded-2xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <IconAlertTriangle width={26} height={26} />
        </div>
        <h2 className="mb-2 font-display text-xl font-semibold tracking-tight text-ink-900">Interview Paused</h2>
        <p className="mb-1 text-ink-600">
          {violationType ? MESSAGES[violationType] || "A proctoring rule was triggered." : ""}
        </p>
        <p className="mb-4 text-sm text-ink-500">
          This event has been recorded. Click below to return to fullscreen and continue your interview.
        </p>
        <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
          Warning {Math.min(warningCount, maxWarnings + 1)} of {maxWarnings}
          {warningCount >= maxWarnings ? " — one more will end the interview" : ""}
        </div>
        <button
          onClick={onResume}
          className="w-full rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-4 py-3.5 font-semibold text-white shadow-brand transition-colors duration-150 hover:from-brand-500 hover:to-brand-600"
        >
          Resume Interview
        </button>
      </div>
    </div>
  );
}

import { IconMic, IconVolume } from "../ui/icons";

interface QuestionCardProps {
  index: number;
  total: number;
  questionText: string;
  category: string;
  liveTranscript: string;
  isListening: boolean;
  isNarrating: boolean;
  onSubmit: () => void;
  submitting: boolean;
  /** Shown instead of the normal submit button when the answer looks unusable and a retry is still available. */
  retryPrompt?: boolean;
  retriesRemaining?: number;
  onRetry?: () => void;
  onSubmitAnyway?: () => void;
}

export default function QuestionCard({
  index,
  total,
  questionText,
  category,
  liveTranscript,
  isListening,
  isNarrating,
  onSubmit,
  submitting,
  retryPrompt,
  retriesRemaining = 0,
  onRetry,
  onSubmitAnyway,
}: QuestionCardProps) {
  return (
    <div className="animate-fadeIn rounded-2xl border border-ink-200 bg-white p-7 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-700">
          {category}
        </span>
        <span className="text-sm font-medium text-ink-400">
          Question {index} of {total}
        </span>
      </div>
      <h2 className="mb-5 font-display text-xl font-semibold leading-snug tracking-tight text-ink-900">{questionText}</h2>

      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-150 bg-ink-50 px-3 py-1.5 text-sm">
        {isNarrating ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
            </span>
            <IconVolume width={14} height={14} className="text-sky-600" />
            <span className="font-medium text-sky-700">AI is asking the question...</span>
          </>
        ) : isListening ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <IconMic width={14} height={14} className="text-red-600" />
            <span className="font-medium text-ink-700">Listening — you may answer now</span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-ink-300" />
            <span className="font-medium text-ink-500">Not listening</span>
          </>
        )}
      </div>

      <div className="mb-5 min-h-[90px] rounded-xl border border-ink-150 bg-ink-50 p-4 text-[15px] leading-relaxed text-ink-700">
        {isNarrating ? (
          <span className="text-ink-400">Listen to the question — you'll be able to answer once it finishes.</span>
        ) : (
          liveTranscript || <span className="text-ink-400">Your answer will appear here as you speak...</span>
        )}
      </div>

      {retryPrompt ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm font-semibold text-amber-800">
            We couldn't clearly capture your answer. Please check your microphone and background noise.
          </p>
          <p className="mb-3 text-xs text-amber-700">
            {retriesRemaining} retry{retriesRemaining === 1 ? "" : "ies"} remaining for this interview.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onRetry}
              className="flex-1 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-amber-700"
            >
              Retry Answer
            </button>
            <button
              onClick={onSubmitAnyway}
              className="flex-1 rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 transition-colors duration-150 hover:bg-amber-100"
            >
              Submit Anyway
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onSubmit}
          disabled={submitting || isNarrating}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-4 py-3.5 font-semibold text-white shadow-brand transition-colors duration-150 hover:from-brand-500 hover:to-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {isNarrating
            ? "Please wait..."
            : submitting
            ? "Submitting..."
            : index === total
            ? "Submit Final Answer"
            : "Submit & Next Question"}
        </button>
      )}
    </div>
  );
}

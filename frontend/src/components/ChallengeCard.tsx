import { useState } from "react";
import { ChallengeForCandidate } from "../types";
import { IconSparkle } from "../ui/icons";

interface ChallengeCardProps {
  challenge: ChallengeForCandidate;
  onSubmit: (payload: { language?: string; answer: string }) => void;
  submitting: boolean;
}

/**
 * Minimal, non-intrusive UI for the final practical challenge. Reuses the
 * same card chrome, spacing, and button styling as QuestionCard so it reads
 * as part of the existing interview flow rather than a bolted-on screen.
 */
export default function ChallengeCard({ challenge, onSubmit, submitting }: ChallengeCardProps) {
  const isCode = challenge.challenge_type === "CODE";
  const [language, setLanguage] = useState(challenge.language_options?.[0] || "");
  const [answer, setAnswer] = useState("");

  const canSubmit = answer.trim().length > 0 && !submitting;

  return (
    <div className="animate-fadeIn rounded-2xl border border-ink-200 bg-white p-7 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-700">
          {isCode ? "Final Challenge · Coding" : "Final Challenge · Riddle"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-400">
          <IconSparkle width={13} height={13} />
          {challenge.part_number ? `Challenge ${challenge.part_number} of 2` : "Last step"}
        </span>
      </div>

      <h2 className="mb-3 font-display text-xl font-semibold leading-snug tracking-tight text-ink-900">
        {challenge.title}
      </h2>
      <p className="mb-4 whitespace-pre-line text-[15px] leading-relaxed text-ink-700">{challenge.prompt_text}</p>

      {challenge.constraints_text && (
        <div className="mb-4 rounded-xl border border-ink-150 bg-ink-50 p-4 text-sm leading-relaxed text-ink-600">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Constraints</p>
          <p className="whitespace-pre-line">{challenge.constraints_text}</p>
        </div>
      )}

      {isCode && challenge.visible_examples?.length > 0 && (
        <div className="mb-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Example(s)</p>
          {challenge.visible_examples.map((ex, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-ink-150 bg-ink-50 p-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-xs font-semibold text-ink-400">Input</span>
                <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[13px] text-ink-700">{ex.input}</pre>
              </div>
              <div>
                <span className="text-xs font-semibold text-ink-400">Output</span>
                <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[13px] text-ink-700">{ex.output}</pre>
              </div>
            </div>
          ))}
        </div>
      )}

      {isCode && challenge.language_options?.length > 0 && (
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-400">
            Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm font-medium text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            {challenge.language_options.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-400">
          {isCode ? "Your solution" : "Your answer"}
        </label>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={isCode ? 12 : 5}
          placeholder={isCode ? "Write your solution in the language you selected above..." : "Explain your answer and reasoning..."}
          className={`w-full resize-y rounded-xl border border-ink-150 bg-ink-50 p-4 text-[15px] leading-relaxed text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 ${
            isCode ? "font-mono text-[13.5px]" : ""
          }`}
        />
      </div>

      <button
        onClick={() => onSubmit({ language: isCode ? language : undefined, answer })}
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-4 py-3.5 font-semibold text-white shadow-brand transition-colors duration-150 hover:from-brand-500 hover:to-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
        {submitting
          ? "Submitting..."
          : challenge.part_number === 1
          ? "Submit & Continue to Challenge 2"
          : "Submit Final Challenge"}
      </button>
    </div>
  );
}

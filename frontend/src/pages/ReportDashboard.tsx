import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import ScoreCharts from "../components/ScoreCharts";
import { DashboardReport } from "../types";
import { IconChevronLeft, IconAlertTriangle, IconShield, IconSparkle, IconCheckCircle, IconDownload } from "../ui/icons";
import { StatusBadge } from "../ui/primitives";
import { exportElementToPdf } from "../lib/pdf";

const EVALUATION_PARAMETERS = [
  { label: "Communication", weight: "25%", field: "communication_score", description: "Clarity of expression and structure of the answer." },
  { label: "Confidence", weight: "25%", field: "blended_confidence_score", description: "Tone/certainty conveyed, blended with facial composure." },
  { label: "Relevance", weight: "30%", field: "relevance_score", description: "How directly the answer addresses the question asked." },
  { label: "Clarity", weight: "20%", field: "clarity_score", description: "Logical coherence and specificity; penalizes vagueness." },
] as const;

const RECOMMENDATION_STYLES: Record<string, string> = {
  "Strong Hire": "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  Hire: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  Borderline: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  "No Hire": "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  "Needs Review": "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
};

const RECOMMENDATION_RING: Record<string, string> = {
  "Strong Hire": "stroke-emerald-500",
  Hire: "stroke-sky-500",
  Borderline: "stroke-amber-500",
  "No Hire": "stroke-red-500",
  "Needs Review": "stroke-violet-500",
};

function ScoreRing({ score, recommendation }: { score: number; recommendation: string }) {
  const pct = Math.max(0, Math.min(100, score));
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
      <svg viewBox="0 0 96 96" className="h-28 w-28 -rotate-90">
        <circle cx="48" cy="48" r={r} className="stroke-ink-150" strokeWidth="8" fill="none" />
        <circle
          cx="48"
          cy="48"
          r={r}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-[stroke-dashoffset] duration-700 ease-out ${
            RECOMMENDATION_RING[recommendation] || "stroke-brand-600"
          }`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display text-2xl font-semibold leading-none text-ink-900">{score}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">/ 100</span>
      </div>
    </div>
  );
}

export default function ReportDashboard() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Collapsed by default: the summary elements above (score ring, averages,
  // ScoreCharts, recommendation badge) already give recruiters the gist at a
  // glance; the full per-question transcript is opt-in via this toggle.
  const [showTranscript, setShowTranscript] = useState(false);
  const [showChallengeAnswers, setShowChallengeAnswers] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getInterviewReport(Number(id))
      .then(setReport)
      .catch((err) => setError(err.message));
  }, [id]);

  const downloadPdf = async () => {
    if (!reportRef.current || !report) return;
    setDownloading(true);
    try {
      const safeName = (report.interview.candidate_name || "candidate").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
      await exportElementToPdf(reportRef.current, `interview-report-${safeName || report.interview.candidate_id}.pdf`);
    } catch (err) {
      console.error("Failed to generate PDF", err);
      setError("Could not generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  if (error)
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">{error}</div>
      </div>
    );
  if (!report)
    return (
      <div className="flex h-[60vh] items-center justify-center gap-3 text-ink-500">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />
        <span className="text-sm font-medium">Loading report...</span>
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-ink-900"
        >
          <IconChevronLeft width={15} height={15} />
          Back to dashboard
        </Link>
        <button
          type="button"
          onClick={downloadPdf}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3.5 py-2 text-xs font-semibold text-ink-600 shadow-sm transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />
              Generating PDF...
            </>
          ) : (
            <>
              <IconDownload width={14} height={14} />
              Download PDF
            </>
          )}
        </button>
      </div>

      <div ref={reportRef} className="bg-ink-100">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Final Interview Report</p>

      <div className="mb-8 flex flex-col gap-6 rounded-2xl border border-ink-200 bg-white p-7 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">{report.interview.candidate_name}</h1>
          <p className="text-ink-500">{report.interview.candidate_email}</p>
          <p className="mt-1 text-sm text-ink-400">
            Completed {report.interview.completed_at ? new Date(report.interview.completed_at).toLocaleString() : "—"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {report.recommendation ? (
              <StatusBadge
                label={report.recommendation}
                className={RECOMMENDATION_STYLES[report.recommendation] || "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200"}
              />
            ) : (
              <StatusBadge label="No scored responses yet" className="bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200" />
            )}
            {report.interview.status === "TERMINATED" && (
              <StatusBadge
                label="Terminated — policy violation"
                className="bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
              />
            )}
          </div>
          {report.recommendation_overridden && report.recommendation_note && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50 p-3.5 text-sm text-violet-800">
              <IconAlertTriangle width={16} height={16} className="mt-0.5 shrink-0 text-violet-600" />
              <p>{report.recommendation_note}</p>
            </div>
          )}
        </div>
        <ScoreRing score={report.overall_score} recommendation={report.recommendation} />
      </div>

      {report.proctoring_violation_count > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <IconAlertTriangle width={18} height={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-sm font-medium text-amber-800">
            <p>
              {report.proctoring_violation_count} proctoring event(s) recorded during this interview
              {typeof (report.interview as any).warning_count === "number"
                ? ` (${(report.interview as any).warning_count} counted toward the warning limit).`
                : "."}
            </p>
            {(report.interview as any).termination_reason && (
              <p className="mt-1 text-red-700">{(report.interview as any).termination_reason}</p>
            )}
          </div>
        </div>
      )}

      <div className="mb-8 rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <IconSparkle width={17} height={17} className="text-ink-400" />
          <h2 className="text-base font-bold text-ink-900">Interview Summary &amp; AI Assessment</h2>
        </div>
        {report.interview.ai_summary ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">{report.interview.ai_summary}</p>
        ) : (
          <p className="text-sm text-ink-400">
            {report.interview.status === "COMPLETED" || report.interview.status === "TERMINATED"
              ? "No AI assessment available for this interview yet."
              : "The AI assessment will be generated once this interview is completed."}
          </p>
        )}
      </div>

      <div className="mb-8 rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
        <h2 className="mb-4 text-base font-bold text-ink-900">Evaluation Parameters</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EVALUATION_PARAMETERS.map((p) => (
            <div
              key={p.field}
              className="rounded-xl border border-ink-150 bg-ink-50 p-4 transition-colors duration-150 hover:bg-ink-100/70"
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-sm font-semibold text-ink-800">{p.label}</span>
                <span className="text-xs font-medium text-ink-400">{p.weight}</span>
              </div>
              <div className="mb-1 font-display text-2xl font-semibold text-brand-700">
                {(report.averages as any)[p.field] ?? "—"}
              </div>
              <p className="text-xs leading-relaxed text-ink-500">{p.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <ScoreCharts averages={report.averages} perQuestion={report.questions} />
      </div>

      <div className="mb-8 rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-ink-900">Question-by-Question Review</h2>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900"
          >
            {showTranscript ? "Hide Transcript" : "Show Full Interview Transcript"}
          </button>
        </div>
        <div className="space-y-4">
          {report.questions.map((q, i) => (
            <div key={q.response_id} className="rounded-xl border border-ink-150 p-4 transition-colors duration-150 hover:border-ink-200 hover:bg-ink-50/60">
              <div className={`flex flex-wrap items-center justify-between gap-2 ${showTranscript ? "mb-2" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-500">
                    {i + 1}
                  </span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {q.category}
                  </span>
                  {!showTranscript && (
                    <p className="text-sm font-semibold text-ink-800">{q.question_text}</p>
                  )}
                </div>
                <span className="text-xs font-medium text-ink-400">
                  Comm {q.communication_score ?? "—"} · Conf {q.blended_confidence_score ?? "—"} · Rel{" "}
                  {q.relevance_score ?? "—"} · Clarity {q.clarity_score ?? "—"}
                </span>
              </div>
              {showTranscript && (
                <>
                  <p className="mb-1 text-sm font-semibold text-ink-800">{q.question_text}</p>
                  <p className="text-sm leading-relaxed text-ink-600">
                    {q.transcript_text || <em className="text-ink-400">No answer recorded.</em>}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {report.challenges && report.challenges.length > 0 ? (
        <div className="mb-8 rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconSparkle width={17} height={17} className="text-ink-400" />
              <h2 className="text-base font-bold text-ink-900">Final Challenge</h2>
              <span className="text-xs font-medium text-ink-400">({report.challenges.length} parts)</span>
            </div>
            <button
              type="button"
              onClick={() => setShowChallengeAnswers((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900"
            >
              {showChallengeAnswers ? "Hide Answers" : "Show Submitted Answers"}
            </button>
          </div>

          <div className="space-y-5">
            {report.challenges.map(({ challenge, submission }, idx) => {
              if (!challenge) return null;
              return (
                <div key={challenge.challenge_id} className={idx > 0 ? "border-t border-ink-150 pt-5" : ""}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-500">
                        {challenge.part_number || idx + 1}
                      </span>
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                        {challenge.part_role ? challenge.part_role.replace("_", " ") : challenge.challenge_type === "CODE" ? "Coding" : "Riddle"}
                      </span>
                    </div>
                    {submission ? (
                      submission.needs_human_review ? (
                        <StatusBadge
                          label="Needs human review"
                          className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                        />
                      ) : (
                        <StatusBadge
                          label={submission.auto_eval_passed ? "Solved" : "Not solved"}
                          className={
                            submission.auto_eval_passed
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                              : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                          }
                        />
                      )
                    ) : (
                      <StatusBadge label="Not attempted" className="bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200" />
                    )}
                  </div>

                  <p className="mb-1 text-sm font-semibold text-ink-800">{challenge.title}</p>
                  <p className="mb-3 whitespace-pre-line text-sm leading-relaxed text-ink-600">{challenge.prompt_text}</p>

                  {submission ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-ink-400">
                        {submission.submitted_language && <span>Language: {submission.submitted_language}</span>}
                        {typeof submission.auto_eval_score === "number" && (
                          <span>Auto-eval score: {submission.auto_eval_score}/100</span>
                        )}
                        <span>Submitted {new Date(submission.submitted_at).toLocaleString()}</span>
                      </div>
                      {showChallengeAnswers && (
                        <>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-ink-150 bg-ink-900 p-4 font-mono text-[13px] leading-relaxed text-ink-100">
                            {submission.submitted_answer}
                          </pre>
                          {submission.auto_eval_feedback && (
                            <div className="rounded-xl border border-ink-150 bg-ink-50 p-3.5 text-sm text-ink-600">
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                                Auto-eval feedback (for reviewer)
                              </p>
                              <p className="leading-relaxed">{submission.auto_eval_feedback}</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-400">The candidate has not submitted a solution yet.</p>
                  )}
                </div>
              );
            })}
          </div>

          {report.challenge_effect && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-ink-150 bg-ink-50 p-3.5 text-sm text-ink-600">
              <IconCheckCircle width={15} height={15} className="mt-0.5 shrink-0 text-brand-600" />
              <span>{report.challenge_effect}</span>
            </div>
          )}
        </div>
      ) : report.challenge ? (
        // Backward-compatible fallback for a report shape from before the
        // 2-part challenge restructure (a single `challenge` field only).
        <div className="mb-8 rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconSparkle width={17} height={17} className="text-ink-400" />
              <h2 className="text-base font-bold text-ink-900">Final Challenge</h2>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                {report.challenge.challenge_type === "CODE" ? "Coding" : "Riddle"}
              </span>
            </div>
            {report.challenge_submission ? (
              report.challenge_submission.needs_human_review ? (
                <StatusBadge
                  label="Needs human review"
                  className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                />
              ) : (
                <StatusBadge
                  label={report.challenge_submission.auto_eval_passed ? "Solved" : "Not solved"}
                  className={
                    report.challenge_submission.auto_eval_passed
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                  }
                />
              )
            ) : (
              <StatusBadge label="Not attempted" className="bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200" />
            )}
          </div>

          <p className="mb-1 text-sm font-semibold text-ink-800">{report.challenge.title}</p>
          <p className="mb-4 whitespace-pre-line text-sm leading-relaxed text-ink-600">{report.challenge.prompt_text}</p>

          {report.challenge_effect && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-ink-150 bg-ink-50 p-3.5 text-sm text-ink-600">
              <IconCheckCircle width={15} height={15} className="mt-0.5 shrink-0 text-brand-600" />
              <span>{report.challenge_effect}</span>
            </div>
          )}

          {report.challenge_submission ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-ink-400">
                {report.challenge_submission.submitted_language && (
                  <span>Language: {report.challenge_submission.submitted_language}</span>
                )}
                {typeof report.challenge_submission.auto_eval_score === "number" && (
                  <span>Auto-eval score: {report.challenge_submission.auto_eval_score}/100</span>
                )}
                <span>Submitted {new Date(report.challenge_submission.submitted_at).toLocaleString()}</span>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-ink-150 bg-ink-900 p-4 font-mono text-[13px] leading-relaxed text-ink-100">
                {report.challenge_submission.submitted_answer}
              </pre>
              {report.challenge_submission.auto_eval_feedback && (
                <div className="rounded-xl border border-ink-150 bg-ink-50 p-3.5 text-sm text-ink-600">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Auto-eval feedback (for reviewer)
                  </p>
                  <p className="leading-relaxed">{report.challenge_submission.auto_eval_feedback}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-400">The candidate has not submitted a solution yet.</p>
          )}
        </div>
      ) : null}

      <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <IconShield width={17} height={17} className="text-ink-400" />
          <h2 className="text-base font-bold text-ink-900">Proctoring Audit Log</h2>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink-150 bg-ink-50 p-3.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Last Object Detected</p>
            <p className="text-sm font-semibold text-ink-800">
              {report.interview.last_object_detected || "None detected"}
            </p>
            {report.interview.last_object_detected_at && (
              <p className="mt-0.5 text-xs text-ink-400">
                {new Date(report.interview.last_object_detected_at).toLocaleString()}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-ink-150 bg-ink-50 p-3.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Human Detected</p>
            <p
              className={`text-sm font-semibold ${
                report.interview.human_detected === false ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {report.interview.human_detected === false ? "No" : "Yes"}
            </p>
            {report.interview.human_detected_at && (
              <p className="mt-0.5 text-xs text-ink-400">
                {new Date(report.interview.human_detected_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {report.proctoring_events.length === 0 ? (
          <p className="text-sm text-ink-400">No proctoring violations recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {report.proctoring_events.map((e) => (
              <li key={e.event_id} className="rounded-lg bg-ink-50 px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-ink-700">{e.event_type}</span>
                  <span className="shrink-0 text-xs text-ink-400">{new Date(e.event_timestamp).toLocaleString()}</span>
                </div>
                {e.notes && <p className="mt-1 text-xs leading-relaxed text-ink-500">{e.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </div>
  );
}

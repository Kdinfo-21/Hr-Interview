import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { StatCard, StatusBadge, SectionHeading } from "../ui/primitives";
import { IconCalendarPlus, IconRefresh, IconUsers, IconClock, IconCheckCircle, IconInbox, IconLink, IconFileText, IconExternalLink, IconAlertTriangle } from "../ui/icons";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200",
  SCHEDULED: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  PAUSED: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  EXPIRED: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  CANCELLED: "bg-ink-100 text-ink-500 ring-1 ring-inset ring-ink-200",
};

const STATUS_DOTS: Record<string, string> = {
  PENDING: "bg-ink-400",
  SCHEDULED: "bg-sky-500",
  IN_PROGRESS: "bg-amber-500",
  PAUSED: "bg-orange-500",
  COMPLETED: "bg-emerald-500",
  EXPIRED: "bg-red-500",
  CANCELLED: "bg-ink-400",
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Hire": "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  Hire: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  Borderline: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  "No Hire": "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  // Distinct from Borderline on purpose — this means the formula wanted to say
  // "No Hire" but a solved final challenge stopped it from auto-rejecting.
  "Needs Review": "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
};

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0]?.toUpperCase();
}

// Deterministic, purely-cosmetic avatar tint derived from the name — no data logic involved.
const AVATAR_TINTS = [
  "bg-brand-50 text-brand-700",
  "bg-emerald-50 text-emerald-700",
  "bg-sky-50 text-sky-700",
  "bg-violet-50 text-violet-700",
  "bg-rose-50 text-rose-700",
  "bg-cyan-50 text-cyan-700",
];
function avatarTint(name?: string) {
  const s = name || "?";
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash + s.charCodeAt(i)) % AVATAR_TINTS.length;
  return AVATAR_TINTS[hash];
}

// The dashboard used to fetch up to 200 interviews (with a slow per-row
// backend query) in one shot. It now fetches a page at a time; PAGE_SIZE is
// how many rows come back per page.
const PAGE_SIZE = 30;

export default function AdminDashboard() {
  const [interviews, setInterviews] = useState<any[]>([]);
  // Total interview count across the whole dataset (from the backend's
  // X-Total-Count header), as opposed to `total` below which is just how
  // many rows are currently loaded/displayed.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);

  // Kept in sync with `interviews` so the polling interval (set up once on
  // mount) always knows how many rows are currently loaded, without needing
  // to be torn down and recreated every time the list changes.
  const loadedCountRef = useRef(0);
  useEffect(() => {
    loadedCountRef.current = interviews.length;
  }, [interviews]);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Re-fetch as many rows as are currently on screen, so a refresh
      // (manual or polled) doesn't discard progress from "Load more".
      const count = Math.max(PAGE_SIZE, loadedCountRef.current);
      const { data, total: newTotal } = await api.getDashboardSummary(count, 0);
      setInterviews(data);
      setTotalCount(newTotal);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { data, total: newTotal } = await api.getDashboardSummary(PAGE_SIZE, loadedCountRef.current);
      setInterviews((prev) => [...prev, ...data]);
      setTotalCount(newTotal);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
    // Poll so a report becomes visible shortly after evaluation finishes,
    // without requiring the recruiter to manually refresh the page. This was
    // 15s, which — combined with the old slow per-row dashboard query — kept
    // the backend constantly busy. 60s is frequent enough to feel live
    // without hammering the API.
    const interval = setInterval(() => load(true), 60000);
    return () => clearInterval(interval);
  }, []);

  const interviewLink = (token: string) => `${window.location.origin}/interview/${token}`;

  const copyLink = (token: string, id: number) => {
    navigator.clipboard.writeText(interviewLink(token));
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
  };

  // Presentational-only counts derived from already-fetched data — no new requests or logic.
  // Note: these (other than the Total Interviews card, which uses totalCount)
  // reflect only the currently-loaded page(s), same as the pre-pagination
  // version reflected only whatever was in its single up-to-200-row fetch.
  const total = interviews.length;
  const completedCount = interviews.filter((i) => i.status === "COMPLETED").length;
  const inProgressCount = interviews.filter((i) => i.status === "IN_PROGRESS" || i.status === "PAUSED").length;
  const scheduledCount = interviews.filter((i) => i.status === "SCHEDULED" || i.status === "PENDING").length;
  // The review queue is intentionally narrow: weak interview Q&A + a successfully
  // solved final challenge. Do not route every low-scoring candidate to review.
  const needsReviewCount = interviews.filter((i) => i.needs_review === true).length;
  const visibleInterviews = reviewOnly ? interviews.filter((i) => i.needs_review === true) : interviews;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Recruiter Workspace"
          title="Interview Dashboard"
          description="Manage scheduled interviews, monitor progress, and review completed candidate reports."
        />
        <div className="flex gap-2.5">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 shadow-sm transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900 disabled:opacity-60"
          >
            <IconRefresh width={15} height={15} className={loading ? "animate-spin" : ""} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <Link
            to="/admin/schedule"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-brand transition-colors duration-150 hover:from-brand-500 hover:to-brand-600"
          >
            <IconCalendarPlus width={15} height={15} />
            Schedule Interview
          </Link>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Total Interviews" value={totalCount ?? total} icon={<IconUsers width={20} height={20} />} accent="text-brand-700 bg-brand-50 ring-1 ring-inset ring-brand-200/70" />
        <StatCard label="Scheduled" value={scheduledCount} icon={<IconClock width={20} height={20} />} accent="text-sky-600 bg-sky-50 ring-1 ring-inset ring-sky-200" />
        <StatCard label="In Progress" value={inProgressCount} icon={<IconClock width={20} height={20} />} accent="text-amber-600 bg-amber-50 ring-1 ring-inset ring-amber-200" />
        <StatCard label="Completed" value={completedCount} icon={<IconCheckCircle width={20} height={20} />} accent="text-emerald-600 bg-emerald-50 ring-1 ring-inset ring-emerald-200" />
        <button onClick={() => setReviewOnly((v) => !v)} className="text-left" title="Flagged for human review — weak interview performance but a successfully solved final challenge. Click to filter the list.">
          <StatCard
            label="Needs Review"
            value={needsReviewCount}
            icon={<IconAlertTriangle width={20} height={20} />}
            accent={`text-violet-600 bg-violet-50 ring-1 ring-inset ring-violet-200 ${reviewOnly ? "ring-2 ring-violet-400" : ""}`}
          />
        </button>
      </div>

      {reviewOnly && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-800">
          <span>
            Showing only candidates flagged <span className="font-semibold">Needs Review</span> — their interview Q&A
            performance was weak, but they successfully solved the final challenge. Their challenge result gives
            them a modest hiring boost and routes the interview to a recruiter for human review.
          </span>
          <button onClick={() => setReviewOnly(false)} className="ml-3 shrink-0 font-semibold underline underline-offset-2 hover:text-violet-900">
            Clear
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-5 py-4 text-sm text-ink-500 shadow-card">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />
          Loading interviews...
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3.5">Candidate</th>
                <th className="px-5 py-3.5">Role</th>
                <th className="px-5 py-3.5">Scheduled</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Result</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-150">
              {visibleInterviews.map((iv) => (
                <tr key={iv.interview_id} className="group transition-colors duration-150 hover:bg-ink-50/70">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarTint(
                          iv.candidate_name
                        )}`}
                      >
                        {initials(iv.candidate_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink-900">{iv.candidate_name}</div>
                        <div className="truncate text-xs text-ink-500">{iv.candidate_email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-ink-600">{iv.role_title || <span className="text-ink-300">—</span>}</td>
                  <td className="px-5 py-3.5 text-ink-600">
                    {iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge
                      label={iv.status}
                      className={STATUS_COLORS[iv.status] || "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200"}
                      dotClassName={STATUS_DOTS[iv.status] || "bg-ink-400"}
                    />
                  </td>
                  <td className="px-5 py-3.5">
                    {iv.recommendation ? (
                      <StatusBadge
                        label={iv.recommendation}
                        className={RECOMMENDATION_COLORS[iv.recommendation] || "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200"}
                      />
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <a
                        href={interviewLink(iv.interview_token)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open the live interview page for this candidate"
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-500 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700"
                      >
                        <IconExternalLink width={13} height={13} />
                        Open
                      </a>
                      <button
                        onClick={() => copyLink(iv.interview_token, iv.interview_id)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-500 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700"
                      >
                        <IconLink width={13} height={13} />
                        {copiedId === iv.interview_id ? "Copied!" : "Copy Link"}
                      </button>
                      {(iv.status === "COMPLETED" || iv.status === "TERMINATED") && (
                        <Link
                          to={`/admin/report/${iv.interview_id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition-colors duration-150 hover:bg-brand-50"
                        >
                          <IconFileText width={13} height={13} />
                          View Full Interview
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleInterviews.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-ink-400">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-100">
                        <IconInbox width={22} height={22} />
                      </div>
                      {reviewOnly ? (
                        <>
                          <p className="text-sm font-medium text-ink-500">No candidates currently need review.</p>
                          <button onClick={() => setReviewOnly(false)} className="text-sm font-semibold text-brand-700 hover:underline">
                            Show all interviews →
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-ink-500">No interviews scheduled yet.</p>
                          <Link to="/admin/schedule" className="text-sm font-semibold text-brand-700 hover:underline">
                            Schedule your first interview →
                          </Link>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {totalCount !== null && interviews.length < totalCount && (
            <div className="flex items-center justify-center border-t border-ink-200 bg-ink-50/60 px-5 py-3.5">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 shadow-sm transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900 disabled:opacity-60"
              >
                <IconRefresh width={14} height={14} className={loadingMore ? "animate-spin" : ""} />
                {loadingMore ? "Loading..." : `Load more (${interviews.length} of ${totalCount})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

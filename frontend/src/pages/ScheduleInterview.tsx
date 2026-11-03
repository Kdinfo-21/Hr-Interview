import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { SectionHeading } from "../ui/primitives";
import { ResumeAnalysis } from "../types";
import { IconCheckCircle, IconCopy, IconSparkle, IconChevronLeft, IconFileText, IconExternalLink } from "../ui/icons";

const inputClass =
  "w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-800 shadow-sm transition-shadow duration-150 placeholder:text-ink-400 focus:border-brand-500 focus:shadow-glow focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-semibold text-ink-700";

function FieldGroup({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-ink-150 pb-6 last:border-0 last:pb-0">
      <div className="mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-ink-400">{description}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function normalizeResumeAnalysis(raw: any): ResumeAnalysis {
  // The Python backend returns the frontend's preferred shape. This small
  // fallback also keeps the page safe if an older backend returns the simpler
  // { skills, projects, ... } shape.
  const analysis = raw || {};
  return {
    contact: analysis.contact || {},
    education: Array.isArray(analysis.education) ? analysis.education : [],
    experience: Array.isArray(analysis.experience) ? analysis.experience : [],
    technical_skills: Array.isArray(analysis.technical_skills)
      ? analysis.technical_skills
      : Array.isArray(analysis.skills)
        ? analysis.skills
        : [],
    soft_skills: Array.isArray(analysis.soft_skills) ? analysis.soft_skills : [],
    tools_and_frameworks: Array.isArray(analysis.tools_and_frameworks)
      ? analysis.tools_and_frameworks
      : Array.isArray(analysis.tools)
        ? analysis.tools
        : [],
    domains: Array.isArray(analysis.domains) ? analysis.domains : [],
    total_years_experience:
      analysis.total_years_experience ?? analysis.years_of_experience ?? null,
    notable_projects: Array.isArray(analysis.notable_projects)
      ? analysis.notable_projects
      : Array.isArray(analysis.projects)
        ? analysis.projects.map((project: any) =>
            typeof project === "string" ? { name: project } : project
          )
        : [],
    achievements: Array.isArray(analysis.achievements) ? analysis.achievements : [],
    summary: typeof analysis.summary === "string" ? analysis.summary : "",
  };
}


function CustomDateTimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextValue: string) => void;
}) {
  const pad = (number: number) => String(number).padStart(2, "0");

  const selectedDate = value ? value.slice(0, 10) : "";
  const selectedTime = value ? value.slice(11, 16) : "";

  const [visibleMonth, setVisibleMonth] = useState(() => {
    if (selectedDate) {
      const [year, month] = selectedDate.split("-").map(Number);
      return new Date(year, month - 1, 1);
    }
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarDays: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  while (calendarDays.length % 7 !== 0) {
    calendarDays.push(null);
  }

  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const chooseDate = (day: number) => {
    const date = `${year}-${pad(month + 1)}-${pad(day)}`;
    onChange(`${date}T${selectedTime || "09:00"}`);
  };

  const chooseHour = (hour: string) => {
    if (!selectedDate) return;
    const minute = selectedTime ? selectedTime.slice(3, 5) : "00";
    onChange(`${selectedDate}T${hour}:${minute}`);
  };

  const chooseMinute = (minute: string) => {
    if (!selectedDate) return;
    const hour = selectedTime ? selectedTime.slice(0, 2) : "09";
    onChange(`${selectedDate}T${hour}:${minute}`);
  };

  const today = new Date();
  const todayString = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <div className="w-full rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setVisibleMonth(new Date(year, month - 1, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-lg text-ink-700 transition-colors hover:bg-ink-50"
        >
          ‹
        </button>

        <h3 className="text-sm font-semibold text-ink-800">{monthLabel}</h3>

        <button
          type="button"
          aria-label="Next month"
          onClick={() => setVisibleMonth(new Date(year, month + 1, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-lg text-ink-700 transition-colors hover:bg-ink-50"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div
            key={day}
            className="py-2 text-xs font-semibold text-ink-400"
          >
            {day}
          </div>
        ))}

        {calendarDays.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="h-9" />;
          }

          const dateString = `${year}-${pad(month + 1)}-${pad(day)}`;
          const isSelected = dateString === selectedDate;
          const isToday = dateString === todayString;

          return (
            <button
              key={dateString}
              type="button"
              aria-label={`Select ${dateString}`}
              aria-pressed={isSelected}
              onClick={() => chooseDate(day)}
              className={`h-9 rounded-lg text-sm transition-colors ${
                isSelected
                  ? "bg-brand-600 font-semibold text-white"
                  : isToday
                    ? "border border-brand-300 text-brand-700 hover:bg-brand-50"
                    : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-5 border-t border-ink-100 pt-4">
        <label className="mb-2 block text-sm font-semibold text-ink-700">
          Interview time
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-ink-500">Hour</label>
            <select
              aria-label="Interview hour"
              value={selectedTime ? selectedTime.slice(0, 2) : "09"}
              disabled={!selectedDate}
              onChange={(event) => chooseHour(event.target.value)}
              className={inputClass}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={pad(hour)}>
                  {pad(hour)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-500">Minute</label>
            <select
              aria-label="Interview minute"
              value={selectedTime ? selectedTime.slice(3, 5) : "00"}
              disabled={!selectedDate}
              onChange={(event) => chooseMinute(event.target.value)}
              className={inputClass}
            >
              {["00", "15", "30", "45"].map((minute) => (
                <option key={minute} value={minute}>
                  {minute}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedDate ? (
          <p className="mt-3 text-sm font-medium text-brand-700">
            Selected: {selectedDate} at {selectedTime || "09:00"}
          </p>
        ) : (
          <p className="mt-3 text-xs text-ink-400">
            Select a date to choose the interview time.
          </p>
        )}
      </div>
    </div>
  );
}

export default function ScheduleInterview() {
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [roleContext, setRoleContext] = useState("");
  const [seniorityLevel, setSeniorityLevel] = useState("");
  const [yearsOfExperience, setYearsOfExperience] = useState<string>("");
  const [totalQuestions, setTotalQuestions] = useState(6);
  const [scheduledAt, setScheduledAt] = useState("");
  const [windowHours, setWindowHours] = useState(48);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ interview: any; shareableLink: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Resume upload & analysis — upload first, then auto-fill the candidate
  // fields below from what was extracted. Analysis only happens here
  // (POST /resume/analyze); no candidate record is created until the
  // interview is actually scheduled, so an abandoned upload never leaves
  // behind a stray candidate row.
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeAnalysis, setResumeAnalysis] = useState<ResumeAnalysis | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [resumeFilename, setResumeFilename] = useState<string | null>(null);
  const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());

  const onUploadResume = async () => {
    if (!resumeFile) return;
    setResumeError(null);
    setResumeUploading(true);
    try {
      const data = await api.analyzeResume(resumeFile);
      const analysis = normalizeResumeAnalysis(data.resume_analysis);
      setResumeAnalysis(analysis);
      setResumeText(data.resume_text);
      setResumeFilename(data.resume_filename);

      // Auto-fill only fields the recruiter hasn't already typed into,
      // so a manual edit is never silently overwritten.
      const filled = new Set<string>();
      if (!candidateName && analysis.contact.full_name) {
        setCandidateName(analysis.contact.full_name);
        filled.add("name");
      }
      if (!candidateEmail && analysis.contact.email) {
        setCandidateEmail(analysis.contact.email);
        filled.add("email");
      }
      if (!candidatePhone && analysis.contact.phone) {
        setCandidatePhone(analysis.contact.phone);
        filled.add("phone");
      }
      if (!yearsOfExperience && analysis.total_years_experience != null) {
        setYearsOfExperience(String(analysis.total_years_experience));
        filled.add("years");
      }
      setAutofilledFields(filled);
    } catch (err: any) {
      setResumeError(err.message);
    } finally {
      setResumeUploading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!scheduledAt) {
      setError("Please select an interview date and time.");
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      setError("Please select a valid interview date and time.");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const data = await api.scheduleInterview({
        candidate_name: candidateName,
        candidate_email: candidateEmail,
        candidate_phone: candidatePhone || undefined,
        resume_text: resumeText || undefined,
        resume_filename: resumeFilename || undefined,
        resume_analysis: resumeAnalysis || undefined,
        role_title: roleTitle || undefined,
        role_context: roleContext || undefined,
        seniority_level: seniorityLevel || undefined,
        years_of_experience: yearsOfExperience !== "" ? Number(yearsOfExperience) : undefined,
        total_questions: totalQuestions,
        scheduled_at: scheduledDate.toISOString(),
        window_hours: windowHours,
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Build the candidate link from the current browser origin rather than trusting
  // the backend's configured FRONTEND_BASE_URL verbatim — this guarantees the
  // link actually resolves to this app's live interview route wherever it's
  // deployed, even if that env var is stale or points elsewhere.
  const interviewLink = result
    ? `${window.location.origin}/interview/${result.interview.interview_token}`
    : "";

  const copyResultLink = () => {
    if (!interviewLink) return;
    navigator.clipboard.writeText(interviewLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link
        to="/admin"
        className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <IconChevronLeft width={15} height={15} />
        Back to dashboard
      </Link>

      <div className="mb-8">
        <SectionHeading
          eyebrow="New Interview"
          title="Schedule an Interview"
          description="No need to pre-build a question list — the AI interviewer generates each question live, in real time, tailored to the candidate's role, seniority, and how the conversation goes."
        />
      </div>

      <form onSubmit={onSubmit} className="space-y-6 rounded-2xl border border-ink-200 bg-white p-7 shadow-card">
        <FieldGroup
          title="Resume"
          description="Optional — upload a PDF or DOCX first and we'll auto-fill the candidate's name/email/phone/experience below from it, plus tailor interview questions to their actual background."
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-ink-300 bg-ink-50 px-3.5 py-2.5 text-sm font-medium text-ink-600 transition-colors duration-150 hover:border-brand-400 hover:text-brand-700">
              <IconFileText width={15} height={15} />
              {resumeFile ? resumeFile.name : "Choose resume file"}
              <input
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  setResumeFile(e.target.files?.[0] || null);
                  setResumeAnalysis(null);
                  setResumeText(null);
                  setResumeFilename(null);
                  setResumeError(null);
                  setAutofilledFields(new Set());
                }}
              />
            </label>
            <button
              type="button"
              onClick={onUploadResume}
              disabled={!resumeFile || resumeUploading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resumeUploading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Analyzing...
                </>
              ) : (
                "Upload & Analyze"
              )}
            </button>
          </div>

          {resumeError && <p className="text-sm font-medium text-red-600">{resumeError}</p>}

          {resumeAnalysis && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-800">
                <IconCheckCircle width={15} height={15} />
                Resume analyzed
                {autofilledFields.size > 0 && (
                  <span className="font-normal text-emerald-700">
                    — auto-filled {Array.from(autofilledFields).join(", ")} below
                  </span>
                )}
              </div>
              {resumeAnalysis.summary && (
                <p className="mb-2 text-sm leading-relaxed text-emerald-800/90">{resumeAnalysis.summary}</p>
              )}
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                {resumeAnalysis.total_years_experience != null
                  ? `${resumeAnalysis.total_years_experience} yrs experience`
                  : "Experience unspecified"}
                {resumeAnalysis.notable_projects.length > 0
                  ? ` • ${resumeAnalysis.notable_projects.length} project${resumeAnalysis.notable_projects.length === 1 ? "" : "s"} found`
                  : ""}
              </div>
              {[...resumeAnalysis.technical_skills, ...resumeAnalysis.tools_and_frameworks].length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...resumeAnalysis.technical_skills, ...resumeAnalysis.tools_and_frameworks].slice(0, 14).map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </FieldGroup>

        <FieldGroup title="Candidate Details">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                Candidate Name
                {autofilledFields.has("name") && (
                  <span className="ml-1.5 font-normal text-emerald-600">(from resume)</span>
                )}
              </label>
              <input
                required
                value={candidateName}
                onChange={(e) => {
                  setCandidateName(e.target.value);
                  if (autofilledFields.has("name")) {
                    const next = new Set(autofilledFields);
                    next.delete("name");
                    setAutofilledFields(next);
                  }
                }}
                placeholder="Jordan Lee"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Candidate Email
                {autofilledFields.has("email") && (
                  <span className="ml-1.5 font-normal text-emerald-600">(from resume)</span>
                )}
              </label>
              <input
                required
                type="email"
                value={candidateEmail}
                onChange={(e) => {
                  setCandidateEmail(e.target.value);
                  if (autofilledFields.has("email")) {
                    const next = new Set(autofilledFields);
                    next.delete("email");
                    setAutofilledFields(next);
                  }
                }}
                placeholder="jordan@email.com"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>
              Phone <span className="font-normal text-ink-400">(optional)</span>
              {autofilledFields.has("phone") && (
                <span className="ml-1.5 font-normal text-emerald-600">(from resume)</span>
              )}
            </label>
            <input
              value={candidatePhone}
              onChange={(e) => {
                setCandidatePhone(e.target.value);
                if (autofilledFields.has("phone")) {
                  const next = new Set(autofilledFields);
                  next.delete("phone");
                  setAutofilledFields(next);
                }
              }}
              placeholder="+1 555 010 2938"
              className={inputClass}
            />
          </div>
        </FieldGroup>

        <FieldGroup
          title="Role Context"
          description="Role and seniority are used as primary context — the AI interviewer generates role-specific, difficulty-appropriate questions live from these."
        >
          <div>
            <label className={labelClass}>
              Role Title <span className="font-normal text-ink-400">(optional)</span>
            </label>
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder='e.g. "Frontend Developer"'
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                Seniority Level <span className="font-normal text-ink-400">(optional)</span>
              </label>
              <select
                value={seniorityLevel}
                onChange={(e) => setSeniorityLevel(e.target.value)}
                className={inputClass}
              >
                <option value="">Auto (from years)</option>
                <option value="Intern">Intern</option>
                <option value="Junior">Junior (0–2 yrs)</option>
                <option value="Mid-Level">Mid-Level (2–5 yrs)</option>
                <option value="Senior">Senior (5–8 yrs)</option>
                <option value="Lead/Principal">Lead/Principal (8+ yrs)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Years of Experience <span className="font-normal text-ink-400">(optional)</span>
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={yearsOfExperience}
                onChange={(e) => setYearsOfExperience(e.target.value)}
                placeholder="e.g. 3"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>
              Role Context <span className="font-normal text-ink-400">(optional, one short sentence)</span>
            </label>
            <input
              value={roleContext}
              onChange={(e) => setRoleContext(e.target.value)}
              placeholder="e.g. fast-paced startup, cross-functional team"
              className={inputClass}
            />
          </div>
        </FieldGroup>

        <FieldGroup title="Scheduling">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Questions</label>
              <input
                type="number"
                min={3}
                max={12}
                value={totalQuestions}
                onChange={(e) => setTotalQuestions(Number(e.target.value))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Link Valid (hrs)</label>
              <input
                type="number"
                min={1}
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value))}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>
              Date &amp; Time <span className="text-red-500">*</span>
            </label>
            <CustomDateTimePicker
              value={scheduledAt}
              onChange={setScheduledAt}
            />
          </div>
        </FieldGroup>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-4 py-3 font-semibold text-white shadow-brand transition-colors duration-150 hover:from-brand-500 hover:to-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Scheduling...
            </>
          ) : (
            <>
              <IconSparkle width={16} height={16} />
              Schedule Interview
            </>
          )}
        </button>
      </form>

      {result && (
        <div className="mt-6 animate-popIn rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <IconCheckCircle width={17} height={17} />
            </div>
            <h2 className="font-bold text-emerald-800">Interview Scheduled</h2>
          </div>
          <p className="mb-3 text-sm text-emerald-700">Share this link with the candidate:</p>
          <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-white p-3">
            <a
              href={interviewLink}
              target="_blank"
              rel="noopener noreferrer"
              title="Opens the live interview page for this candidate"
              className="flex-1 truncate text-sm text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand-800"
            >
              {interviewLink}
            </a>
            <a
              href={interviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 transition-colors duration-150 hover:bg-ink-50"
            >
              <IconExternalLink width={13} height={13} />
              Open
            </a>
            <button
              onClick={copyResultLink}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-ink-700"
            >
              <IconCopy width={13} height={13} />
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-xs font-medium text-emerald-700">
            Expires: {new Date(result.interview.expires_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

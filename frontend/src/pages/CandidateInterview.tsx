import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useFullscreen } from "../hooks/useFullscreen";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "../hooks/useSpeechSynthesis";
import { useObjectDetection } from "../hooks/useObjectDetection";
import { useNoiseDetection } from "../hooks/useNoiseDetection";
import { useProctoring, ProctoringEventType } from "../hooks/useProctoring";
import ProctoringOverlay from "../components/ProctoringOverlay";
import ProctoringBanner from "../components/ProctoringBanner";
import FaceAnalyzer from "../components/FaceAnalyzer";
import QuestionCard from "../components/QuestionCard";
import ChallengeCard from "../components/ChallengeCard";
import { LiveQuestion, ChallengeForCandidate } from "../types";
import { IconLogo, IconCamera, IconMic, IconShield, IconCheckCircle } from "../ui/icons";
import { ProgressBar } from "../ui/primitives";
import { lockToInterview } from "../lib/candidateSession";
import { useAuth } from "../context/AuthContext";

type Stage =
  | "loading"
  | "error"
  | "consent"
  | "fetching_question"
  | "narrating"
  | "in_progress"
  | "fetching_challenge"
  | "challenge"
  | "submitting_challenge"
  | "completed"
  | "terminated";

export default function CandidateInterview() {
  const { token } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [interview, setInterview] = useState<any>(null);
  const [currentQuestion, setCurrentQuestion] = useState<LiveQuestion | null>(null);
  const [questionNumber, setQuestionNumber] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(6);
  const [submitting, setSubmitting] = useState(false);
  // The final challenge is always exactly 2 discrete parts, stepped through
  // one at a time. challengeParts holds both (fetched once); challengeIndex
  // (0 or 1) tracks which one is currently shown/being answered.
  const [challengeParts, setChallengeParts] = useState<ChallengeForCandidate[]>([]);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const challenge = challengeParts[challengeIndex] || null;
  const [paused, setPaused] = useState(false);
  const [violationType, setViolationType] = useState<ProctoringEventType | null>(null);
  const [terminationReason, setTerminationReason] = useState<string | null>(null);
  // Soft/ambient proctoring warnings (out-of-frame, background noise) shown as
  // a non-blocking banner rather than the full-screen violation modal.
  const [softWarnings, setSoftWarnings] = useState<Partial<Record<ProctoringEventType, string>>>({});
  const [liveWarning, setLiveWarning] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const { enter: enterFullscreen } = useFullscreen(containerRef);
  const {
    transcript,
    isListening,
    error: speechError,
    start: startListening,
    stop: stopListening,
    reset: resetTranscript,
  } = useSpeechRecognition();

  // Global (whole-interview) voice-answer retry allowance — server-persisted
  // on the interview row so it survives refreshes; never resets per-question.
  const [retryLimit, setRetryLimit] = useState(0);
  const [retriesRemaining, setRetriesRemaining] = useState(0);
  const [retryPromptVisible, setRetryPromptVisible] = useState(false);
  const MIN_ANSWER_CHARS = 3;

  const {
    warningCount,
    maxWarnings,
    reportFramePresence,
    reportProhibitedObject,
    reportMobileDetected,
    reportHumanPresence,
    reportExtraPerson,
    reportNoiseLevel,
    reportCameraStatus,
    logResumeClicked,
  } = useProctoring({
    token: token!,
    active: (stage === "narrating" || stage === "in_progress" || stage === "challenge" || stage === "submitting_challenge") && !paused,
    onViolation: (type) => {
      setPaused(true);
      setViolationType(type);
      cancelSpeech();
      stopListening();
      stopSampling();
      stopDetectingObjects();
      stopNoiseDetection();
    },
    onTerminated: (reason) => {
      setTerminationReason(reason);
      setStage("terminated");
      cancelSpeech();
      stopListening();
      stopSampling();
      stopDetectingObjects();
      stopNoiseDetection();
    },
    onSoftWarning: (type, message) => {
      setSoftWarnings((prev) => ({ ...prev, [type]: message }));
    },
    onSoftWarningCleared: (type) => {
      setSoftWarnings((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
    },
  });

  // Face-api.js is intentionally disabled here. YOLO on the real camera frame is the
  // primary visual detector, avoiding the broken browser model-path/runtime.
  const startSampling = useCallback(() => {}, []);
  const stopSampling = useCallback(() => {}, []);
  const getSamplesAndReset = useCallback(() => [], []);

  const { startDetecting: startDetectingObjects, stopDetecting: stopDetectingObjects } = useObjectDetection(
    videoRef,
    {
      token: token!,
      onProhibitedObject: (obj) => {
        setLiveWarning(`Prohibited object detected: ${obj.label}.`);
        reportProhibitedObject(obj.label, obj.confidence);
      },
      onMobileDetected: (obj) => {
        setLiveWarning("Mobile phone detected. Please remove the phone.");
        reportMobileDetected(obj.confidence);
      },
      // Secondary extra-person signal folded into the same MULTIPLE_FACES
      // event type, per the roadmap's recommendation — labeled distinctly in
      // the notes so the audit log still shows which detector caught it.
      onExtraPerson: (count) => {
        setLiveWarning("Multiple people detected. Only the candidate should be visible.");
        reportExtraPerson(count);
      },
      // Object detection is also a fallback presence signal when face-api.js
      // models are unavailable. Both detectors feed the same debounced
      // CANDIDATE_OUT_OF_FRAME pipeline.
      onHumanPresence: (present, count) => {
        reportHumanPresence(present, count);
        reportFramePresence(present);
      },
    }
  );

  const { start: startNoiseDetection, stop: stopNoiseDetection } = useNoiseDetection({
    onLevel: (level) => reportNoiseLevel(level),
  });

  // Fully release the persistent mic stream once the interview is over (or
  // the component unmounts), so the browser's mic indicator turns off.
  useEffect(() => {
    if (stage === "completed" || stage === "terminated") {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }, [stage]);
  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Once the AI finishes reading the question aloud, transition into
  // listening mode: only now do we start speech recognition, facial
  // sampling, and object detection, so the candidate can't answer before
  // the question ends and proctoring runs only while actually needed.
  const onNarrationEnd = () => {
    setStage("in_progress");
    startListening();
    startSampling();
    startDetectingObjects();
    if (micStreamRef.current) startNoiseDetection(micStreamRef.current);
  };
  const { speakOnce, cancel: cancelSpeech } = useSpeechSynthesis(onNarrationEnd);

  // Whoever is on this page is the interviewee. End any recruiter login that
  // this browser is holding (e.g. a recruiter who clicked "Open" on their own
  // dashboard, or an on-site interview on a recruiter's machine) so the
  // candidate can't reach /admin from here — before, during or after the
  // interview. Recruiters simply log in again from a fresh tab.
  const { logout } = useAuth();
  useEffect(() => {
    logout();
  }, [logout]);

  useEffect(() => {
    if (!token) return;
    api
      .getInterviewByToken(token)
      .then((data) => {
        setInterview(data.interview);
        setTotalQuestions(data.interview.total_questions || 6);
        // Fixed at 2 retries for the whole interview, regardless of question
        // count. A stale interview record without retry_limit set also falls
        // back to 2, not a question-count-based number.
        const limit = data.interview.retry_limit ?? 2;
        setRetryLimit(limit);
        setRetriesRemaining(Math.max(0, limit - (data.interview.retries_used || 0)));
        // Pin this tab to the interview (also after it finishes) so the
        // candidate can't navigate to the recruiter login page or dashboard
        // (see lib/candidateSession.ts). The pin lasts until the tab closes.
        lockToInterview(token);
        setStage("consent");
      })
      .catch((err) => {
        setErrorMsg(err.message);
        setStage("error");
      });
  }, [token]);

  /** Fetches the next live question from the AI interviewer, or completes the interview if none remain. */
  const loadNextQuestion = async () => {
    setStage("fetching_question");
    try {
      const data = await api.getNextQuestion(token!);
      if (data.done) {
        // All live questions are answered — move on to the final practical
        // challenge (coding problem or riddle) before completing the interview.
        await loadChallenge();
        return;
      }
      setCurrentQuestion(data.question);
      setQuestionNumber(data.question_number);
      setTotalQuestions(data.total_questions || totalQuestions);
      resetTranscript();
      // Read the question aloud first; listening only begins once narration
      // finishes (see onNarrationEnd), so the candidate can't answer early.
      setStage("narrating");
      speakOnce(data.question.question_id, data.question.question_text);
    } catch (err: any) {
      setErrorMsg(err.message);
      setStage("error");
    }
  };

  /** Fetches (or generates) the final challenge, once all live questions are answered. */
  const loadChallenge = async () => {
    setStage("fetching_challenge");
    setErrorMsg(null);
    stopListening();
    stopSampling();
    stopDetectingObjects();
    stopNoiseDetection();

    try {
      // Keep the candidate in the protected interview environment for the
      // final challenge too.
      await enterFullscreen();

      const data = await api.generateChallenge(token!);
      const parts = data?.challenges && data.challenges.length >= 2 ? data.challenges : data?.challenge ? [data.challenge] : [];
      if (parts.length === 0 || !parts[0]?.challenge_id || !parts[0]?.prompt_text) {
        throw new Error("The final challenge could not be prepared. Please try again.");
      }

      setChallengeParts(parts);
      setChallengeIndex(0);
      setPaused(false);
      setViolationType(null);
      setStage("challenge");
    } catch (err: any) {
      setErrorMsg(err.message || "Could not load the final challenge.");
      setStage("error");
    }
  };

  // Start visual proctoring as soon as the live interview camera is mounted.
  // This intentionally includes narration: the candidate is already on camera
  // while the AI is asking the question, so a phone/person violation must not
  // be missed during that period. The detector itself waits until the video is
  // ready and keeps polling, so model/video loading races do not disable it.
  useEffect(() => {
    const visualProctoringActive = stage === "narrating" || stage === "in_progress" || stage === "challenge";
    if (!visualProctoringActive || paused) return;

    startSampling();
    startDetectingObjects();
    if (micStreamRef.current) startNoiseDetection(micStreamRef.current);

    return () => {
      stopSampling();
      stopDetectingObjects();
      stopNoiseDetection();
    };
  }, [stage, paused, startSampling, stopSampling, startDetectingObjects, startNoiseDetection, stopNoiseDetection]);

  const submitChallengeAnswer = async (payload: { language?: string; answer: string }) => {
    if (!challenge) return;
    setStage("submitting_challenge");
    try {
      await api.submitChallenge(token!, { challenge_id: challenge.challenge_id, ...payload });
      if (challengeIndex < challengeParts.length - 1) {
        // Move on to the second challenge part; stay in the proctored
        // challenge environment (webcam/proctoring effect re-runs for "challenge" stage).
        setChallengeIndex(challengeIndex + 1);
        setStage("challenge");
        return;
      }
      // Both parts submitted — complete the interview.
      stopSampling();
      stopDetectingObjects();
      stopNoiseDetection();
      await api.completeInterview(token!);
      setPaused(false);
      setViolationType(null);
      setStage("completed");
    } catch (err: any) {
      setErrorMsg(err.message);
      setStage("challenge"); // let the candidate retry the submission without losing their answer state
    }
  };

  const beginInterview = async () => {
    try {
      // Request camera/mic permission as part of the consent gesture. The
      // camera stream is only needed for this permission check (FaceAnalyzer
      // opens its own video-only stream), but the mic stream is kept alive
      // for the whole interview so useNoiseDetection can analyze it — no
      // extra permission prompt needed since it reuses this one grant.
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      const audioOnly = new MediaStream(stream.getAudioTracks());
      micStreamRef.current = audioOnly;
      await enterFullscreen();
      await api.startInterview(token!);
      await loadNextQuestion();
    } catch (err: any) {
      setErrorMsg("Camera/microphone permission is required to begin the interview.");
    }
  };

  const onResumeFromViolation = async () => {
    await enterFullscreen();
    await logResumeClicked();
    await api.resumeInterview(token!);
    setPaused(false);
    setViolationType(null);

    // Resume the browser proctoring/answer capture only during a live
    // interview question. The final challenge is also proctored, but it
    // does not use speech recognition.
    if (stage === "in_progress") {
      startListening();
      startSampling();
      startDetectingObjects();
      if (micStreamRef.current) startNoiseDetection(micStreamRef.current);
    }
  };

  const submitCurrentAnswer = async (forceSubmit = false) => {
    if (!currentQuestion) return;
    const trimmed = transcript.trim();
    const captureFailed = !forceSubmit && (trimmed.length < MIN_ANSWER_CHARS || !!speechError);
    if (captureFailed && retriesRemaining > 0) {
      stopListening();
      stopSampling();
      setRetryPromptVisible(true);
      return;
    }
    setRetryPromptVisible(false);
    setSubmitting(true);
    stopListening();
    stopSampling();
    try {
      const samples = getSamplesAndReset();
      await api.submitResponse(token!, {
        question_id: currentQuestion.question_id,
        transcript_text: transcript,
        answer_duration_sec: null,
        expression_samples: samples,
      });
      // The AI interviewer decides the next question live, based on this answer.
      await loadNextQuestion();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /** Consumes one retry (server-persisted, whole-interview) and restarts capture for the same question. */
  const handleRetryAnswer = async () => {
    setRetryPromptVisible(false);
    try {
      const res = await api.useAnswerRetry(token!);
      setRetriesRemaining(res.retries_remaining);
    } catch {
      // Retries were exhausted server-side (e.g. a race with another tab) — reflect that locally.
      setRetriesRemaining(0);
    }
    resetTranscript();
    startListening();
    startSampling();
    startDetectingObjects();
  };

  const handleSubmitAnyway = () => submitCurrentAnswer(true);

  if (stage === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-100">
        <div className="flex flex-col items-center gap-3 text-ink-500">
          <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-200 border-t-brand-600" />
          <span className="text-sm font-medium">Loading interview...</span>
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-100 px-6 text-center">
        <div className="max-w-sm rounded-2xl border border-red-100 bg-white p-8 shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <IconShield width={22} height={22} />
          </div>
          <h1 className="mb-2 text-lg font-bold text-ink-900">Unable to load interview</h1>
          <p className="text-sm text-ink-500">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (stage === "consent") {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-b from-ink-100 to-ink-150 px-6">
        <div className="w-full max-w-lg animate-fadeIn rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand">
            <IconLogo width={22} height={22} />
          </div>
          <h1 className="mb-2 font-display text-2xl font-semibold tracking-tight text-ink-900">
            Welcome, {interview?.candidate_name || "Candidate"}
          </h1>
          <p className="mb-6 text-[15px] leading-relaxed text-ink-500">
            This is a live AI-conducted HR interview. It requires camera and microphone access, and runs in
            fullscreen mode. Please don't switch tabs or exit fullscreen once started — these actions are recorded.
          </p>

          <div className="mb-7 space-y-3 rounded-xl border border-ink-150 bg-ink-50 p-4 text-left">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm">
                <IconMic width={14} height={14} />
              </div>
              <p className="text-sm text-ink-600">
                Around <strong className="font-semibold text-ink-800">{totalQuestions} questions</strong>, chosen
                live by the AI interviewer as the conversation goes
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm">
                <IconCamera width={14} height={14} />
              </div>
              <p className="text-sm text-ink-600">
                Spoken answers are transcribed live; facial expression analysis runs locally in your browser
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm">
                <IconShield width={14} height={14} />
              </div>
              <p className="text-sm text-ink-600">Fullscreen exits, tab switches, and window blur are logged</p>
            </div>
          </div>

          <div className="mb-7 rounded-xl border border-ink-150 bg-ink-50 p-4 text-left">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">Voice Answer Retry Policy</p>
            <p className="text-sm leading-relaxed text-ink-600">
              If your answer isn't clearly recorded because of microphone issues, background noise, or unclear
              audio, you may be given an option to retry. You have{" "}
              <strong className="font-semibold text-ink-800">
                {retryLimit} retr{retryLimit === 1 ? "y" : "ies"}
              </strong>{" "}
              shared across the entire interview — once they're used up, no additional retries will be available.
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{errorMsg}</div>
          )}
          <button
            onClick={beginInterview}
            className="w-full rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-6 py-3.5 font-semibold text-white shadow-brand transition-colors duration-150 hover:from-brand-500 hover:to-brand-600"
          >
            Enable Camera &amp; Start Interview
          </button>
        </div>
      </div>
    );
  }

  if (stage === "fetching_question") {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-100 text-ink-500">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-200 border-t-brand-600" />
          <div className="text-sm font-medium">The interviewer is thinking of the next question...</div>
        </div>
      </div>
    );
  }

  if (stage === "terminated") {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-100 px-6 text-center">
        <div className="max-w-sm animate-popIn rounded-2xl border border-red-100 bg-white p-8 shadow-card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
            <IconShield width={26} height={26} />
          </div>
          <h1 className="mb-2 font-display text-2xl font-semibold text-red-700">Interview Terminated</h1>
          <p className="text-ink-500">
            {terminationReason || "This interview was ended automatically after repeated proctoring violations."}
          </p>
        </div>
      </div>
    );
  }

  if (stage === "fetching_challenge") {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-100 text-ink-500">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-200 border-t-brand-600" />
          <div className="text-sm font-medium">Preparing your final challenge...</div>
        </div>
      </div>
    );
  }

  if (stage === "challenge" || stage === "submitting_challenge") {
    return (
      <div
        ref={containerRef}
        className="min-h-screen bg-gradient-to-b from-ink-100 to-ink-150 px-6 py-10"
      >
        <ProctoringOverlay
          visible={paused}
          violationType={violationType}
          warningCount={warningCount}
          maxWarnings={maxWarnings}
          terminated={false}
          onResume={onResumeFromViolation}
        />
        <ProctoringBanner warnings={softWarnings} />
        {liveWarning && (
          <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 shadow-lg">
            {liveWarning}
          </div>
        )}

        <div className="mx-auto max-w-4xl">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-500">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                <IconLogo width={13} height={13} />
              </span>
              AI HR Interview
            </div>
            <span className="text-xs font-medium text-ink-400">Final step</span>
          </div>
          <ProgressBar value={100} className="mb-6" />
          {errorMsg && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{errorMsg}</div>
          )}
          {challenge && (
            <ChallengeCard
              key={challenge.challenge_id}
              challenge={challenge}
              onSubmit={submitChallengeAnswer}
              submitting={stage === "submitting_challenge"}
            />
          )}
        </div>
        <FaceAnalyzer
          ref={videoRef}
          modelsLoaded={true}
          error={null}
          onCameraError={() => reportCameraStatus(false)}
          onCameraAvailable={() => reportCameraStatus(true)}
        />
      </div>
    );
  }

  if (stage === "completed") {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-100 px-6 text-center">
        <div className="max-w-sm animate-popIn rounded-2xl border border-emerald-100 bg-white p-8 shadow-card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <IconCheckCircle width={26} height={26} />
          </div>
          <h1 className="mb-2 font-display text-2xl font-semibold text-emerald-700">Interview Complete</h1>
          <p className="text-ink-500">Thank you — your responses have been submitted for review.</p>
        </div>
      </div>
    );
  }

  // narrating | in_progress
  return (
    <div ref={containerRef} className="min-h-screen bg-gradient-to-b from-ink-100 to-ink-150 px-6 py-10">
      <ProctoringOverlay
        visible={paused}
        violationType={violationType}
        warningCount={warningCount}
        maxWarnings={maxWarnings}
        terminated={false}
        onResume={onResumeFromViolation}
      />
      <ProctoringBanner warnings={softWarnings} />

      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-500">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <IconLogo width={13} height={13} />
            </span>
            AI HR Interview
          </div>
          <span className="text-xs font-medium text-ink-400">
            Question {questionNumber} of {totalQuestions}
          </span>
        </div>
        <ProgressBar value={(questionNumber / Math.max(totalQuestions, 1)) * 100} className="mb-6" />

        {currentQuestion && (
          <QuestionCard
            index={questionNumber}
            total={totalQuestions}
            questionText={currentQuestion.question_text}
            category={currentQuestion.category}
            liveTranscript={transcript}
            isListening={isListening}
            isNarrating={stage === "narrating"}
            onSubmit={() => submitCurrentAnswer()}
            submitting={submitting}
            retryPrompt={retryPromptVisible}
            retriesRemaining={retriesRemaining}
            onRetry={handleRetryAnswer}
            onSubmitAnyway={handleSubmitAnyway}
          />
        )}
      </div>

      <FaceAnalyzer
        ref={videoRef}
        modelsLoaded={true}
        error={null}
        onCameraError={() => reportCameraStatus(false)}
        onCameraAvailable={() => reportCameraStatus(true)}
      />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

// Name substrings that (best-effort, browser/OS-dependent) tend to indicate a
// female-sounding voice. Voice availability and naming varies a lot across
// Chrome/Edge/Safari/Firefox and OS — this is a heuristic, not a guarantee.
// See Phase 4 of the roadmap: this is "Option A" (free, browser-only,
// inconsistent quality). For a guaranteed consistent voice across every
// candidate/device, swap this hook for a cloud-TTS-backed implementation
// (ElevenLabs/Google/Azure) behind the same speakOnce/onEnd contract.
const FEMALE_VOICE_HINTS = [
  "female",
  "samantha", // macOS/iOS
  "zira", // Windows
  "susan",
  "victoria",
  "karen",
  "moira",
  "tessa",
  "fiona",
  "google uk english female",
  "google us english", // Google's default US voice is female-presenting
  "microsoft zira",
  "microsoft hazel",
  "aria", // Edge neural voice
];

/** Picks the best-effort "soft, professional, female" voice available in this
 * browser's speechSynthesis.getVoices() list, preferring English voices. */
function pickSoftFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;

  for (const hint of FEMALE_VOICE_HINTS) {
    const match = pool.find((v) => v.name.toLowerCase().includes(hint));
    if (match) return match;
  }
  // No confident match — fall back to the first English voice rather than
  // whatever the OS/browser defaults to (which is often male on some platforms).
  return pool[0] || null;
}

/**
 * Speaks interview questions aloud exactly once each, then calls back
 * when narration finishes so the caller can start listening for the
 * candidate's answer. Guards against re-speaking the same question on
 * re-renders (e.g. React StrictMode double-invocation) via an id-based
 * "already spoken" set.
 *
 * Voice: best-effort browser TTS voice selection (see FEMALE_VOICE_HINTS
 * above), with a slightly slower rate and softer pitch than the flat
 * rate=1/pitch=1 default, aiming for a "soft, professional" tone. Quality and
 * voice availability vary by the candidate's browser/OS/device — this cannot
 * guarantee an identical voice for every candidate.
 */
export function useSpeechSynthesis(onEnd: () => void) {
  const spokenRef = useRef<Set<string>>(new Set());
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;

    const loadVoice = () => {
      const voices = synth.getVoices();
      if (voices.length) setVoice(pickSoftFemaleVoice(voices));
    };

    loadVoice();
    // Some browsers (notably Chrome) populate getVoices() asynchronously —
    // voices may be empty on first call and only ready after this event fires.
    synth.addEventListener?.("voiceschanged", loadVoice);
    return () => {
      synth.removeEventListener?.("voiceschanged", loadVoice);
    };
  }, []);

  useEffect(() => {
    // Stop any in-flight narration if the component unmounts mid-question.
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speakOnce = useCallback(
    (id: string | number, text: string) => {
      const key = String(id);

      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        // Browser doesn't support speech synthesis — fail open so the
        // candidate isn't stuck waiting for narration that will never happen.
        onEndRef.current();
        return;
      }

      if (spokenRef.current.has(key)) return; // never re-read a question
      spokenRef.current.add(key);

      synth.cancel(); // clear any queued/lingering speech before starting fresh

      const utter = new SpeechSynthesisUtterance(text);
      if (voice) utter.voice = voice;
      // Slightly slower and softer than a flat rate=1/pitch=1 default, aiming
      // for a calmer, more professional read without sounding unnaturally slow.
      utter.rate = 0.95;
      utter.pitch = 0.92;
      utter.onend = () => onEndRef.current();
      utter.onerror = () => onEndRef.current(); // fail open rather than stranding the candidate

      synth.speak(utter);
    },
    [voice]
  );

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  return { speakOnce, cancel };
}

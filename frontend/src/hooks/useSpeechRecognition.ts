import { useCallback, useEffect, useRef, useState } from "react";

// Minimal ambient typing for the (still non-standard) Web Speech API.
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; [altIndex: number]: { transcript: string } };
  };
}

export type SpeechCaptureError = "no-speech" | "audio-capture" | "not-allowed" | "other" | null;

export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<SpeechCaptureError>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setSupported(false);
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          finalTranscriptRef.current += text + " ";
        } else {
          interim += text;
        }
      }
      setTranscript((finalTranscriptRef.current + interim).trim());
    };

    recognition.onerror = (e: any) => {
      console.warn("Speech recognition error:", e.error);
      // "no-speech" fires constantly during normal pauses in continuous mode,
      // so it isn't itself an unusable-answer signal — audio-capture and
      // not-allowed are the ones that mean we genuinely couldn't hear them.
      if (e.error === "audio-capture" || e.error === "not-allowed") {
        setError(e.error);
      } else if (e.error && e.error !== "no-speech" && e.error !== "aborted") {
        setError("other");
      }
    };

    recognition.onend = () => {
      // Auto-restart while the candidate is still meant to be answering,
      // since some browsers stop recognition after a period of silence.
      if (isListeningRef.current) {
        try {
          recognition.start();
        } catch {
          /* already started */
        }
      }
    };

    recognitionRef.current = recognition;
    return () => recognition.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isListeningRef = useRef(false);
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const start = useCallback(() => {
    if (!recognitionRef.current) return;
    finalTranscriptRef.current = "";
    setTranscript("");
    setError(null);
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {
      /* already started */
    }
  }, []);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    setIsListening(false);
    recognitionRef.current.stop();
  }, []);

  const reset = useCallback(() => {
    finalTranscriptRef.current = "";
    setTranscript("");
    setError(null);
  }, []);

  return { transcript, isListening, supported, error, start, stop, reset };
}

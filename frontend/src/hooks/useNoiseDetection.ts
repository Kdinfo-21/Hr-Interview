import { useCallback, useEffect, useRef, useState } from "react";

interface UseNoiseDetectionOptions {
  /** Called every sampling tick (~1-2s) with a normalized 0-1 RMS/volume level. */
  onLevel?: (level: number) => void;
  intervalMs?: number; // default 250ms
}

/**
 * Samples the candidate's mic input volume (RMS) client-side using the Web
 * Audio API, entirely from the existing getUserMedia({ audio: true }) stream
 * already captured for speech recognition — no new permissions or uploads.
 * Only a normalized level number is ever surfaced (via onLevel); raw audio
 * never leaves the browser and is never logged, consistent with the "no
 * frames/audio ever uploaded" approach already used for video proctoring.
 *
 * The caller (see useProctoring.reportNoiseLevel) is responsible for
 * debouncing sustained-high-level windows into an actual BACKGROUND_NOISE
 * proctoring event — this hook only reports the instantaneous level.
 */
export function useNoiseDetection({ onLevel, intervalMs = 250 }: UseNoiseDetectionOptions = {}) {
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const intervalRef = useRef<number | null>(null);
  const onLevelRef = useRef(onLevel);
  const recentLevelsRef = useRef<number[]>([]);
  onLevelRef.current = onLevel;

  useEffect(() => {
    const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      setSupported(false);
    }
  }, []);

  /** Attach to an existing mic MediaStream (e.g. the same one used for speech recognition/proctoring). */
  const start = useCallback(
    (stream: MediaStream) => {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) {
        setSupported(false);
        return;
      }
      try {
        const audioContext: AudioContext = new AudioContextCtor();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        sourceRef.current = source;

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        recentLevelsRef.current = [];

        intervalRef.current = window.setInterval(() => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(buffer);
          // RMS of the time-domain waveform, normalized roughly to 0-1
          // (silence sits near 0; loud/sustained noise pushes it higher).
          let sumSquares = 0;
          for (let i = 0; i < buffer.length; i++) {
            const normalized = (buffer[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / buffer.length);

          // Smooth short microphone fluctuations so a single loud spike does
          // not trigger the sustained-noise detector. With 250ms sampling and
          // an 8-sample window this represents roughly the last 2 seconds.
          const levels = recentLevelsRef.current;
          levels.push(rms);
          if (levels.length > 8) levels.shift();
          const smoothedRms = Math.sqrt(
            levels.reduce((sum, value) => sum + value * value, 0) / levels.length
          );

          onLevelRef.current?.(smoothedRms);
        }, intervalMs);
      } catch (err) {
        console.warn("Could not start background noise analysis:", err);
        setError("Could not analyze microphone input.");
      }
    },
    [intervalMs]
  );

  const stop = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    recentLevelsRef.current = [];
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { supported, error, start, stop };
}

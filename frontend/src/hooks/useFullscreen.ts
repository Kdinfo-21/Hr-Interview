import { useCallback, useEffect, useState } from "react";

export function useFullscreen(targetRef?: React.RefObject<HTMLElement>) {
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const enter = useCallback(async () => {
    const el = targetRef?.current || document.documentElement;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      }
    } catch (err) {
      console.error("Failed to enter fullscreen:", err);
    }
  }, [targetRef]);

  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Failed to exit fullscreen:", err);
    }
  }, []);

  return { isFullscreen, enter, exit };
}

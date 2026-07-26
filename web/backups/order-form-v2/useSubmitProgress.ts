import { useEffect, useRef, useState } from 'react';

/** Estimated submit duration for progress UI (outlet + order + line items). */
const ESTIMATE_SEC = 12;

export function useSubmitProgress(isSubmitting: boolean) {
  const [progress, setProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [visible, setVisible] = useState(false);
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (isSubmitting) {
      wasSubmitting.current = true;
      setVisible(true);
      setProgress(4);
      setSecondsLeft(ESTIMATE_SEC);
      const start = Date.now();

      const tick = window.setInterval(() => {
        const elapsedSec = (Date.now() - start) / 1000;
        setProgress(Math.min(92, 4 + (elapsedSec / ESTIMATE_SEC) * 88));
        setSecondsLeft(Math.max(0, Math.ceil(ESTIMATE_SEC - elapsedSec)));
      }, 80);

      return () => window.clearInterval(tick);
    }

    if (wasSubmitting.current) {
      wasSubmitting.current = false;
      setProgress(100);
      setSecondsLeft(0);
      const hide = window.setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 500);
      return () => window.clearTimeout(hide);
    }

    return undefined;
  }, [isSubmitting]);

  const phase =
    progress < 35 ? 'Validating order…' : progress < 70 ? 'Saving to server…' : 'Finalizing draft…';

  return {
    visible: visible || isSubmitting,
    progress,
    secondsLeft,
    phase,
    estimateSec: ESTIMATE_SEC,
  };
}

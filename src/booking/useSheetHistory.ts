// System Back (Android gesture, browser back button) steps back inside an open sheet flow or closes it,
// instead of leaving the page. Exactly one history entry is held while the flow is open.
import { useEffect, useRef } from 'react';

/**
 * @param isOpen  whether the sheet flow is open
 * @param onBack  handle a Back press; return true if the flow is still open afterwards
 */
export function useSheetHistory(isOpen: boolean, onBack: () => boolean) {
  const pushed = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isOpen) {
      if (pushed.current) {
        // closed by a button: drop our entry so Back behaves normally afterwards
        pushed.current = false;
        if ((history.state as { sheet?: boolean } | null)?.sheet) history.back();
      }
      return;
    }
    if (!pushed.current) {
      history.pushState({ ...((history.state as object | null) ?? {}), sheet: true }, '');
      pushed.current = true;
    }
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      const stillOpen = onBackRef.current();
      if (stillOpen) {
        history.pushState({ ...((history.state as object | null) ?? {}), sheet: true }, '');
        pushed.current = true;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isOpen]);
}

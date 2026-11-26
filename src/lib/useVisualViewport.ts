import { useEffect, useState } from "react";

interface VisualViewportState {
  keyboardOpen: boolean;
}

/**
 * Locks the mobile app shell cleanly to window.visualViewport on iOS Safari
 * and Home-Screen PWAs so opening the software keyboard never drags the header
 * off-screen or leaves stale viewport offset drift.
 */
export function useVisualViewport(): VisualViewportState {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let rafId = 0;

    const syncNow = () => {
      rafId = 0;
      const height = vv ? Math.round(vv.height) : window.innerHeight;
      const offsetTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;

      root.style.setProperty("--vvh", `${height}px`);
      root.style.setProperty("--vvt", `${offsetTop}px`);

      const kbOpen = window.innerHeight - height > 110;
      setKeyboardOpen(kbOpen);
      root.classList.toggle("kb-open", kbOpen);

      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    const scheduleSync = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncNow);
    };

    const handleFocusChange = () => {
      scheduleSync();
      // iOS keyboard animation settles over ~250ms; re-sync once settled
      window.setTimeout(scheduleSync, 120);
      window.setTimeout(scheduleSync, 320);
    };

    syncNow();

    if (vv) {
      vv.addEventListener("resize", scheduleSync);
      vv.addEventListener("scroll", scheduleSync);
    }
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("focusin", handleFocusChange);
    window.addEventListener("focusout", handleFocusChange);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (vv) {
        vv.removeEventListener("resize", scheduleSync);
        vv.removeEventListener("scroll", scheduleSync);
      }
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.removeEventListener("focusin", handleFocusChange);
      window.removeEventListener("focusout", handleFocusChange);
      root.classList.remove("kb-open");
    };
  }, []);

  return { keyboardOpen };
}

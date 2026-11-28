import { useEffect, useState } from "react";

interface VisualViewportState {
  keyboardOpen: boolean;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["file", "checkbox", "radio", "button", "submit"].includes(el.type);
  }
  return false;
}

/**
 * Tracks a stable full-screen baseline height per orientation so iOS 16–26
 * Safari (where window.innerHeight can shrink alongside visualViewport) still
 * detects the software keyboard reliably, while keeping Home-Screen PWAs
 * full-bleed (100% height, zero bottom gap) when the keyboard is closed.
 */
export function useVisualViewport(): VisualViewportState {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let rafId = 0;
    let caretTimers: number[] = [];
    let lastKbOpen = false;
    let lastVvHeight = 0;
    let lastVvOffsetTop = 0;
    let lastIsLandscape = window.innerWidth > window.innerHeight;
    let baselineHeight = Math.max(
      window.innerHeight,
      vv ? Math.round(vv.height) : 0
    );

    // Forces iOS Safari / WKWebView to re-anchor the native blue text caret
    // after `--vvh` / `--vvt` shifts the composer above the software keyboard.
    const realignFocusedCaret = () => {
      const el = document.activeElement;
      if (
        !(el instanceof HTMLTextAreaElement) &&
        !(
          el instanceof HTMLInputElement &&
          !["file", "checkbox", "radio", "button", "submit"].includes(el.type)
        )
      ) {
        return;
      }
      try {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const prevTransform = el.style.transform;
        el.style.transform = "translateZ(0.01px)";
        void el.offsetHeight;
        el.style.transform = prevTransform;
        if (typeof start === "number" && typeof end === "number") {
          el.setSelectionRange(start, end);
        }
      } catch {
        // Ignore inputs that don't support setSelectionRange
      }
    };

    const scheduleCaretRealign = () => {
      for (const id of caretTimers) window.clearTimeout(id);
      caretTimers = [];
      requestAnimationFrame(realignFocusedCaret);
      for (const delay of [80, 220, 380]) {
        caretTimers.push(window.setTimeout(realignFocusedCaret, delay));
      }
    };

    const resetViewportZoomIfNeeded = () => {
      if (vv && Math.abs((vv.scale || 1) - 1) > 0.02) {
        const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
        if (meta) {
          meta.setAttribute(
            "content",
            "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
          );
        }
      }
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    const syncNow = () => {
      rafId = 0;
      const isLandscape = window.innerWidth > window.innerHeight;
      const vvHeight = vv ? Math.round(vv.height) : window.innerHeight;
      const vvOffsetTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      const focused = isTextInputFocused();

      // Immediately reset baseline when orientation changes so portrait -> landscape
      // height drop is never mistaken for an open keyboard.
      if (isLandscape !== lastIsLandscape) {
        lastIsLandscape = isLandscape;
        baselineHeight = Math.max(window.innerHeight, vvHeight);
        resetViewportZoomIfNeeded();
      } else if (!focused) {
        // Update baseline only when no text input is focused (keyboard closed)
        baselineHeight = Math.max(baselineHeight, window.innerHeight, vvHeight);
      }

      const delta = baselineHeight - vvHeight;
      const kbOpen = delta > 110 || (focused && delta > 60);

      setKeyboardOpen(kbOpen);
      root.classList.toggle("kb-open", kbOpen);

      if (kbOpen) {
        root.style.setProperty("--vvh", `${vvHeight}px`);
        root.style.setProperty("--vvt", `${vvOffsetTop}px`);
      } else {
        root.style.setProperty("--vvh", "100%");
        root.style.setProperty("--vvt", "0px");
      }

      if (
        kbOpen !== lastKbOpen ||
        (kbOpen && (vvHeight !== lastVvHeight || vvOffsetTop !== lastVvOffsetTop))
      ) {
        const openedNow = kbOpen && !lastKbOpen;
        lastKbOpen = kbOpen;
        lastVvHeight = vvHeight;
        lastVvOffsetTop = vvOffsetTop;
        window.dispatchEvent(
          new CustomEvent("hp:viewport-change", {
            detail: { keyboardOpen: kbOpen, openedNow, height: vvHeight },
          })
        );
        if (kbOpen && focused) {
          scheduleCaretRealign();
        }
      }

      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
        if (kbOpen && focused) {
          scheduleCaretRealign();
        }
      }
    };

    const scheduleSync = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncNow);
    };

    const orientationTimers: number[] = [];
    const handleOrientation = () => {
      for (const id of orientationTimers) window.clearTimeout(id);
      orientationTimers.length = 0;
      lastIsLandscape = window.innerWidth > window.innerHeight;
      baselineHeight = Math.max(window.innerHeight, vv ? Math.round(vv.height) : 0);
      resetViewportZoomIfNeeded();
      scheduleSync();
      for (const delay of [120, 300, 500]) {
        orientationTimers.push(
          window.setTimeout(() => {
            lastIsLandscape = window.innerWidth > window.innerHeight;
            baselineHeight = Math.max(window.innerHeight, vv ? Math.round(vv.height) : 0);
            resetViewportZoomIfNeeded();
            scheduleSync();
          }, delay)
        );
      }
    };

    const handleFocusChange = () => {
      scheduleSync();
      window.setTimeout(scheduleSync, 100);
      window.setTimeout(scheduleSync, 260);
      window.setTimeout(scheduleSync, 450);
    };

    syncNow();

    if (vv) {
      vv.addEventListener("resize", scheduleSync);
      vv.addEventListener("scroll", scheduleSync);
    }
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", handleOrientation);
    screen.orientation?.addEventListener?.("change", handleOrientation);
    window.addEventListener("focusin", handleFocusChange);
    window.addEventListener("focusout", handleFocusChange);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      for (const id of orientationTimers) window.clearTimeout(id);
      for (const id of caretTimers) window.clearTimeout(id);
      if (vv) {
        vv.removeEventListener("resize", scheduleSync);
        vv.removeEventListener("scroll", scheduleSync);
      }
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", handleOrientation);
      screen.orientation?.removeEventListener?.("change", handleOrientation);
      window.removeEventListener("focusin", handleFocusChange);
      window.removeEventListener("focusout", handleFocusChange);
      root.classList.remove("kb-open");
    };
  }, []);

  return { keyboardOpen };
}

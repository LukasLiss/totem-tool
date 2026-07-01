import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * TOTeM launch splash animation.
 *
 * Plays the "Temporal Object Type Model / Tool" → TOTeM wordmark → interleaved
 * two-T logo sequence (~5.5s at speed=1), then calls `onComplete`. Esc or any
 * click skips. Respects `prefers-reduced-motion`. Theme follows the existing
 * `--background` / `--foreground` tokens — no hard-coded colors.
 *
 * The animation matches the design handoff in
 * `design_handoff_splash_animation/README.md`. Per-letter positions are
 * measured at runtime; do not hard-code letter offsets.
 */

interface SplashAnimationProps {
  onComplete: () => void;
}

const LINE1_TEXT = "Temporal Object Type Model";
const LINE2_TEXT = "Tool";
/** Indices of T, O, T, e, M inside "Temporal Object Type Model". */
const KEEP_IDX = [0, 9, 16, 19, 21] as const;

/** ms timings before any speed multiplier. Mirrors the README table. */
const STAGGER_PER_CHAR = 28;
const FADE_IN_DUR = 600;
const HOLD_FULL = 480;
const MORPH_DUR = 1100;
const HOLD_TOTEM = 600;
const FADE_OTHER_DUR = 450;
const LOGO_DUR = 1300;
const HOLD_LOGO = 1400;

const BASE_FONT_SIZE = 56;
const BASE_LETTER_SPACING = "-0.015em";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

interface MeasuredChar {
  x: number;
  w: number;
  text: string;
}

interface LineMeasurement {
  totalW: number;
  positions: MeasuredChar[];
}

function measureLine(
  text: string,
  fontSize: number,
  fontWeight: number,
  letterSpacing: string,
): LineMeasurement {
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    position: absolute; left: -9999px; top: 0; visibility: hidden;
    white-space: nowrap; font-family: Inter, system-ui, sans-serif;
    font-size: ${fontSize}px; font-weight: ${fontWeight};
    letter-spacing: ${letterSpacing};
    font-feature-settings: "ss01", "cv11";
  `;
  document.body.appendChild(wrap);
  const chars: HTMLSpanElement[] = [];
  for (const ch of text) {
    const s = document.createElement("span");
    s.style.display = "inline-block";
    s.textContent = ch === " " ? " " : ch;
    wrap.appendChild(s);
    chars.push(s);
  }
  // Force layout.
  wrap.getBoundingClientRect();
  const totalW = wrap.offsetWidth;
  const positions: MeasuredChar[] = chars.map((c) => ({
    x: c.offsetLeft,
    w: c.offsetWidth,
    text: c.textContent === " " ? " " : (c.textContent ?? ""),
  }));
  document.body.removeChild(wrap);
  return { totalW, positions };
}

export function SplashAnimation({ onComplete }: SplashAnimationProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useLayoutEffect(() => {
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    let completed = false;
    const done = () => {
      if (completed) return;
      completed = true;
      try {
        completeRef.current();
      } catch {
        /* swallow — splash must always tear down */
      }
    };

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Hard safety: even if something in the timeline silently fails, ensure
    // the splash always tears down within a bounded time.
    const safety = window.setTimeout(done, reducedMotion ? 1500 : 6500);

    const cleanup = () => {
      ctrl.abort();
      window.clearTimeout(safety);
    };

    const handleSkip = () => {
      cleanup();
      done();
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSkip();
    };
    window.addEventListener("keydown", handleKey);
    const overlay = overlayRef.current;
    overlay?.addEventListener("pointerdown", handleSkip);

    const run = async () => {
      try {
        // Wait for Inter to actually load — measuring before that yields wrong widths.
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        if (signal.aborted) return;

        const stage = stageRef.current;
        if (!stage) return;
        stage.innerHTML = "";

        const stageW = stage.offsetWidth;
        const stageH = stage.offsetHeight;
        const centerX = stageW / 2;
        const centerY = stageH / 2;

        const m1 = measureLine(
          LINE1_TEXT,
          BASE_FONT_SIZE,
          500,
          BASE_LETTER_SPACING,
        );
        const m2 = measureLine(
          LINE2_TEXT,
          BASE_FONT_SIZE,
          500,
          BASE_LETTER_SPACING,
        );

        const line1Y = centerY - 50;
        const line2Y = centerY + 22;
        const line1X = centerX - m1.totalW / 2;
        const line2X = centerX - m2.totalW / 2;

        const makeChar = (text: string, x: number, y: number) => {
          const el = document.createElement("span");
          el.className = "totem-splash-char";
          el.textContent = text === " " ? " " : text;
          el.style.left = x + "px";
          el.style.top = y + "px";
          stage.appendChild(el);
          return el;
        };

        const line1Chars = m1.positions.map((p) =>
          makeChar(p.text, line1X + p.x, line1Y),
        );
        const line2Chars = m2.positions.map((p) =>
          makeChar(p.text, line2X + p.x, line2Y),
        );
        const allChars = [...line1Chars, ...line2Chars];

        const setTransitionVars = (
          ch: HTMLSpanElement,
          posMs: number,
          fadeMs: number,
        ) => {
          ch.style.setProperty("--t-pos", posMs + "ms");
          ch.style.setProperty("--t-fade", fadeMs + "ms");
        };
        allChars.forEach((c) => setTransitionVars(c, MORPH_DUR, FADE_IN_DUR));

        // Reduced motion: skip the per-letter choreography, just fade the
        // final TOTeM mark in and dismiss.
        if (reducedMotion) {
          // Drop all sentence chars; keep the kept indices + Tool's first T,
          // jump them straight to the final logo position.
          line1Chars.forEach((c, i) => {
            if (!KEEP_IDX.includes(i as (typeof KEEP_IDX)[number])) {
              c.style.display = "none";
            }
          });
          line2Chars.forEach((c, i) => {
            if (i !== 0) c.style.display = "none";
          });

          const LOGO_SIZE = Math.min(stageW * 0.28, stageH * 0.55, 280);
          const fontSize = Math.round(LOGO_SIZE);
          const tMeasure = measureLine("T", fontSize, 700, "-0.04em");
          const tW = tMeasure.positions[0].w;
          const tH = fontSize;
          const offX = tW * 0.62;
          const offY = tH * 0.4;
          const lockupW = tW + offX;
          const lockupH = tH + offY;
          const lockupX = centerX - lockupW / 2;
          const lockupY = centerY - lockupH / 2 - tH * 0.05;

          const T1 = line1Chars[0];
          const T2 = line2Chars[0];
          // Hide OTeM since we don't have the choreography to fade them.
          KEEP_IDX.slice(1).forEach(
            (i) => (line1Chars[i].style.display = "none"),
          );

          [T1, T2].forEach((c) => {
            c.style.transition = "opacity 300ms ease";
            c.style.fontSize = fontSize + "px";
            c.style.fontWeight = "700";
            c.style.letterSpacing = "-0.04em";
            c.style.transform = "none";
          });
          T1.style.left = lockupX + "px";
          T1.style.top = lockupY + "px";
          T2.style.left = lockupX + offX + "px";
          T2.style.top = lockupY + offY + "px";

          // Trigger fade-in.
          requestAnimationFrame(() => {
            T1.style.opacity = "1";
            T2.style.opacity = "1";
          });

          await sleep(300 + 800, signal);
          cleanup();
          done();
          return;
        }

        // ---- PHASE 1 — stagger reveal ---------------------------------
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const revealList = [
          ...line1Chars.map((c, i) => ({ c, t: i * STAGGER_PER_CHAR })),
          ...line2Chars.map((c, i) => ({
            c,
            t:
              line1Chars.length * STAGGER_PER_CHAR +
              100 +
              i * STAGGER_PER_CHAR * 1.4,
          })),
        ];
        const revealTimeouts: number[] = [];
        revealList.forEach(({ c, t }) => {
          const id = window.setTimeout(() => {
            if (signal.aborted) return;
            c.style.opacity = "1";
            c.style.transform = "translateY(0)";
          }, t);
          revealTimeouts.push(id);
        });
        signal.addEventListener(
          "abort",
          () => revealTimeouts.forEach((id) => window.clearTimeout(id)),
          { once: true },
        );

        const lastReveal = revealList[revealList.length - 1].t;
        const fadeInEnd = lastReveal + FADE_IN_DUR;
        await sleep(fadeInEnd + HOLD_FULL, signal);

        // ---- PHASE 2 — morph to TOTeM ---------------------------------
        const keptWidths = KEEP_IDX.map((i) => m1.positions[i].w);
        const totemWidth = keptWidths.reduce((a, b) => a + b, 0);
        const totemStart = centerX - totemWidth / 2;
        const compactX: Record<number, number> = {};
        {
          let cur = totemStart;
          KEEP_IDX.forEach((idx, k) => {
            compactX[idx] = cur;
            cur += keptWidths[k];
          });
        }

        allChars.forEach((c) =>
          setTransitionVars(c, MORPH_DUR, FADE_OTHER_DUR),
        );

        line1Chars.forEach((c, i) => {
          if (KEEP_IDX.includes(i as (typeof KEEP_IDX)[number])) {
            c.style.left = compactX[i] + "px";
          } else {
            const curX = parseFloat(c.style.left);
            const distFactor = i / line1Chars.length;
            const delay = distFactor * 120;
            c.style.transitionDelay =
              `${delay}ms, ${delay}ms, ${delay}ms, ${delay}ms`;
            c.style.left = curX - 180 + "px";
            c.style.opacity = "0";
          }
        });

        await sleep(MORPH_DUR + HOLD_TOTEM, signal);
        allChars.forEach((c) => {
          c.style.transitionDelay = "";
        });

        // ---- PHASE 3 — fade siblings ----------------------------------
        const T1 = line1Chars[0];
        const T2 = line2Chars[0];
        KEEP_IDX.slice(1).forEach((i) => {
          line1Chars[i].style.opacity = "0";
        });
        for (let i = 1; i < line2Chars.length; i++) {
          line2Chars[i].style.opacity = "0";
        }
        await sleep(FADE_OTHER_DUR + 80, signal);

        // ---- PHASE 4 — logo lock-up -----------------------------------
        const LOGO_SIZE = Math.min(stageW * 0.28, stageH * 0.55, 280);
        const fontSize = Math.round(LOGO_SIZE);
        const tMeasure = measureLine("T", fontSize, 700, "-0.04em");
        const tW = tMeasure.positions[0].w;
        const tH = fontSize;

        const offX = tW * 0.62;
        const offY = tH * 0.4;
        const lockupW = tW + offX;
        const lockupH = tH + offY;
        const lockupX = centerX - lockupW / 2;
        const lockupY = centerY - lockupH / 2 - tH * 0.05;

        // Custom "settle" easing on the lock-up transition.
        [T1, T2].forEach((c) => {
          c.style.transition =
            `left ${LOGO_DUR}ms cubic-bezier(0.5, 0, 0.15, 1),` +
            `top ${LOGO_DUR}ms cubic-bezier(0.5, 0, 0.15, 1),` +
            `font-size ${LOGO_DUR}ms cubic-bezier(0.5, 0, 0.15, 1),` +
            `font-weight 600ms ease,` +
            `letter-spacing ${LOGO_DUR}ms ease,` +
            `opacity 400ms ease,` +
            `transform ${LOGO_DUR}ms cubic-bezier(0.5, 0, 0.15, 1),` +
            `color 400ms ease`;
        });

        T1.style.fontSize = fontSize + "px";
        T1.style.fontWeight = "700";
        T1.style.letterSpacing = "-0.04em";
        T1.style.left = lockupX + "px";
        T1.style.top = lockupY + "px";

        T2.style.fontSize = fontSize + "px";
        T2.style.fontWeight = "700";
        T2.style.letterSpacing = "-0.04em";
        T2.style.left = lockupX + offX + "px";
        T2.style.top = lockupY + offY + "px";

        await sleep(LOGO_DUR + HOLD_LOGO, signal);

        // ---- PHASE 5 — fade overlay out and complete ------------------
        const overlayEl = overlayRef.current;
        if (overlayEl) {
          overlayEl.style.transition = "opacity 320ms ease";
          overlayEl.style.opacity = "0";
        }
        await sleep(340, signal);

        cleanup();
        done();
      } catch (err) {
        if (
          err instanceof DOMException &&
          (err.name === "AbortError" || err.message === "aborted")
        ) {
          return;
        }
        // Don't strand the user on the splash if something unexpected blew up.
        // eslint-disable-next-line no-console
        console.warn("[SplashAnimation] aborted by error:", err);
        cleanup();
        done();
      }
    };

    run();

    return () => {
      window.removeEventListener("keydown", handleKey);
      overlay?.removeEventListener("pointerdown", handleSkip);
      cleanup();
    };
  }, []);

  // Fade the "press Esc to skip" hint in after the reveal settles.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const el = hintRef.current;
      if (el) el.style.opacity = "0.65";
    }, 1800);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="totem-splash-root"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--background)",
        color: "var(--foreground)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        userSelect: "none",
        cursor: "pointer",
        WebkitFontSmoothing: "antialiased",
        fontFeatureSettings: '"ss01", "cv11"',
        transition: "background 400ms ease, color 400ms ease",
      }}
    >
      <style>{`
        .totem-splash-root .totem-splash-char {
          position: absolute;
          display: inline-block;
          font-family: Inter, system-ui, -apple-system, sans-serif;
          font-size: ${BASE_FONT_SIZE}px;
          font-weight: 500;
          letter-spacing: ${BASE_LETTER_SPACING};
          line-height: 1;
          color: var(--foreground);
          opacity: 0;
          transform: translateY(14px);
          white-space: pre;
          will-change: left, top, opacity, transform, font-size, font-weight;
          transition:
            left   var(--t-pos, ${MORPH_DUR}ms) cubic-bezier(0.7, 0, 0.18, 1)   var(--d, 0ms),
            top    var(--t-pos, ${MORPH_DUR}ms) cubic-bezier(0.7, 0, 0.18, 1)   var(--d, 0ms),
            opacity var(--t-fade, ${FADE_IN_DUR}ms) cubic-bezier(0.4, 0, 0.2, 1) var(--d, 0ms),
            transform var(--t-pos, ${MORPH_DUR}ms) cubic-bezier(0.7, 0, 0.18, 1) var(--d, 0ms),
            font-size var(--t-pos, ${MORPH_DUR}ms) cubic-bezier(0.55, 0, 0.15, 1) var(--d, 0ms),
            font-weight 700ms ease var(--d, 0ms),
            letter-spacing var(--t-pos, ${MORPH_DUR}ms) ease var(--d, 0ms),
            color 400ms ease;
        }
      `}</style>
      <div
        ref={stageRef}
        style={{
          position: "relative",
          width: "min(1100px, 96vw)",
          height: "min(560px, 80vh)",
        }}
      />
      <div
        ref={hintRef}
        style={{
          position: "absolute",
          bottom: 20,
          left: 20,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          color: "var(--muted-foreground)",
          letterSpacing: "0.02em",
          opacity: 0,
          transition: "opacity 600ms ease",
          pointerEvents: "none",
        }}
      >
        press Esc to skip
      </div>
    </div>
  );
}

export default SplashAnimation;

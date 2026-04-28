/**
 * Halftone audio visualizer.
 *
 * Mounts on a <canvas> overlaid on the player visual. Reads the audio element's
 * frequency spectrum via Web Audio API and paints a dot grid where each dot's
 * size scales with that band's amplitude. Looks like an old radio's signal-
 * strength meter from the reference designs.
 */

let _audioCtx = null;
let _analyser = null;
let _audioSource = null;
let _audioBoundEl = null;
let _rafId = null;

const COLS = 48;
const ROWS = 14;

export function attachHalftone(canvas, audioEl) {
  if (!canvas || !audioEl) return;

  // Reuse the AudioContext across song changes — browsers cap how many you can
  // create. If the audio element changes, we just disconnect and re-attach.
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return; // no Web Audio support — silently bail
  }

  if (_audioBoundEl !== audioEl) {
    if (_audioSource) try { _audioSource.disconnect(); } catch {}
    try {
      _audioSource = _audioCtx.createMediaElementSource(audioEl);
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 128;
      _analyser.smoothingTimeConstant = 0.78;
      _audioSource.connect(_analyser);
      _analyser.connect(_audioCtx.destination);
      _audioBoundEl = audioEl;
    } catch (e) {
      // CORS or already-connected error — bail silently, viz just won't run
      return;
    }
  }

  audioEl.addEventListener("play", () => {
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    startLoop(canvas);
  });
  audioEl.addEventListener("pause", () => stopLoop());
  audioEl.addEventListener("ended", () => stopLoop());

  // Resize canvas to match its CSS box
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
  };
  resize();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
  }

  // Start immediately if audio is already playing
  if (!audioEl.paused) startLoop(canvas);
}

function startLoop(canvas) {
  if (_rafId) return;
  const data = new Uint8Array(_analyser.frequencyBinCount);
  const ctx = canvas.getContext("2d");
  const tick = () => {
    _analyser.getByteFrequencyData(data);
    paint(ctx, canvas, data);
    _rafId = requestAnimationFrame(tick);
  };
  _rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = null;
}

function paint(ctx, canvas, freq) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cellW = W / COLS;
  const cellH = H / ROWS;
  const radiusMax = Math.min(cellW, cellH) * 0.45;
  const bins = freq.length;

  for (let c = 0; c < COLS; c++) {
    // Frequency band per column (low→high). Use exponential-ish scale.
    const t = c / (COLS - 1);
    const binIdx = Math.floor(Math.pow(t, 1.4) * (bins - 1));
    const v = freq[binIdx] / 255; // 0..1

    // Each row above the baseline gets a dot if v exceeds threshold.
    // Bottom rows always lit (forms the bottom-anchored "EQ pyramid" feel
    // from the reference image).
    const filledRows = Math.round(v * ROWS);
    for (let r = 0; r < ROWS; r++) {
      const fromBottom = ROWS - 1 - r;
      const isLit = fromBottom < filledRows;
      const cx = (c + 0.5) * cellW;
      const cy = (r + 0.5) * cellH;
      const dist = Math.abs(fromBottom - filledRows / 2) / Math.max(filledRows, 1);
      const radius = isLit
        ? radiusMax * (0.6 + 0.4 * (1 - dist))
        : radiusMax * 0.18;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (isLit) {
        ctx.fillStyle = "rgba(14,14,14,0.85)";
      } else {
        ctx.fillStyle = "rgba(14,14,14,0.18)";
      }
      ctx.fill();
    }
  }
}

export function detachHalftone() {
  stopLoop();
}

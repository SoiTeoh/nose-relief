import './style.css';
import { tuning } from './config/tuning';
import { SoundEngine } from './game/audio';
import { NoseReliefWorld } from './game/world';
import { drawGameFrame } from './render/painter';

const BEST_SCORE_KEY = 'nose_relief_best_score_v1';

function readBestScore(): number {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeBestScore(score: number): void {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(Math.max(0, Math.floor(score))));
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

function hitRect(
  pt: { x: number; y: number },
  btn: { x: number; y: number; w: number; h: number },
): boolean {
  return Math.abs(pt.x - btn.x) <= btn.w / 2 + 4 && Math.abs(pt.y - btn.y) <= btn.h / 2 + 4;
}

function main(): void {
  const canvasEl = document.getElementById('stage');
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #stage not found');
  }
  const maybeCtx = canvasEl.getContext('2d');
  if (!maybeCtx) {
    throw new Error('2D rendering context unavailable');
  }
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get('debug') === '1';

  const sound = new SoundEngine();
  let world = new NoseReliefWorld(tuning);
  let bestScore = readBestScore();
  let screenMode: 'title' | 'playing' | 'result' = 'title';
  let animTimeSec = 0;

  let rubPointerId: number | null = null;
  let lastRubPt: { x: number; y: number } | null = null;
  let blowPointerId: number | null = null;
  let spaceHeld = false;
  let dpr = 1;

  function resizeCanvas(): void {
    const vw = Math.max(240, window.innerWidth);
    const vh = Math.max(320, window.innerHeight);
    const aspect = tuning.view.width / tuning.view.height;

    let cssWidth = vw;
    let cssHeight = cssWidth / aspect;
    if (cssHeight > vh) {
      cssHeight = vh;
      cssWidth = cssHeight * aspect;
    }

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${Math.floor(cssWidth)}px`;
    canvas.style.height = `${Math.floor(cssHeight)}px`;
    canvas.width = Math.round(tuning.view.width * dpr);
    canvas.height = Math.round(tuning.view.height * dpr);
  }

  function toLogicalCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const rx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const ry = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    return {
      x: Math.max(0, Math.min(tuning.view.width, rx * tuning.view.width)),
      y: Math.max(0, Math.min(tuning.view.height, ry * tuning.view.height)),
    };
  }

  function clearInputs(): void {
    rubPointerId = null;
    lastRubPt = null;
    blowPointerId = null;
    spaceHeld = false;
    world.blowHolding = false;
    world.blowHoldSec = 0;
  }

  function startNewGame(): void {
    sound.unlock();
    world = new NoseReliefWorld(tuning);
    clearInputs();
    screenMode = 'playing';
  }

  function performBlowRelease(): void {
    if (!world.blowHolding) return;
    const quality = world.releaseBlow();
    sound.playBlow(quality === 'golden', false);
  }

  function onPointerDown(e: PointerEvent): void {
    sound.unlock();
    const pt = toLogicalCoords(e.clientX, e.clientY);

    if (screenMode === 'title') {
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 422 && pt.y <= 474) {
        startNewGame();
      }
      return;
    }

    if (screenMode === 'result') {
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 446 && pt.y <= 498) {
        startNewGame();
      }
      return;
    }

    // Mute toggle
    if (Math.hypot(pt.x - (tuning.view.width - 36), pt.y - 38) <= 20) {
      sound.muted = !sound.muted;
      return;
    }

    // Bottom 3 buttons
    if (hitRect(pt, tuning.buttons.spray)) {
      if (world.triggerSpray()) sound.playSpray();
      return;
    }
    if (hitRect(pt, tuning.buttons.mint)) {
      if (world.triggerMintBomb()) sound.playMint();
      return;
    }
    if (hitRect(pt, tuning.buttons.blow)) {
      blowPointerId = e.pointerId;
      world.blowHolding = true;
      world.blowHoldSec = 0;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic events
      }
      return;
    }

    // Direct rub/swipe inside nasal passages (y < 515)
    if (pt.y < 515) {
      rubPointerId = e.pointerId;
      lastRubPt = pt;
      if (world.applyRub(pt.x, pt.y, 0, 12)) {
        sound.playSquish();
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic events
      }
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (screenMode !== 'playing' || rubPointerId !== e.pointerId || !lastRubPt) return;
    const pt = toLogicalCoords(e.clientX, e.clientY);
    const dx = pt.x - lastRubPt.x;
    const dy = pt.y - lastRubPt.y;
    lastRubPt = pt;
    if (Math.hypot(dx, dy) > 2 && world.applyRub(pt.x, pt.y, dx, dy)) {
      sound.playSquish();
    }
  }

  function onPointerEnd(e: PointerEvent): void {
    if (e.pointerId === rubPointerId) {
      rubPointerId = null;
      lastRubPt = null;
    }
    if (e.pointerId === blowPointerId) {
      blowPointerId = null;
      performBlowRelease();
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
      e.preventDefault();
    }

    if (screenMode === 'title' && (e.code === 'Space' || e.code === 'Enter')) {
      startNewGame();
      return;
    }

    if (screenMode === 'result' && (e.code === 'KeyR' || e.code === 'Enter')) {
      startNewGame();
      return;
    }

    if (screenMode !== 'playing') return;

    sound.unlock();
    if (e.code === 'Digit1' && !e.repeat) {
      if (world.triggerSpray()) sound.playSpray();
    } else if (e.code === 'Digit2' && !e.repeat) {
      if (world.triggerMintBomb()) sound.playMint();
    } else if (e.code === 'Space' && !e.repeat && !spaceHeld) {
      spaceHeld = true;
      world.blowHolding = true;
      world.blowHoldSec = 0;
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space' && spaceHeld) {
      spaceHeld = false;
      performBlowRelease();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);
  canvas.addEventListener('lostpointercapture', onPointerEnd);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearInputs);
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInputs();
  });

  resizeCanvas();

  let lastTimeMs = performance.now();
  let accumulatorMs = 0;

  function stepSimulation(dtMs: number): void {
    const dtSec = dtMs / 1000;
    animTimeSec += dtSec;

    if (screenMode !== 'playing') return;

    const events = world.step(dtMs);
    if (events.clearedCountThisStep > 0) sound.playPopOut();
    if (events.triggeredClearBurst) sound.playClearBurst();
    if (events.autoBlowTriggered) {
      blowPointerId = null;
      spaceHeld = false;
      sound.playBlow(false, false);
    }

    if (world.match.finished) {
      screenMode = 'result';
      clearInputs();
      if (world.match.score > bestScore) {
        bestScore = Math.floor(world.match.score);
        writeBestScore(bestScore);
      }
    }
  }

  function frame(nowMs: number): void {
    const elapsed = Math.min(tuning.loop.maxFrameDtMs, Math.max(0, nowMs - lastTimeMs));
    lastTimeMs = nowMs;
    accumulatorMs += elapsed;

    while (accumulatorMs >= tuning.loop.fixedDtMs) {
      stepSimulation(tuning.loop.fixedDtMs);
      accumulatorMs -= tuning.loop.fixedDtMs;
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGameFrame(
      ctx,
      world,
      {
        screenMode,
        bestScore,
        muted: sound.muted,
        debug: debugMode,
        animTimeSec,
      },
      tuning,
    );
    ctx.restore();

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
}

main();

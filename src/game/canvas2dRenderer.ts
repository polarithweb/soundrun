import { computeDayNightAtmosphere, type DayNightAtmosphere } from './dayNight';
import { computeWeatherAtmosphere, type WeatherAtmosphere } from './weather';
import type {
  CoinEntity,
  GapSegment,
  PatrolEnemy,
  SimulationState,
  SolidBlock,
} from './types';
import bgDayUrl from '../assets/images/mario_2d_bg_day_1795584978462.jpg';
import bgSunsetUrl from '../assets/images/mario_2d_bg_sunset_1795584978710.jpg';
import bgNightUrl from '../assets/images/mario_2d_bg_night_1795584979102.jpg';
import runnerStandUrl from '../assets/images/runner_costume_stand_1795587326536.jpg';
import runnerStepUrl from '../assets/images/runner_costume_idle_1795587284712.jpg';
import runnerRunAUrl from '../assets/images/runner_costume_run_a_1795587325299.jpg';
import runnerRunBUrl from '../assets/images/runner_costume_run_b_1795587326121.jpg';
import runnerJumpUrl from '../assets/images/runner_costume_jump_1795587326843.jpg';

export interface Canvas2DSceneController {
  syncSimulation: (state: SimulationState, dt: number) => void;
  dispose: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  outline?: string;
  life: number;
  maxLife: number;
  gravity: number;
  kind: 'spark' | 'brick' | 'dust' | 'ring' | 'star';
  rotation: number;
  vRot: number;
}

interface FloatingPopup {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

interface RainDrop {
  rx: number; // 0..1 normalized screen X
  ry: number; // 0..1 normalized screen Y
  speed: number;
  len: number;
  layer: number; // 0 = far, 1 = near
}

interface RainSplash {
  x: number; // world X
  y: number; // world Y
  life: number;
  maxLife: number;
}

const BACKDROP_URLS = {
  day: bgDayUrl,
  sunset: bgSunsetUrl,
  night: bgNightUrl,
} as const;

const RUNNER_COSTUME_URLS = {
  stand: runnerStandUrl,
  step: runnerStepUrl,
  runA: runnerRunAUrl,
  runB: runnerRunBUrl,
  jump: runnerJumpUrl,
} as const;

interface ChromaKeyCostume {
  canvas: HTMLCanvasElement | null;
  ready: boolean;
  centerXFrac: number;
  bottomFrac: number;
}

const INK = '#211813';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points = 5,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function loadBackdropImage(url: string): { img: HTMLImageElement; ready: boolean } {
  const entry = { img: new Image(), ready: false };
  entry.img.decoding = 'async';
  entry.img.onload = () => {
    entry.ready = entry.img.naturalWidth > 0;
  };
  entry.img.onerror = () => {
    entry.ready = false;
  };
  entry.img.src = url;
  return entry;
}

/**
 * Loads an AI-generated runner costume on a flat #FF00FF chroma-key background,
 * strips the magenta background with anti-aliased edge despill onto an offscreen canvas,
 * and measures exact boot bottom + horizontal center so every Scratch costume snaps flush to the ground.
 */
function loadChromaKeyCostume(url: string): ChromaKeyCostume {
  const entry: ChromaKeyCostume = {
    canvas: null,
    ready: false,
    centerXFrac: 0.5,
    bottomFrac: 0.92,
  };

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    const size = 384;
    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    const octx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!octx) return;

    octx.drawImage(img, 0, 0, size, size);
    const imgData = octx.getImageData(0, 0, size, size);
    const data = imgData.data;

    let minX = size;
    let maxX = 0;
    let maxY = 0;
    let foundOpaque = false;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Pure magenta has high min(r, b) and near-zero g; hero colors (red/blue/skin/white/gold/brown) never do
        const minRB = r < b ? r : b;
        const mag = minRB - g;

        if (mag >= 92) {
          data[idx + 3] = 0;
        } else if (mag > 38) {
          const t = (mag - 38) / (92 - 38);
          const alpha = Math.round((1 - t) * 255);
          data[idx + 3] = alpha;
          // Despill outer magenta halo cleanly into dark cartoon ink
          const keep = 1 - t * 0.88;
          data[idx] = Math.round(r * keep);
          data[idx + 2] = Math.round(b * keep);
        }

        if (data[idx + 3] > 180) {
          foundOpaque = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    octx.putImageData(imgData, 0, 0);
    if (foundOpaque) {
      entry.centerXFrac = (minX + maxX) / (2 * size);
      entry.bottomFrac = (maxY + 1) / size;
    }
    entry.canvas = offscreen;
    entry.ready = true;
  };
  img.onerror = () => {
    entry.ready = false;
  };
  img.src = url;
  return entry;
}

export function createCanvas2DScene(
  container: HTMLElement,
  onTick: (dt: number, nowMs: number) => void,
): Canvas2DSceneController {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  container.innerHTML = '';
  container.appendChild(canvas);

  const ctxOrNull = canvas.getContext('2d', { alpha: false });
  if (!ctxOrNull) {
    throw new Error('2D Canvas context unavailable');
  }
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  const backdrops = {
    day: loadBackdropImage(BACKDROP_URLS.day),
    sunset: loadBackdropImage(BACKDROP_URLS.sunset),
    night: loadBackdropImage(BACKDROP_URLS.night),
  };

  const runnerCostumes = {
    stand: loadChromaKeyCostume(RUNNER_COSTUME_URLS.stand),
    step: loadChromaKeyCostume(RUNNER_COSTUME_URLS.step),
    runA: loadChromaKeyCostume(RUNNER_COSTUME_URLS.runA),
    runB: loadChromaKeyCostume(RUNNER_COSTUME_URLS.runB),
    jump: loadChromaKeyCostume(RUNNER_COSTUME_URLS.jump),
  };

  let width = Math.max(1, container.clientWidth);
  let height = Math.max(1, container.clientHeight);
  let dpr = Math.min(2, window.devicePixelRatio || 1);

  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  };
  resize();

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  window.addEventListener('resize', resize);

  // Camera & VFX state
  let cameraX = -3.2;
  let cameraY = 0;
  let hasCameraInit = false;
  let visualTime = 0;
  let latestState: SimulationState | null = null;

  const particles: Particle[] = [];
  const popups: FloatingPopup[] = [];
  const rainSplashes: RainSplash[] = [];
  let splashAccum = 0;

  // Deterministic rain pool
  const rainDrops: RainDrop[] = Array.from({ length: 160 }, (_, idx) => ({
    rx: hash01(idx * 3.1 + 1),
    ry: hash01(idx * 5.7 + 9),
    speed: 0.95 + hash01(idx * 7.3 + 2) * 0.85,
    len: 14 + hash01(idx * 11.1 + 4) * 18,
    layer: idx % 3 === 0 ? 1 : 0,
  }));

  // Diff-tracking sets for automatic celebratory VFX
  const seenBrokenBlocks = new Set<string>();
  const seenSpentQuestions = new Set<string>();
  const seenCollectedCoins = new Set<string>();
  const seenStompedEnemies = new Set<string>();
  const seenPassedFlags = new Set<string>();
  let prevGrounded = true;
  let prevVaultTimer = 0;
  let prevSpinTimer = 0;
  let prevRunElapsed = 0;

  const resetVfxTracking = () => {
    seenBrokenBlocks.clear();
    seenSpentQuestions.clear();
    seenCollectedCoins.clear();
    seenStompedEnemies.clear();
    seenPassedFlags.clear();
    particles.length = 0;
    popups.length = 0;
    rainSplashes.length = 0;
    hasCameraInit = false;
    prevGrounded = true;
    prevVaultTimer = 0;
    prevSpinTimer = 0;
  };

  const spawnPopup = (
    x: number,
    y: number,
    text: string,
    color: string,
    scale = 1,
  ) => {
    popups.push({
      x,
      y,
      vy: 2.3,
      text,
      color,
      life: 0.85,
      maxLife: 0.85,
      scale,
    });
  };

  const spawnBurst = (
    x: number,
    y: number,
    count: number,
    color: string,
    kind: Particle['kind'],
    speed = 5.5,
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const mag = speed * (0.55 + Math.random() * 0.7);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * mag,
        vy: Math.sin(angle) * mag + (kind === 'brick' ? 5.5 : 1.5),
        size: kind === 'brick' ? 0.28 : kind === 'star' ? 0.24 : 0.16,
        color,
        outline: INK,
        life: kind === 'brick' ? 0.72 : 0.48,
        maxLife: kind === 'brick' ? 0.72 : 0.48,
        gravity: kind === 'brick' ? 24 : kind === 'dust' ? -1.5 : 8,
        kind,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 14,
      });
    }
  };

  const spawnSoundRing = (x: number, y: number, power: number) => {
    particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      size: 0.45 + power * 0.85,
      color: power > 0.68 ? '#f59e0b' : power > 0.3 ? '#38bdf8' : '#4ade80',
      life: 0.34,
      maxLife: 0.34,
      gravity: 0,
      kind: 'ring',
      rotation: 0,
      vRot: 0,
    });
  };

  const updateVfxFromSimulation = (state: SimulationState, dt: number) => {
    // Detect fresh run reset
    if (state.elapsedRunSeconds < prevRunElapsed - 0.5) {
      resetVfxTracking();
    }
    prevRunElapsed = state.elapsedRunSeconds;

    const p = state.player;

    // Jump & land feedback
    if (prevGrounded && !p.grounded && p.vy > 5.5) {
      spawnSoundRing(p.x, p.y + 0.1, p.lastJumpPower);
      spawnBurst(p.x, p.y + 0.08, 5, '#f8fafc', 'dust', 2.6);
    } else if (!prevGrounded && p.grounded) {
      spawnBurst(p.x, p.y + 0.06, 6, '#e2e8f0', 'dust', 3.1);
    }
    prevGrounded = p.grounded;

    if (p.vaultTimer > prevVaultTimer + 0.1) {
      spawnPopup(p.x, p.y + p.height + 0.5, 'VAULT!', '#fde047', 0.95);
      spawnBurst(p.x, p.y + 0.4, 6, '#fef08a', 'star', 4.2);
    }
    prevVaultTimer = p.vaultTimer;

    if (p.spinTimer > prevSpinTimer + 0.15) {
      spawnPopup(p.x, p.y + p.height + 0.55, 'SPIN!', '#7dd3fc', 0.95);
      spawnSoundRing(p.x, p.y + p.height * 0.5, 0.55);
    }
    prevSpinTimer = p.spinTimer;

    // Blocks diff
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      if (b.broken && !seenBrokenBlocks.has(b.id)) {
        seenBrokenBlocks.add(b.id);
        spawnBurst(b.x, b.y + b.height * 0.5, 6, '#c84b31', 'brick', 6.2);
        spawnPopup(b.x, b.y + b.height + 0.3, '+50', '#fed7aa', 0.9);
      }
      if (b.kind === 'question' && b.hitCount > 0 && !seenSpentQuestions.has(b.id)) {
        seenSpentQuestions.add(b.id);
        spawnBurst(b.x, b.y + b.height + 0.2, 8, '#fde047', 'star', 5.4);
        spawnPopup(
          b.x,
          b.y + b.height + 0.65,
          b.reward === 'mushroom' ? 'SUPER!' : '+250',
          b.reward === 'mushroom' ? '#f43f5e' : '#fde047',
          1.1,
        );
      }
      if (b.kind === 'goal_flag' && b.passed && !seenPassedFlags.has(b.id)) {
        seenPassedFlags.add(b.id);
        spawnBurst(b.x, b.y + b.height - 1.2, 16, '#fde047', 'star', 7.8);
        spawnBurst(b.x + 1.2, b.y + b.height - 2.4, 14, '#f472b6', 'star', 6.8);
        spawnPopup(b.x, b.y + b.height - 1.0, 'GOAL!', '#fef08a', 1.35);
      }
    }

    // Coins diff
    for (let i = 0; i < state.coins.length; i++) {
      const c = state.coins[i];
      if (c.collected && !seenCollectedCoins.has(c.id)) {
        seenCollectedCoins.add(c.id);
        if (c.isStarCoin) {
          spawnBurst(c.x, c.y, 12, '#f472b6', 'star', 6.4);
          spawnPopup(c.x, c.y + 0.5, '+500', '#f9a8d4', 1.25);
        } else {
          spawnBurst(c.x, c.y, 6, '#facc15', 'spark', 4.0);
          spawnPopup(c.x, c.y + 0.35, '+50', '#fef08a', 0.88);
        }
      }
    }

    // Enemies diff
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.alive && !seenStompedEnemies.has(e.id)) {
        seenStompedEnemies.add(e.id);
        spawnBurst(e.x, e.y + 0.4, 8, '#fef3c7', 'dust', 4.5);
        spawnPopup(e.x, e.y + 1.1, '+150', '#86efac', 1.05);
      }
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      pt.vy -= pt.gravity * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.rotation += pt.vRot * dt;
    }

    // Update popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const pop = popups[i];
      pop.life -= dt;
      if (pop.life <= 0) {
        popups.splice(i, 1);
        continue;
      }
      pop.y += pop.vy * dt;
      pop.vy *= Math.max(0, 1 - dt * 2.2);
    }
  };

  // --- LAYER DRAWING HELPERS ---

  const drawSkyAndBackdrops = (
    atmo: DayNightAtmosphere,
    weather: WeatherAtmosphere,
    groundY: number,
  ) => {
    // Rich fallback Mario sky gradient (always drawn underneath so zero blank frames)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    const dayW = atmo.dayBackdropWeight;
    const sunW = atmo.sunsetBackdropWeight;
    const nightW = atmo.nightBackdropWeight;

    const topR = Math.round(dayW * 38 + sunW * 224 + nightW * 12);
    const topG = Math.round(dayW * 156 + sunW * 104 + nightW * 24);
    const topB = Math.round(dayW * 246 + sunW * 88 + nightW * 68);

    const botR = Math.round(dayW * 156 + sunW * 253 + nightW * 28);
    const botG = Math.round(dayW * 224 + sunW * 194 + nightW * 48);
    const botB = Math.round(dayW * 255 + sunW * 134 + nightW * 102);

    skyGrad.addColorStop(0, `rgb(${topR},${topG},${topB})`);
    skyGrad.addColorStop(1, `rgb(${botR},${botG},${botB})`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // Seamless mirror-tiled Mario 2D illustrated panoramas
    const drawPanoramaLayer = (
      entry: { img: HTMLImageElement; ready: boolean },
      alpha: number,
    ) => {
      if (!entry.ready || alpha <= 0.005) return;
      const img = entry.img;
      // Align image bottom slightly below groundY so the illustration's bottom grass rim tucks cleanly under our interactive foreground terrain
      const targetH = Math.max(height * 0.9, groundY * 1.12);
      const scale = targetH / img.naturalHeight;
      const tileW = Math.ceil(img.naturalWidth * scale);
      const drawY = groundY - targetH * 0.92;

      const scrollPx = cameraX * 14; // Smooth slow Mario horizon parallax
      const firstTile = Math.floor(scrollPx / tileW) - 1;
      const tilesNeeded = Math.ceil(width / tileW) + 3;

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      for (let i = 0; i < tilesNeeded; i++) {
        const tileIdx = firstTile + i;
        const drawX = Math.floor(tileIdx * tileW - scrollPx);
        const mirrored = ((tileIdx % 2) + 2) % 2 === 1;
        if (mirrored) {
          ctx.save();
          ctx.translate(drawX + tileW, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, drawY, tileW + 1, targetH);
          ctx.restore();
        } else {
          ctx.drawImage(img, drawX, drawY, tileW + 1, targetH);
        }
      }
      ctx.restore();
    };

    drawPanoramaLayer(backdrops.day, dayW);
    drawPanoramaLayer(backdrops.sunset, sunW);
    drawPanoramaLayer(backdrops.night, nightW);

    // Clear Day / Golden Hour diagonal warm sunbeams
    const sunBeamAlpha =
      (dayW * 0.12 + sunW * 0.16) * (1 - weather.cloudCover * 0.9);
    if (sunBeamAlpha > 0.01) {
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const bx = width * (0.14 + i * 0.24) + Math.sin(visualTime * 0.35 + i) * 18;
        const beamGrad = ctx.createLinearGradient(bx, 0, bx + 110, groundY);
        beamGrad.addColorStop(
          0,
          sunW > 0.3
            ? `rgba(255, 214, 130, ${sunBeamAlpha})`
            : `rgba(255, 252, 224, ${sunBeamAlpha})`,
        );
        beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(bx - 30, 0);
        ctx.lineTo(bx + 52, 0);
        ctx.lineTo(bx + 170, groundY);
        ctx.lineTo(bx + 58, groundY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Overcast & Rainy moody cloud-veil sky wash
    const stormShade = weather.cloudCover * 0.38 + weather.rainIntensity * 0.24;
    if (stormShade > 0.01) {
      const veilGrad = ctx.createLinearGradient(0, 0, 0, groundY);
      const isNight = nightW > 0.5;
      veilGrad.addColorStop(
        0,
        isNight
          ? `rgba(10, 18, 36, ${stormShade * 0.95})`
          : `rgba(52, 68, 92, ${stormShade * 0.95})`,
      );
      veilGrad.addColorStop(
        1,
        isNight
          ? `rgba(15, 24, 44, ${stormShade * 0.45})`
          : `rgba(98, 118, 142, ${stormShade * 0.45})`,
      );
      ctx.fillStyle = veilGrad;
      ctx.fillRect(0, 0, width, height);
    }

    // Lightning flash pulse during peak rain
    if (weather.lightningFlash > 0.02) {
      ctx.fillStyle = `rgba(232, 244, 255, ${weather.lightningFlash * 0.48})`;
      ctx.fillRect(0, 0, width, height);
    }

    // Twinkling night fireflies
    const fireflyAlpha = nightW * (1 - weather.rainIntensity * 0.75);
    if (fireflyAlpha > 0.08) {
      ctx.save();
      for (let i = 0; i < 16; i++) {
        const fx =
          (((hash01(i * 19.3) * width * 1.4 - cameraX * 22 + visualTime * (12 + (i % 4) * 5)) %
            (width + 80)) +
            (width + 80)) %
            (width + 80) -
          40;
        const fy =
          groundY * (0.28 + hash01(i * 7.9) * 0.62) +
          Math.sin(visualTime * (1.8 + (i % 3) * 0.6) + i * 2.1) * 14;
        const pulse = 0.4 + 0.6 * Math.sin(visualTime * 3.8 + i * 1.7);
        const r = 2.2 + (i % 3) * 0.9;
        ctx.fillStyle = `rgba(254, 240, 138, ${fireflyAlpha * pulse * 0.9})`;
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(254, 240, 138, ${fireflyAlpha * pulse * 0.25})`;
        ctx.beginPath();
        ctx.arc(fx, fy, r * 3.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  const drawDriftingClouds = (
    atmo: DayNightAtmosphere,
    weather: WeatherAtmosphere,
    groundY: number,
  ) => {
    const cloudSpan = 260;
    const driftPx =
      cameraX * 24 + visualTime * (14 + weather.windStrength * 34);
    const startIdx = Math.floor(driftPx / cloudSpan) - 1;
    const count = Math.ceil(width / cloudSpan) + 3;

    const nightW = atmo.nightBackdropWeight;
    const sunW = atmo.sunsetBackdropWeight;
    const storm = clamp(weather.cloudCover * 0.8 + weather.rainIntensity * 0.45, 0, 1);

    // Cloud fill palette adapts dynamically to Day, Golden Hour, Night, and Storm!
    const cr = Math.round(
      lerp(lerp(255, 255, sunW) * (1 - nightW * 0.58), 118 - nightW * 55, storm),
    );
    const cg = Math.round(
      lerp(lerp(255, 224, sunW) * (1 - nightW * 0.52), 130 - nightW * 55, storm),
    );
    const cb = Math.round(
      lerp(lerp(255, 198, sunW) * (1 - nightW * 0.35), 148 - nightW * 45, storm),
    );

    const sr = Math.round(cr * 0.82);
    const sg = Math.round(cg * 0.86);
    const sb = Math.round(Math.min(255, cb * 0.94));

    ctx.save();
    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      const seed = hash01(idx * 13.7 + 4.2);
      // Show more clouds as cloudCover increases
      if (seed > 0.46 + weather.cloudCover * 0.54) continue;

      const cx = idx * cloudSpan - driftPx + hash01(idx * 5.3) * 90;
      const cy =
        groundY * (0.1 + hash01(idx * 9.1) * 0.34) +
        Math.sin(visualTime * 0.6 + idx) * 3;
      const scale =
        (0.75 + hash01(idx * 17.1) * 0.55) * (1 + weather.cloudCover * 0.42);
      const baseW = 76 * scale;
      const baseH = 28 * scale;

      ctx.globalAlpha = clamp(0.76 + weather.cloudCover * 0.22 - nightW * 0.16, 0.35, 0.98);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.strokeStyle = `rgba(${Math.round(sr * 0.5)},${Math.round(sg * 0.55)},${Math.round(sb * 0.65)}, 0.55)`;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(cx - baseW * 0.32, cy, baseH * 0.68, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(cx - baseW * 0.08, cy - baseH * 0.36, baseH * 0.86, Math.PI, Math.PI * 1.95);
      ctx.arc(cx + baseW * 0.25, cy - baseH * 0.15, baseH * 0.72, Math.PI * 1.25, Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Soft bottom cloud shading
      ctx.fillStyle = `rgba(${sr},${sg},${sb}, 0.55)`;
      ctx.beginPath();
      ctx.ellipse(cx, cy + baseH * 0.32, baseW * 0.45, baseH * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const drawMidgroundProps = (
    atmo: DayNightAtmosphere,
    weather: WeatherAtmosphere,
    ppu: number,
    groundY: number,
  ) => {
    const nightW = atmo.nightBackdropWeight;
    const sunW = atmo.sunsetBackdropWeight;
    const shadeFactor = 1 - nightW * 0.46 - weather.cloudCover * 0.14;

    const shadeRgb = (r: number, g: number, b: number) => {
      const rr = Math.round(clamp((r + sunW * 26) * shadeFactor, 12, 255));
      const gg = Math.round(clamp((g + sunW * 6) * shadeFactor, 16, 255));
      const bb = Math.round(clamp((b + nightW * 28) * shadeFactor, 18, 255));
      return `rgb(${rr},${gg},${bb})`;
    };

    // Layer 2A: Parallax storybook polka-dot hills & rounded trees (0.45x speed)
    const hillSpan = 340;
    const scrollHill = cameraX * ppu * 0.42;
    const firstHill = Math.floor(scrollHill / hillSpan) - 1;
    const hillCount = Math.ceil(width / hillSpan) + 3;

    for (let i = 0; i < hillCount; i++) {
      const idx = firstHill + i;
      const hx = idx * hillSpan - scrollHill + 120;
      const hillW = 115 + hash01(idx * 3.7) * 65;
      const hillH = 85 + hash01(idx * 8.3) * 110;

      // Iconic Super Mario rounded vertical hill
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hx - hillW * 0.55, groundY + 12);
      ctx.quadraticCurveTo(hx - hillW * 0.45, groundY - hillH, hx, groundY - hillH);
      ctx.quadraticCurveTo(hx + hillW * 0.45, groundY - hillH, hx + hillW * 0.55, groundY + 12);
      ctx.closePath();

      const hillGrad = ctx.createLinearGradient(hx - hillW * 0.4, groundY - hillH, hx + hillW * 0.4, groundY);
      hillGrad.addColorStop(0, shadeRgb(106, 214, 92));
      hillGrad.addColorStop(0.65, shadeRgb(52, 168, 72));
      hillGrad.addColorStop(1, shadeRgb(34, 128, 56));
      ctx.fillStyle = hillGrad;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = shadeRgb(24, 84, 38);
      ctx.stroke();

      // Classic Super Mario hill oval spots
      ctx.fillStyle = shadeRgb(142, 232, 118);
      ctx.beginPath();
      ctx.ellipse(hx - hillW * 0.14, groundY - hillH * 0.62, hillW * 0.11, hillH * 0.11, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx + hillW * 0.15, groundY - hillH * 0.42, hillW * 0.09, hillH * 0.09, 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Layer 2B: Trail-side stylized Mario Trees & Multi-Lobe Bushes (1:1 world behind track)
    const propSpacing = 11.5;
    const minWorldX = cameraX - 4;
    const maxWorldX = cameraX + width / ppu + 6;
    const firstProp = Math.floor(minWorldX / propSpacing);
    const lastProp = Math.ceil(maxWorldX / propSpacing);

    for (let idx = firstProp; idx <= lastProp; idx++) {
      const worldX = idx * propSpacing + hash01(idx * 17.9) * 4.2;
      const sx = (worldX - cameraX) * ppu;
      const propKind = Math.floor(hash01(idx * 23.1 + 1.5) * 3);
      const sway =
        Math.sin(visualTime * (2.2 + weather.windStrength * 3.8) + idx * 1.4) *
        (3 + weather.windStrength * 11);

      if (propKind === 0) {
        // Stylized lush 2D Mario Tree
        const trunkH = ppu * (1.85 + hash01(idx * 4.9) * 0.75);
        const trunkW = ppu * 0.34;

        ctx.save();
        // Curved trunk
        ctx.fillStyle = shadeRgb(138, 86, 48);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sx - trunkW * 0.6, groundY + 2);
        ctx.quadraticCurveTo(sx - trunkW * 0.25, groundY - trunkH * 0.5, sx - trunkW * 0.35 + sway * 0.35, groundY - trunkH);
        ctx.lineTo(sx + trunkW * 0.35 + sway * 0.35, groundY - trunkH);
        ctx.quadraticCurveTo(sx + trunkW * 0.25, groundY - trunkH * 0.5, sx + trunkW * 0.6, groundY + 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Layered rounded leaf canopy puffs
        const cx = sx + sway;
        const cy = groundY - trunkH - ppu * 0.45;
        const r = ppu * 0.76;

        const puffs = [
          { dx: -r * 0.68, dy: r * 0.24, rad: r * 0.66, c: shadeRgb(36, 152, 62) },
          { dx: r * 0.68, dy: r * 0.26, rad: r * 0.64, c: shadeRgb(34, 146, 58) },
          { dx: 0, dy: -r * 0.32, rad: r * 0.82, c: shadeRgb(66, 198, 76) },
          { dx: -r * 0.16, dy: -r * 0.48, rad: r * 0.46, c: shadeRgb(132, 232, 102) },
        ];
        for (const pf of puffs) {
          ctx.fillStyle = pf.c;
          ctx.beginPath();
          ctx.arc(cx + pf.dx, cy + pf.dy, pf.rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = shadeRgb(20, 74, 34);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // Classic Mario Multi-Lobe Bush with flowers
        const bushR = ppu * (0.48 + hash01(idx * 11.3) * 0.22);
        ctx.save();
        ctx.fillStyle = shadeRgb(52, 184, 72);
        ctx.strokeStyle = shadeRgb(20, 82, 34);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(sx - bushR * 0.9, groundY - bushR * 0.3, bushR * 0.68, Math.PI * 0.9, Math.PI * 2.05);
        ctx.arc(sx + sway * 0.2, groundY - bushR * 0.58, bushR * 0.88, Math.PI * 1.05, Math.PI * 1.95);
        ctx.arc(sx + bushR * 0.9, groundY - bushR * 0.3, bushR * 0.68, Math.PI * 0.95, Math.PI * 2.1);
        ctx.lineTo(sx + bushR * 1.55, groundY + 4);
        ctx.lineTo(sx - bushR * 1.55, groundY + 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Top highlight puff
        ctx.fillStyle = shadeRgb(118, 226, 106);
        ctx.beginPath();
        ctx.ellipse(sx - bushR * 0.15 + sway * 0.2, groundY - bushR * 0.95, bushR * 0.42, bushR * 0.22, -0.15, 0, Math.PI * 2);
        ctx.fill();

        // Cute meadow flowers on the bush
        const flowerColors = ['#fef08a', '#fb7185', '#ffffff'];
        for (let f = 0; f < 3; f++) {
          const fx = sx + (f - 1) * bushR * 0.65 + sway * 0.15;
          const fy = groundY - bushR * (0.42 + (f % 2) * 0.28);
          ctx.fillStyle = flowerColors[(idx + f) % flowerColors.length];
          ctx.beginPath();
          ctx.arc(fx, fy, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  };

  const drawGroundAndRivers = (
    gaps: GapSegment[],
    atmo: DayNightAtmosphere,
    weather: WeatherAtmosphere,
    ppu: number,
    groundY: number,
  ) => {
    const viewMinX = cameraX - 2;
    const viewMaxX = cameraX + width / ppu + 2;
    const groundHeightPx = height - groundY + 4;

    const visibleGaps = gaps
      .filter((g) => g.endX > viewMinX && g.startX < viewMaxX)
      .sort((a, b) => a.startX - b.startX);

    // 1. Draw sparkling Mario river water inside ravine gaps
    for (const g of visibleGaps) {
      const gx1 = (g.startX - cameraX) * ppu;
      const gx2 = (g.endX - cameraX) * ppu;
      const gw = gx2 - gx1;
      const waterTop = groundY + ppu * 0.72;

      // Deep ravine backdrop
      ctx.fillStyle = atmo.nightBackdropWeight > 0.5 ? '#0b152a' : '#1b314c';
      ctx.fillRect(gx1 - 2, groundY, gw + 4, groundHeightPx);

      // Animated water body
      const waterGrad = ctx.createLinearGradient(0, waterTop, 0, height);
      if (atmo.nightBackdropWeight > 0.5) {
        waterGrad.addColorStop(0, '#1d4ed8');
        waterGrad.addColorStop(1, '#0f172a');
      } else if (atmo.sunsetBackdropWeight > 0.4) {
        waterGrad.addColorStop(0, '#38bdf8');
        waterGrad.addColorStop(0.4, '#0284c7');
        waterGrad.addColorStop(1, '#1e3a5f');
      } else {
        waterGrad.addColorStop(0, '#38bdf8');
        waterGrad.addColorStop(0.5, '#0284c7');
        waterGrad.addColorStop(1, '#0369a1');
      }

      ctx.beginPath();
      ctx.moveTo(gx1 - 2, height);
      const steps = Math.max(8, Math.ceil(gw / 14));
      for (let s = 0; s <= steps; s++) {
        const px = gx1 - 2 + (s / steps) * (gw + 4);
        const wave =
          Math.sin(px * 0.08 + visualTime * (4.2 + weather.windStrength * 3.5)) *
          (3.2 + weather.rainIntensity * 2.5);
        ctx.lineTo(px, waterTop + wave);
      }
      ctx.lineTo(gx2 + 2, height);
      ctx.closePath();
      ctx.fillStyle = waterGrad;
      ctx.fill();

      // White foam crest line
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const px = gx1 - 2 + (s / steps) * (gw + 4);
        const wave =
          Math.sin(px * 0.08 + visualTime * (4.2 + weather.windStrength * 3.5)) *
          (3.2 + weather.rainIntensity * 2.5);
        if (s === 0) ctx.moveTo(px, waterTop + wave);
        else ctx.lineTo(px, waterTop + wave);
      }
      ctx.stroke();

      // Concentric raindrop ripples on river water
      if (weather.rainIntensity > 0.08) {
        ctx.strokeStyle = `rgba(224, 242, 254, ${weather.rainIntensity * 0.55})`;
        ctx.lineWidth = 1.5;
        for (let r = 0; r < 3; r++) {
          const phase = (visualTime * 1.8 + r * 0.33 + g.startX) % 1;
          const rx = gx1 + gw * (0.2 + r * 0.3);
          const ry = waterTop + 14 + r * 8;
          ctx.beginPath();
          ctx.ellipse(rx, ry, 4 + phase * 18, 2 + phase * 5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // 2. Build solid terrain spans between gaps
    const spans: Array<[number, number]> = [];
    let cursor = viewMinX;
    for (const g of visibleGaps) {
      if (g.startX > cursor) {
        spans.push([cursor, g.startX]);
      }
      cursor = Math.max(cursor, g.endX);
    }
    if (cursor < viewMaxX) {
      spans.push([cursor, viewMaxX]);
    }

    // Draw each solid Super Mario ground span
    const tileWorldSize = 1.1;
    const tilePx = tileWorldSize * ppu;
    const grassH = ppu * 0.34;

    for (const [startX, endX] of spans) {
      const sx1 = (startX - cameraX) * ppu;
      const sx2 = (endX - cameraX) * ppu;
      const sw = sx2 - sx1;
      if (sw <= 1) continue;

      ctx.save();
      // Clip to solid cliff silhouette with slight top bevel at gap edges
      drawRoundedRect(ctx, sx1, groundY, sw, groundHeightPx + 12, 8);
      ctx.clip();

      // Earthy Mario soil base gradient
      const dirtGrad = ctx.createLinearGradient(0, groundY, 0, height);
      dirtGrad.addColorStop(0, '#c27a38');
      dirtGrad.addColorStop(0.55, '#9d5a24');
      dirtGrad.addColorStop(1, '#6f3c16');
      ctx.fillStyle = dirtGrad;
      ctx.fillRect(sx1, groundY, sw, groundHeightPx);

      // Authentic New Super Mario Bros. checkered/terraced earth tiles
      const firstCol = Math.floor(startX / tileWorldSize);
      const lastCol = Math.ceil(endX / tileWorldSize);
      const rows = Math.ceil(groundHeightPx / tilePx) + 1;

      for (let col = firstCol; col <= lastCol; col++) {
        const tx = (col * tileWorldSize - cameraX) * ppu;
        for (let row = 0; row < rows; row++) {
          const ty = groundY + grassH * 0.75 + row * tilePx;
          const isAlt = ((col + row) % 2 + 2) % 2 === 0;
          ctx.fillStyle = isAlt ? 'rgba(255, 224, 168, 0.14)' : 'rgba(64, 30, 8, 0.14)';
          drawRoundedRect(ctx, tx + 3, ty + 3, tilePx - 6, tilePx - 6, 7);
          ctx.fill();

          // Subtle rounded stone pebble highlight
          if (hash01(col * 7.1 + row * 13.3) > 0.65) {
            ctx.fillStyle = 'rgba(255, 232, 188, 0.22)';
            ctx.beginPath();
            ctx.ellipse(
              tx + tilePx * 0.45,
              ty + tilePx * 0.45,
              tilePx * 0.16,
              tilePx * 0.1,
              0.2,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }

      // Dark brown shadow strip right under the overhanging grass cap
      ctx.fillStyle = 'rgba(42, 20, 6, 0.42)';
      ctx.fillRect(sx1, groundY + grassH * 0.78, sw, ppu * 0.14);

      // Thick glossy overhanging Super Mario grass cap
      const grassGrad = ctx.createLinearGradient(0, groundY, 0, groundY + grassH);
      grassGrad.addColorStop(0, '#86efac');
      grassGrad.addColorStop(0.28, '#4ade80');
      grassGrad.addColorStop(0.75, '#16a34a');
      grassGrad.addColorStop(1, '#15803d');
      ctx.fillStyle = grassGrad;
      ctx.fillRect(sx1, groundY, sw, grassH);

      // Scalloped hanging grass lip waves
      const waveStep = ppu * 0.46;
      const firstWave = Math.floor(startX / 0.46);
      const lastWave = Math.ceil(endX / 0.46);
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.moveTo(sx1, groundY + grassH * 0.65);
      for (let w = firstWave; w <= lastWave; w++) {
        const wx = (w * 0.46 - cameraX) * ppu;
        ctx.arc(wx + waveStep * 0.5, groundY + grassH * 0.85, waveStep * 0.52, 0, Math.PI);
      }
      ctx.lineTo(sx2, groundY + grassH * 0.5);
      ctx.closePath();
      ctx.fill();

      // Glossy lime rim along very top edge
      ctx.fillStyle = '#bbf7d0';
      ctx.fillRect(sx1, groundY + 2, sw, 4);

      // Rain puddles glistening on top of the grass when wet!
      if (weather.wetness > 0.08) {
        const puddleSpan = 5.5;
        const firstP = Math.floor(startX / puddleSpan);
        const lastP = Math.ceil(endX / puddleSpan);
        for (let pi = firstP; pi <= lastP; pi++) {
          if (hash01(pi * 9.7) < 0.35) continue;
          const px = (pi * puddleSpan + 1.4 - cameraX) * ppu;
          const pw = ppu * (1.2 + hash01(pi * 3.3) * 1.1);
          ctx.fillStyle =
            atmo.nightBackdropWeight > 0.5
              ? `rgba(96, 165, 250, ${weather.wetness * 0.42})`
              : `rgba(186, 230, 253, ${weather.wetness * 0.55})`;
          ctx.beginPath();
          ctx.ellipse(px, groundY + 4, pw * 0.5, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();

      // Crisp dark cartoon outline along top & cliff edges
      ctx.strokeStyle = '#143318';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(sx1, height);
      ctx.lineTo(sx1, groundY + 6);
      ctx.quadraticCurveTo(sx1, groundY, sx1 + 6, groundY);
      ctx.lineTo(sx2 - 6, groundY);
      ctx.quadraticCurveTo(sx2, groundY, sx2, groundY + 6);
      ctx.lineTo(sx2, height);
      ctx.stroke();
    }
  };

  const drawCastleAndFlagpole = (
    b: SolidBlock,
    atmo: DayNightAtmosphere,
    weather: WeatherAtmosphere,
    ppu: number,
    groundY: number,
  ) => {
    const sx = (b.x - cameraX) * ppu;
    const baseY = groundY - b.y * ppu;
    const poleH = b.height * ppu;
    const topY = baseY - poleH;

    // 1. Classic 2D Super Mario Storybook Castle just past the flagpole!
    const castleX = sx + ppu * 4.5;
    const castleW = ppu * 4.6;
    const castleH = ppu * 4.2;
    const castleLeft = castleX - castleW * 0.5;
    const castleTop = baseY - castleH;
    const windowGlow = Math.max(atmo.lampGlow, weather.cloudCover * 0.55);

    ctx.save();
    // Main castle tower upper tier
    const towerW = castleW * 0.58;
    const towerH = ppu * 2.1;
    const towerLeft = castleX - towerW * 0.5;
    const towerTop = castleTop - towerH;

    // Pointed red fairytale roof spire
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(towerLeft - 8, towerTop + 2);
    ctx.lineTo(castleX, towerTop - ppu * 1.45);
    ctx.lineTo(towerLeft + towerW + 8, towerTop + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Small pennant on spire
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(castleX, towerTop - ppu * 1.45);
    ctx.lineTo(castleX, towerTop - ppu * 2.0);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(castleX, towerTop - ppu * 2.0);
    ctx.lineTo(castleX + ppu * 0.55, towerTop - ppu * 1.82);
    ctx.lineTo(castleX, towerTop - ppu * 1.64);
    ctx.closePath();
    ctx.fill();

    // Castle stone helper
    const drawStoneBody = (x: number, y: number, w: number, h: number) => {
      const grad = ctx.createLinearGradient(x, y, x + w, y);
      grad.addColorStop(0, '#e2e8f0');
      grad.addColorStop(0.5, '#cbd5e1');
      grad.addColorStop(1, '#94a3b8');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
      // Brick courses
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
      ctx.lineWidth = 1.4;
      const rows = Math.max(3, Math.floor(h / (ppu * 0.45)));
      for (let r = 1; r < rows; r++) {
        const ry = y + (r * h) / rows;
        ctx.beginPath();
        ctx.moveTo(x, ry);
        ctx.lineTo(x + w, ry);
        ctx.stroke();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.strokeRect(x, y, w, h);
    };

    drawStoneBody(towerLeft, towerTop, towerW, towerH);
    drawStoneBody(castleLeft, castleTop, castleW, castleH);

    // Battlements (crenellations)
    const merlonCount = 5;
    const merlonW = castleW / (merlonCount * 1.8);
    for (let m = 0; m < merlonCount; m++) {
      const mx = castleLeft + m * ((castleW - merlonW) / (merlonCount - 1));
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(mx, castleTop - ppu * 0.42, merlonW, ppu * 0.44);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      ctx.strokeRect(mx, castleTop - ppu * 0.42, merlonW, ppu * 0.44);
    }

    // Castle windows (warm glowing at night / storm!)
    const drawArchWindow = (wx: number, wy: number, ww: number, wh: number) => {
      ctx.beginPath();
      ctx.arc(wx, wy, ww * 0.5, Math.PI, 0);
      ctx.lineTo(wx + ww * 0.5, wy + wh);
      ctx.lineTo(wx - ww * 0.5, wy + wh);
      ctx.closePath();
      ctx.fillStyle = windowGlow > 0.25 ? '#fde047' : '#334155';
      ctx.fill();
      if (windowGlow > 0.25) {
        ctx.save();
        ctx.fillStyle = `rgba(254, 240, 138, ${windowGlow * 0.32})`;
        ctx.beginPath();
        ctx.arc(wx, wy + wh * 0.3, ww * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    };
    drawArchWindow(castleX, towerTop + towerH * 0.45, ppu * 0.58, ppu * 0.6);
    drawArchWindow(castleX - castleW * 0.28, castleTop + ppu * 0.95, ppu * 0.48, ppu * 0.55);
    drawArchWindow(castleX + castleW * 0.28, castleTop + ppu * 0.95, ppu * 0.48, ppu * 0.55);

    // Classic arched dark doorway
    const doorW = ppu * 1.35;
    const doorH = ppu * 1.65;
    ctx.beginPath();
    ctx.arc(castleX, baseY - doorH + doorW * 0.5, doorW * 0.5, Math.PI, 0);
    ctx.lineTo(castleX + doorW * 0.5, baseY);
    ctx.lineTo(castleX - doorW * 0.5, baseY);
    ctx.closePath();
    ctx.fillStyle = '#1e1b2e';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // 2. Goal Flagpole
    // Stone plinth base
    const plinthW = ppu * 1.05;
    const plinthH = ppu * 0.72;
    drawRoundedRect(ctx, sx - plinthW * 0.5, baseY - plinthH, plinthW, plinthH, 6);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Gleaming pole shaft
    const poleW = Math.max(7, ppu * 0.16);
    const poleGrad = ctx.createLinearGradient(sx - poleW * 0.5, 0, sx + poleW * 0.5, 0);
    poleGrad.addColorStop(0, '#94a3b8');
    poleGrad.addColorStop(0.4, '#ffffff');
    poleGrad.addColorStop(1, '#64748b');
    ctx.fillStyle = poleGrad;
    ctx.fillRect(sx - poleW * 0.5, topY + ppu * 0.25, poleW, poleH - plinthH - ppu * 0.25);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - poleW * 0.5, topY + ppu * 0.25, poleW, poleH - plinthH - ppu * 0.25);

    // Golden finial orb on top
    const orbR = ppu * 0.34;
    const orbGrad = ctx.createRadialGradient(
      sx - orbR * 0.3,
      topY + orbR * 0.1,
      orbR * 0.1,
      sx,
      topY + orbR * 0.35,
      orbR,
    );
    orbGrad.addColorStop(0, '#fef9c3');
    orbGrad.addColorStop(0.45, '#facc15');
    orbGrad.addColorStop(1, '#b45309');
    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(sx, topY + orbR * 0.35, orbR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Wind-rippling green pennant flag
    const flagY = b.passed ? baseY - plinthH - ppu * 1.15 : topY + ppu * 0.85;
    const flagW = ppu * 1.85;
    const flagH = ppu * 1.1;
    const flutter = Math.sin(visualTime * (6 + weather.windStrength * 8)) * (5 + weather.windStrength * 8);

    ctx.beginPath();
    ctx.moveTo(sx + poleW * 0.4, flagY);
    ctx.quadraticCurveTo(
      sx + flagW * 0.5,
      flagY - 5 + flutter * 0.5,
      sx + flagW,
      flagY + flagH * 0.5 + flutter,
    );
    ctx.quadraticCurveTo(
      sx + flagW * 0.5,
      flagY + flagH + 5 + flutter * 0.5,
      sx + poleW * 0.4,
      flagY + flagH,
    );
    ctx.closePath();
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Star emblem inside flag
    drawStarPath(ctx, sx + flagW * 0.42, flagY + flagH * 0.5 + flutter * 0.3, ppu * 0.28, ppu * 0.13);
    ctx.fillStyle = '#fef08a';
    ctx.fill();
    ctx.restore();
  };

  const drawBlock = (
    b: SolidBlock,
    atmo: DayNightAtmosphere,
    weather: WeatherAtmosphere,
    ppu: number,
    groundY: number,
  ) => {
    if (b.broken) return;
    if (b.kind === 'goal_flag') {
      drawCastleAndFlagpole(b, atmo, weather, ppu, groundY);
      return;
    }

    const bumpOffset =
      b.hitAnimTimer > 0
        ? Math.sin((b.hitAnimTimer / 0.25) * Math.PI) *
          (b.kind === 'spring' ? -ppu * 0.16 : ppu * 0.26)
        : 0;

    const w = b.width * ppu;
    const h = b.height * ppu;
    const left = (b.x - b.width * 0.5 - cameraX) * ppu;
    const top = groundY - (b.y + b.height) * ppu - bumpOffset;

    if (left + w < -60 || left > width + 60) return;

    ctx.save();

    if (b.kind === 'pipe') {
      // Classic glossy emerald Mario Warp Pipe!
      const rimH = Math.min(h * 0.42, ppu * 0.48);
      const bodyInset = Math.max(4, w * 0.08);
      const bodyX = left + bodyInset;
      const bodyW = w - bodyInset * 2;

      const makePipeGrad = (x: number, widthPx: number) => {
        const g = ctx.createLinearGradient(x, 0, x + widthPx, 0);
        g.addColorStop(0, '#14532d');
        g.addColorStop(0.16, '#22c55e');
        g.addColorStop(0.32, '#86efac');
        g.addColorStop(0.48, '#22c55e');
        g.addColorStop(0.78, '#15803d');
        g.addColorStop(1, '#052e16');
        return g;
      };

      // Shaft
      ctx.fillStyle = makePipeGrad(bodyX, bodyW);
      ctx.fillRect(bodyX, top + rimH - 2, bodyW, h - rimH + 4);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.strokeRect(bodyX, top + rimH - 2, bodyW, h - rimH + 4);

      // Shadow right underneath rim lip
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(bodyX + 1, top + rimH, bodyW - 2, 6);

      // Overhanging rounded pipe rim cap
      drawRoundedRect(ctx, left, top, w, rimH, 6);
      ctx.fillStyle = makePipeGrad(left, w);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.8;
      ctx.stroke();

      // Top rim highlight
      ctx.fillStyle = 'rgba(220, 252, 231, 0.55)';
      ctx.fillRect(left + 4, top + 3, w - 8, 3);
    } else if (b.kind === 'question') {
      const spent = b.hitCount >= b.maxHits;
      drawRoundedRect(ctx, left, top, w, h, 8);

      const qGrad = ctx.createLinearGradient(left, top, left, top + h);
      if (spent) {
        qGrad.addColorStop(0, '#9a6b48');
        qGrad.addColorStop(1, '#6b442a');
      } else {
        qGrad.addColorStop(0, '#fde047');
        qGrad.addColorStop(0.55, '#f59e0b');
        qGrad.addColorStop(1, '#d97706');
      }
      ctx.fillStyle = qGrad;
      ctx.fill();

      // Inner bevel highlight
      if (!spent) {
        ctx.strokeStyle = 'rgba(255, 251, 235, 0.72)';
        ctx.lineWidth = 2.2;
        drawRoundedRect(ctx, left + 3, top + 3, w - 6, h - 6, 5);
        ctx.stroke();

        // Animated shimmer sweep
        const sheenPhase = ((visualTime * 0.75 + b.x * 0.12) % 2.4);
        if (sheenPhase < 0.75) {
          ctx.save();
          drawRoundedRect(ctx, left + 2, top + 2, w - 4, h - 4, 6);
          ctx.clip();
          const sxPos = left - w * 0.4 + (sheenPhase / 0.75) * (w * 1.8);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
          ctx.beginPath();
          ctx.moveTo(sxPos, top);
          ctx.lineTo(sxPos + w * 0.25, top);
          ctx.lineTo(sxPos + w * 0.05, top + h);
          ctx.lineTo(sxPos - w * 0.2, top + h);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // Outer cartoon outline
      drawRoundedRect(ctx, left, top, w, h, 8);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.8;
      ctx.stroke();

      // 4 Corner Rivets
      const rivetOff = Math.max(6, w * 0.14);
      const rivets = [
        [left + rivetOff, top + rivetOff],
        [left + w - rivetOff, top + rivetOff],
        [left + rivetOff, top + h - rivetOff],
        [left + w - rivetOff, top + h - rivetOff],
      ];
      ctx.fillStyle = spent ? '#4a2d1a' : '#92400e';
      for (const [rx, ry] of rivets) {
        ctx.beginPath();
        ctx.arc(rx, ry, Math.max(2, w * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }

      // Iconic bold '?' symbol
      if (!spent) {
        ctx.font = `900 ${Math.round(h * 0.68)}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#78350f';
        ctx.fillText('?', left + w * 0.5 + 2.2, top + h * 0.55 + 2.2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('?', left + w * 0.5, top + h * 0.54);
      }
    } else if (b.kind === 'brick') {
      drawRoundedRect(ctx, left, top, w, h, 6);
      const brickGrad = ctx.createLinearGradient(left, top, left, top + h);
      brickGrad.addColorStop(0, '#e06040');
      brickGrad.addColorStop(0.55, '#c24124');
      brickGrad.addColorStop(1, '#922c16');
      ctx.fillStyle = brickGrad;
      ctx.fill();

      // Masonry mortar lines (3 courses)
      ctx.save();
      drawRoundedRect(ctx, left, top, w, h, 6);
      ctx.clip();
      ctx.strokeStyle = '#3b150c';
      ctx.lineWidth = 2.2;
      const r1 = top + h * 0.34;
      const r2 = top + h * 0.67;
      ctx.beginPath();
      ctx.moveTo(left, r1);
      ctx.lineTo(left + w, r1);
      ctx.moveTo(left, r2);
      ctx.lineTo(left + w, r2);
      // Staggered vertical mortar joints
      ctx.moveTo(left + w * 0.5, top);
      ctx.lineTo(left + w * 0.5, r1);
      ctx.moveTo(left + w * 0.25, r1);
      ctx.lineTo(left + w * 0.25, r2);
      ctx.moveTo(left + w * 0.75, r1);
      ctx.lineTo(left + w * 0.75, r2);
      ctx.moveTo(left + w * 0.5, r2);
      ctx.lineTo(left + w * 0.5, top + h);
      ctx.stroke();

      // Top highlight on each brick row
      ctx.fillStyle = 'rgba(255, 220, 195, 0.32)';
      ctx.fillRect(left + 2, top + 2, w - 4, 3);
      ctx.fillRect(left + 2, r1 + 2, w - 4, 2.5);
      ctx.fillRect(left + 2, r2 + 2, w - 4, 2.5);
      ctx.restore();

      drawRoundedRect(ctx, left, top, w, h, 6);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.8;
      ctx.stroke();
    } else if (b.kind === 'platform') {
      // Cheerful Mario floating grass-topped timber bridge platform!
      const grassLip = Math.max(8, h * 0.36);

      // Soft drop shadow beneath floating platform
      ctx.fillStyle = 'rgba(15, 23, 42, 0.2)';
      drawRoundedRect(ctx, left + 4, top + 7, w, h, 9);
      ctx.fill();

      // Warm oak plank body
      drawRoundedRect(ctx, left, top, w, h, 9);
      const woodGrad = ctx.createLinearGradient(left, top, left, top + h);
      woodGrad.addColorStop(0, '#b47440');
      woodGrad.addColorStop(1, '#7c4820');
      ctx.fillStyle = woodGrad;
      ctx.fill();

      // Vertical plank seams & bolts
      ctx.save();
      drawRoundedRect(ctx, left, top, w, h, 9);
      ctx.clip();
      const plankW = ppu * 0.9;
      ctx.strokeStyle = 'rgba(54, 26, 8, 0.45)';
      ctx.lineWidth = 2;
      for (let px = left + plankW; px < left + w - 4; px += plankW) {
        ctx.beginPath();
        ctx.moveTo(px, top + grassLip);
        ctx.lineTo(px, top + h);
        ctx.stroke();
      }
      // Lush overhanging grass deck on top
      const topGrad = ctx.createLinearGradient(0, top, 0, top + grassLip);
      topGrad.addColorStop(0, '#86efac');
      topGrad.addColorStop(0.45, '#22c55e');
      topGrad.addColorStop(1, '#15803d');
      ctx.fillStyle = topGrad;
      ctx.fillRect(left, top, w, grassLip);

      // Iron corner bolts
      ctx.fillStyle = '#3f2e22';
      ctx.beginPath();
      ctx.arc(left + 11, top + h - 10, 3.2, 0, Math.PI * 2);
      ctx.arc(left + w - 11, top + h - 10, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawRoundedRect(ctx, left, top, w, h, 9);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.stroke();
    } else if (b.kind === 'pause') {
      // Iconic Super Mario Run Red Pause Block with white '||'
      drawRoundedRect(ctx, left, top, w, h, 8);
      const pGrad = ctx.createLinearGradient(left, top, left, top + h);
      pGrad.addColorStop(0, '#f87171');
      pGrad.addColorStop(0.35, '#ef4444');
      pGrad.addColorStop(1, '#b91c1c');
      ctx.fillStyle = pGrad;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.8;
      ctx.stroke();

      // White Pause bars
      const barW = Math.max(4, w * 0.11);
      const barH = h * 0.56;
      const barY = top + (h - barH) * 0.5;
      ctx.fillStyle = '#ffffff';
      drawRoundedRect(ctx, left + w * 0.34, barY, barW, barH, 2.5);
      ctx.fill();
      drawRoundedRect(ctx, left + w * 0.55, barY, barW, barH, 2.5);
      ctx.fill();
    } else if (b.kind === 'spring') {
      // Bouncy Mario Spring Pad!
      const baseH = h * 0.28;
      const topH = h * 0.34;
      const compress = b.hitAnimTimer > 0 ? Math.sin((b.hitAnimTimer / 0.25) * Math.PI) * h * 0.28 : 0;
      const padTop = top + compress;

      // Steel coil zigzag
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const coilTop = padTop + topH - 2;
      const coilBot = top + h - baseH + 2;
      const midY = (coilTop + coilBot) * 0.5;
      ctx.moveTo(left + w * 0.24, coilTop);
      ctx.lineTo(left + w * 0.76, midY);
      ctx.lineTo(left + w * 0.24, coilBot);
      ctx.moveTo(left + w * 0.76, coilTop);
      ctx.lineTo(left + w * 0.24, midY);
      ctx.lineTo(left + w * 0.76, coilBot);
      ctx.stroke();

      // Metallic base
      drawRoundedRect(ctx, left + 4, top + h - baseH, w - 8, baseH, 4);
      ctx.fillStyle = '#475569';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // Plump cushioned crimson top bounce pad
      drawRoundedRect(ctx, left, padTop, w, topH, 7);
      const padGrad = ctx.createLinearGradient(left, padTop, left, padTop + topH);
      padGrad.addColorStop(0, '#fb7185');
      padGrad.addColorStop(0.5, '#e11d48');
      padGrad.addColorStop(1, '#9f1239');
      ctx.fillStyle = padGrad;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.stroke();

      // White stripe highlight
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(left + w * 0.22, padTop + topH * 0.28, w * 0.56, 3.5);
    }

    // Wet glossy rain sheen across top edge of any block during rain!
    if (weather.wetness > 0.12) {
      ctx.fillStyle = `rgba(224, 242, 254, ${weather.wetness * 0.42})`;
      drawRoundedRect(ctx, left + 4, top + 2, w - 8, 4.5, 2);
      ctx.fill();
    }

    ctx.restore();
  };

  const drawCoin = (c: CoinEntity, ppu: number, groundY: number) => {
    if (c.collected) return;
    const sx = (c.x - cameraX) * ppu;
    if (sx < -50 || sx > width + 50) return;

    const bob = Math.sin(visualTime * 4.4 + c.x * 0.65) * 4.5;
    const sy = groundY - c.y * ppu + bob;
    const spin = Math.cos(visualTime * (c.isStarCoin ? 3.4 : 4.8) + c.x * 0.8);
    const scaleX = Math.max(0.22, Math.abs(spin));
    const r = ppu * (c.isStarCoin ? 0.54 : 0.34);

    ctx.save();
    ctx.translate(sx, sy);

    // Soft radiant aura for Pink Star Coins
    if (c.isStarCoin) {
      const aura = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.85);
      aura.addColorStop(0, 'rgba(244, 114, 182, 0.55)');
      aura.addColorStop(1, 'rgba(244, 114, 182, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.85, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.scale(scaleX, 1);

    // Coin edge thickness illusion
    ctx.fillStyle = c.isStarCoin ? '#be185d' : '#b45309';
    ctx.beginPath();
    ctx.ellipse(3.5 / scaleX, 0, r, r, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main glossy coin face
    const coinGrad = ctx.createLinearGradient(-r, -r, r, r);
    if (c.isStarCoin) {
      coinGrad.addColorStop(0, '#fbcfe8');
      coinGrad.addColorStop(0.45, '#ec4899');
      coinGrad.addColorStop(1, '#db2777');
    } else {
      coinGrad.addColorStop(0, '#fef9c3');
      coinGrad.addColorStop(0.42, '#facc15');
      coinGrad.addColorStop(1, '#d97706');
    }
    ctx.fillStyle = coinGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4 / Math.sqrt(scaleX);
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = c.isStarCoin ? 'rgba(255,255,255,0.65)' : 'rgba(254, 240, 138, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
    ctx.stroke();

    if (c.isStarCoin) {
      // Crisp 5-point white star inside Pink Coin
      drawStarPath(ctx, 0, 0, r * 0.54, r * 0.24);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      // Classic Mario vertical embossed center slot
      ctx.fillStyle = '#b45309';
      drawRoundedRect(ctx, -r * 0.16, -r * 0.45, r * 0.32, r * 0.9, 3);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      drawRoundedRect(ctx, -r * 0.1, -r * 0.42, r * 0.14, r * 0.82, 2);
      ctx.fill();
    }

    ctx.restore();
  };

  const drawEnemy = (e: PatrolEnemy, ppu: number, groundY: number) => {
    if (!e.alive && e.squashedTimer <= 0) return;
    const sx = (e.x - cameraX) * ppu;
    if (sx < -60 || sx > width + 60) return;

    const sy = groundY - e.y * ppu;
    const w = e.width * ppu;
    const h = e.height * ppu;

    ctx.save();
    ctx.translate(sx, sy);

    // Contact shadow
    ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.48, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!e.alive) {
      // Flat squashed pancake critter!
      ctx.scale(1.32, 0.32);
    }

    const waddle = e.alive ? Math.sin(visualTime * 11 + e.x * 2) : 0;

    // Waddling dark chestnut shoes
    ctx.fillStyle = '#2c1810';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(-w * 0.24, -h * 0.1 + waddle * 3, w * 0.24, h * 0.14, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(w * 0.24, -h * 0.1 - waddle * 3, w * 0.24, h * 0.14, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Cream mushroom stem
    ctx.fillStyle = '#fde6c4';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.28, w * 0.32, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Classic plump chestnut Goomba-style mushroom cap
    ctx.rotate(waddle * 0.08);
    const capGrad = ctx.createRadialGradient(-w * 0.14, -h * 0.78, w * 0.08, 0, -h * 0.6, w * 0.62);
    capGrad.addColorStop(0, '#d97736');
    capGrad.addColorStop(0.55, '#9a4319');
    capGrad.addColorStop(1, '#5e2309');
    ctx.fillStyle = capGrad;

    ctx.beginPath();
    ctx.moveTo(-w * 0.54, -h * 0.36);
    ctx.bezierCurveTo(-w * 0.62, -h * 0.75, -w * 0.22, -h * 1.04, 0, -h * 1.04);
    ctx.bezierCurveTo(w * 0.22, -h * 1.04, w * 0.62, -h * 0.75, w * 0.54, -h * 0.36);
    ctx.quadraticCurveTo(0, -h * 0.24, -w * 0.54, -h * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Expressive eyes & furrowed angry V-eyebrows
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-w * 0.17, -h * 0.56, w * 0.11, h * 0.15, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.17, -h * 0.56, w * 0.11, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Pupils looking toward the runner
    const lookDir = e.vx < 0 ? -1 : 1;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-w * 0.17 + lookDir * 2.2, -h * 0.55, w * 0.055, 0, Math.PI * 2);
    ctx.arc(w * 0.17 + lookDir * 2.2, -h * 0.55, w * 0.055, 0, Math.PI * 2);
    ctx.fill();

    // Furrowed V-brow
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, -h * 0.73);
    ctx.lineTo(0, -h * 0.61);
    ctx.lineTo(w * 0.32, -h * 0.73);
    ctx.stroke();

    ctx.restore();
  };

  const drawPlayer = (state: SimulationState, ppu: number, groundY: number) => {
    const p = state.player;
    const sx = (p.x - cameraX) * ppu;
    const sy = groundY - p.y * ppu;
    const scaleBase = p.isSuper ? 1.1 : 1.0;

    // Project soft ground/block shadow directly below the player
    let shadowSurfaceY: number | null = null;
    // Check if over solid ground
    let overGap = false;
    for (const g of state.gaps) {
      if (p.x > g.startX + 0.15 && p.x < g.endX - 0.15) {
        overGap = true;
        break;
      }
    }
    if (!overGap) {
      shadowSurfaceY = 0;
    }
    for (const b of state.blocks) {
      if (b.broken || b.kind === 'goal_flag') continue;
      if (p.x >= b.x - b.width * 0.52 && p.x <= b.x + b.width * 0.52) {
        const top = b.y + b.height;
        if (top <= p.y + 0.15 && (shadowSurfaceY === null || top > shadowSurfaceY)) {
          shadowSurfaceY = top;
        }
      }
    }
    if (shadowSurfaceY !== null && p.y >= shadowSurfaceY - 0.1) {
      const alt = Math.max(0, p.y - shadowSurfaceY);
      const shadowScale = clamp(1 - alt * 0.12, 0.25, 1);
      ctx.fillStyle = `rgba(15, 23, 42, ${0.32 * shadowScale})`;
      ctx.beginPath();
      ctx.ellipse(
        sx,
        groundY - shadowSurfaceY * ppu + 2,
        ppu * 0.44 * shadowScale,
        5.5 * shadowScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Invulnerability flicker
    if (p.invulnTimer > 0 && Math.floor(visualTime * 16) % 2 === 0 && !p.inBubble) {
      return;
    }

    const h = p.height * ppu * scaleBase;
    const w = p.width * ppu * scaleBase;

    ctx.save();
    ctx.translate(sx, sy);

    // Squash & stretch anchored at boots
    const stretchY = p.squashY;
    const stretchX = 1 / Math.sqrt(Math.max(0.5, stretchY));
    ctx.scale(stretchX, stretchY);

    // Dynamic parkour transforms around player torso center
    ctx.translate(0, -h * 0.5);
    if (p.vaultTimer > 0) {
      const vaultProg = 1 - p.vaultTimer / 0.25;
      ctx.rotate(vaultProg * Math.PI * 2);
    } else if (p.spinTimer > 0) {
      const spinProg = 1 - p.spinTimer / 0.36;
      ctx.scale(Math.cos(spinProg * Math.PI * 2), 1);
    } else if (!p.grounded && !p.inBubble && p.flagpoleSlideTimer <= 0) {
      ctx.rotate(clamp(-p.vy * 0.015, -0.18, 0.14));
    } else if (p.grounded && p.vx > 0.15) {
      ctx.rotate(clamp(p.vx / 11.4, 0, 1) * 0.1); // Lean scales with voice run speed
    }
    ctx.translate(0, h * 0.5);

    // Subtle Super gold shimmer aura
    if (p.isSuper) {
      const aura = ctx.createRadialGradient(0, -h * 0.5, w * 0.2, 0, -h * 0.5, h * 0.72);
      aura.addColorStop(0, 'rgba(254, 240, 138, 0.32)');
      aura.addColorStop(1, 'rgba(254, 240, 138, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, -h * 0.5, h * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stride angles — strictly 0 when stationary (no sound)
    const isRunning = p.grounded && p.vx > 0.15 && !p.inBubble && p.flagpoleSlideTimer <= 0;
    const speedBlend = isRunning ? clamp(p.vx / 5.5, 0.35, 1) : 0;
    const stride = isRunning ? Math.sin(p.runCycle) * speedBlend : 0;
    const bob = isRunning ? Math.abs(Math.cos(p.runCycle)) * 4.5 * speedBlend : 0;

    // Scratch-style AI Costume Selector:
    // - Airborne/jump -> 'jump' costume
    // - Silent/still  -> 'stand' costume
    // - Slow creep    -> flips gently through [stand, step, runA, step]
    // - Fast sprint   -> flips rapidly through [step, runA, runB, runA]
    let activeCostume: ChromaKeyCostume;
    if (!p.grounded || p.flagpoleSlideTimer > 0) {
      activeCostume = runnerCostumes.jump;
    } else if (!isRunning) {
      activeCostume = runnerCostumes.stand;
    } else if (p.vx < 4.5) {
      const walkFrames = [
        runnerCostumes.stand,
        runnerCostumes.step,
        runnerCostumes.runA,
        runnerCostumes.step,
      ];
      const idx = ((Math.floor(p.runCycle * 0.72) % walkFrames.length) + walkFrames.length) % walkFrames.length;
      activeCostume = walkFrames[idx];
    } else {
      const sprintFrames = [
        runnerCostumes.step,
        runnerCostumes.runA,
        runnerCostumes.runB,
        runnerCostumes.runA,
      ];
      const idx = ((Math.floor(p.runCycle * 0.85) % sprintFrames.length) + sprintFrames.length) % sprintFrames.length;
      activeCostume = sprintFrames[idx];
    }

    if (activeCostume.ready && activeCostume.canvas) {
      const spriteBob = isRunning ? Math.abs(Math.sin(p.runCycle)) * 3.0 * speedBlend : 0;
      const spriteSize = h * 1.24;
      const drawX = -activeCostume.centerXFrac * spriteSize;
      const drawY = -activeCostume.bottomFrac * spriteSize + 2 - spriteBob;
      ctx.drawImage(activeCostume.canvas, drawX, drawY, spriteSize, spriteSize);
    } else {
      // Graceful procedural fallback for the brief initial image decode
      ctx.translate(0, -bob);

      const drawBoot = (x: number, y: number, rot: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = '#7c3f18';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(w * 0.08, 0, w * 0.24, h * 0.085, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#a15b2b';
        ctx.beginPath();
        ctx.ellipse(w * 0.1, -h * 0.025, w * 0.14, h * 0.032, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      const drawGlove = (x: number, y: number) => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, y, w * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };

      const isJumpingUp = !p.grounded && !p.inBubble && p.vy > 0 && p.flagpoleSlideTimer <= 0;

      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = w * 0.22;
      ctx.lineCap = 'round';
      const backHandX = isJumpingUp
        ? w * 0.32
        : p.flagpoleSlideTimer > 0
          ? w * 0.35
          : -stride * w * 0.36;
      const backHandY = isJumpingUp
        ? -h * 0.96
        : p.flagpoleSlideTimer > 0
          ? -h * 0.72
          : -h * 0.4 + Math.abs(stride) * 4;
      ctx.beginPath();
      ctx.moveTo(w * 0.05, -h * 0.56);
      ctx.lineTo(backHandX, backHandY);
      ctx.stroke();
      drawGlove(backHandX, backHandY);

      const backFootX = !p.grounded ? -w * 0.26 : -stride * w * 0.36;
      const backFootY = !p.grounded ? -h * 0.14 : -h * 0.08 - Math.max(0, -stride) * 7;
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = w * 0.25;
      ctx.beginPath();
      ctx.moveTo(-w * 0.06, -h * 0.3);
      ctx.lineTo(backFootX, backFootY);
      ctx.stroke();
      drawBoot(backFootX, backFootY, !p.grounded ? 0.35 : -stride * 0.45);

      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      drawRoundedRect(ctx, -w * 0.32, -h * 0.64, w * 0.64, h * 0.34, w * 0.22);
      ctx.fill();
      ctx.stroke();

      const overallGrad = ctx.createLinearGradient(-w * 0.3, -h * 0.56, w * 0.3, -h * 0.26);
      overallGrad.addColorStop(0, '#3b82f6');
      overallGrad.addColorStop(1, '#1d4ed8');
      ctx.fillStyle = overallGrad;
      drawRoundedRect(ctx, -w * 0.3, -h * 0.52, w * 0.62, h * 0.26, w * 0.16);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#2563eb';
      ctx.fillRect(w * 0.02, -h * 0.62, w * 0.14, h * 0.14);
      ctx.strokeRect(w * 0.02, -h * 0.62, w * 0.14, h * 0.14);

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(w * 0.1, -h * 0.47, w * 0.075, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const frontFootX = !p.grounded ? w * 0.28 : stride * w * 0.38;
      const frontFootY = !p.grounded ? -h * 0.2 : -h * 0.08 - Math.max(0, stride) * 7;
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = w * 0.26;
      ctx.beginPath();
      ctx.moveTo(w * 0.05, -h * 0.3);
      ctx.lineTo(frontFootX, frontFootY);
      ctx.stroke();
      drawBoot(frontFootX, frontFootY, !p.grounded ? -0.32 : stride * 0.45);

      const headY = -h * 0.78;
      const headR = w * 0.36;

      ctx.fillStyle = '#5c3317';
      ctx.beginPath();
      ctx.arc(-headR * 0.72, headY + headR * 0.18, headR * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fed7aa';
      ctx.beginPath();
      ctx.arc(headR * 0.08, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = '#fdba74';
      ctx.beginPath();
      ctx.ellipse(headR * 0.92, headY + headR * 0.08, headR * 0.32, headR * 0.24, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(headR * 0.45, headY - headR * 0.12, headR * 0.22, headR * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.ellipse(headR * 0.52, headY - headR * 0.12, headR * 0.12, headR * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(headR * 0.55, headY - headR * 0.2, headR * 0.06, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#7c2d12';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(headR * 0.42, headY + headR * 0.28, headR * 0.24, 0.1, Math.PI * 0.65);
      ctx.stroke();

      const capGrad = ctx.createLinearGradient(-headR, headY - headR * 1.15, headR, headY - headR * 0.1);
      capGrad.addColorStop(0, '#f87171');
      capGrad.addColorStop(0.45, '#ef4444');
      capGrad.addColorStop(1, '#b91c1c');
      ctx.fillStyle = capGrad;
      ctx.beginPath();
      ctx.arc(0, headY - headR * 0.22, headR * 1.06, Math.PI * 0.96, Math.PI * 2.02);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(headR * 0.78, headY - headR * 0.28, headR * 0.64, headR * 0.2, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(headR * 0.48, headY - headR * 0.66, headR * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b91c1c';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      const frontHandX = isJumpingUp
        ? -w * 0.28
        : p.flagpoleSlideTimer > 0
          ? w * 0.35
          : stride * w * 0.36;
      const frontHandY = isJumpingUp
        ? -h * 0.36
        : p.flagpoleSlideTimer > 0
          ? -h * 0.52
          : -h * 0.42 + Math.abs(stride) * 3;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = w * 0.22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-w * 0.08, -h * 0.54);
      ctx.lineTo(frontHandX, frontHandY);
      ctx.stroke();
      drawGlove(frontHandX, frontHandY);
    }

    // Mid-air spin swirl ring
    if (p.spinTimer > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.45, w * 0.85, h * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Super Mario Run Iridescent Rescue Bubble!
    if (p.inBubble) {
      const br = h * 0.72;
      const bGrad = ctx.createRadialGradient(-br * 0.32, -h * 0.5 - br * 0.3, br * 0.1, 0, -h * 0.5, br);
      bGrad.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
      bGrad.addColorStop(0.55, 'rgba(186, 230, 253, 0.25)');
      bGrad.addColorStop(0.85, 'rgba(244, 114, 182, 0.38)');
      bGrad.addColorStop(1, 'rgba(125, 211, 252, 0.65)');
      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.arc(0, -h * 0.5, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.lineWidth = 2.6;
      ctx.stroke();

      // Glossy bubble crescent reflection
      ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
      ctx.beginPath();
      ctx.ellipse(-br * 0.36, -h * 0.5 - br * 0.36, br * 0.22, br * 0.11, -0.65, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  const drawParticlesAndPopups = (ppu: number, groundY: number) => {
    // Particles
    for (const pt of particles) {
      const alpha = clamp(pt.life / pt.maxLife, 0, 1);
      const sx = (pt.x - cameraX) * ppu;
      const sy = groundY - pt.y * ppu;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);

      if (pt.kind === 'ring') {
        const radius = pt.size * ppu * (1.55 - alpha * 0.9);
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 4 * alpha + 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (pt.kind === 'brick') {
        ctx.rotate(pt.rotation);
        const s = pt.size * ppu;
        ctx.fillStyle = pt.color;
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s * 0.72);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(-s * 0.5, -s * 0.5, s, s * 0.72);
      } else if (pt.kind === 'star') {
        ctx.rotate(pt.rotation);
        const r = pt.size * ppu * (0.6 + alpha * 0.5);
        drawStarPath(ctx, 0, 0, r, r * 0.45);
        ctx.fillStyle = pt.color;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else if (pt.kind === 'dust') {
        const r = pt.size * ppu * (1.4 - alpha * 0.5);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const r = pt.size * ppu * alpha;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Crisp Mario-style floating score popups
    for (const pop of popups) {
      const alpha = clamp(pop.life / pop.maxLife, 0, 1);
      const sx = (pop.x - cameraX) * ppu;
      const sy = groundY - pop.y * ppu;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.4);
      ctx.font = `900 ${Math.round(18 * pop.scale)}px "Chakra Petch", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.strokeText(pop.text, sx, sy);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, sx, sy);
      ctx.restore();
    }
  };

  const drawRainAndAtmosphere = (
    atmo: DayNightAtmosphere,
    weather: WeatherAtmosphere,
    dt: number,
    ppu: number,
    groundY: number,
  ) => {
    // 1. Diagonal 2D Rain Streaks & Ground Splashes
    if (weather.rainIntensity > 0.03) {
      const activeDrops = Math.floor(rainDrops.length * clamp(weather.rainIntensity * 1.15, 0.12, 1));
      const windDx = -(0.18 + weather.windStrength * 0.42);
      const isNight = atmo.nightBackdropWeight > 0.5;

      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < activeDrops; i++) {
        const d = rainDrops[i];
        const fallSpeed = d.speed * (0.95 + weather.rainIntensity * 0.75) * (d.layer === 1 ? 1.25 : 0.85);
        d.ry += fallSpeed * dt;
        d.rx += windDx * fallSpeed * dt * 0.55;
        if (d.ry > 1.06) {
          d.ry -= 1.12;
          d.rx = Math.random();
        }
        if (d.rx < -0.1) d.rx += 1.2;

        const x1 = d.rx * width;
        const y1 = d.ry * height;
        const len = d.len * (d.layer === 1 ? 1.35 : 0.85);
        const x2 = x1 + windDx * len * 0.9;
        const y2 = y1 + len;

        ctx.strokeStyle = isNight
          ? `rgba(186, 230, 253, ${weather.rainIntensity * (d.layer === 1 ? 0.5 : 0.28)})`
          : `rgba(224, 242, 254, ${weather.rainIntensity * (d.layer === 1 ? 0.62 : 0.34)})`;
        ctx.lineWidth = d.layer === 1 ? 2.1 : 1.3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // Spawn ground splashes
      splashAccum += dt * weather.rainIntensity * 28;
      while (splashAccum >= 1) {
        splashAccum -= 1;
        rainSplashes.push({
          x: cameraX + Math.random() * (width / ppu),
          y: 0,
          life: 0.26,
          maxLife: 0.26,
        });
      }
    }

    // Update & render ground raindrop splash ellipses
    for (let i = rainSplashes.length - 1; i >= 0; i--) {
      const sp = rainSplashes[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        rainSplashes.splice(i, 1);
        continue;
      }
      const prog = 1 - sp.life / sp.maxLife;
      const sx = (sp.x - cameraX) * ppu;
      const sy = groundY - sp.y * ppu + 2;
      ctx.strokeStyle = `rgba(224, 242, 254, ${(1 - prog) * 0.65})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 3 + prog * 11, 1.5 + prog * 3.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. Subtle unified foreground color grading so foreground Mario entities harmonize with Sunset / Night / Rain
    if (atmo.sunsetBackdropWeight > 0.08) {
      ctx.fillStyle = `rgba(255, 146, 72, ${atmo.sunsetBackdropWeight * 0.1})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (atmo.nightBackdropWeight > 0.08) {
      ctx.fillStyle = `rgba(12, 24, 58, ${atmo.nightBackdropWeight * 0.24})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (weather.rainIntensity > 0.1) {
      // Soft atmospheric rain mist near ground horizon
      const mistGrad = ctx.createLinearGradient(0, groundY - 120, 0, height);
      mistGrad.addColorStop(0, 'rgba(186, 210, 232, 0)');
      mistGrad.addColorStop(1, `rgba(186, 210, 232, ${weather.rainIntensity * 0.16})`);
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, groundY - 120, width, height - (groundY - 120));
    }
  };

  const renderFrame = (state: SimulationState, dt: number) => {
    const ppu = clamp(height / 10.2, 36, 96);
    const groundY = Math.round(height * 0.8);

    // Smooth camera tracking with generous look-ahead (~74% ahead of player)
    const targetCamX = state.player.x - (width / ppu) * 0.26;
    const targetCamY = Math.max(0, (state.player.y - 4.2) * 0.35);

    if (!hasCameraInit || Math.abs(targetCamX - cameraX) > 12) {
      cameraX = targetCamX;
      cameraY = targetCamY;
      hasCameraInit = true;
    } else {
      const followRate = 1 - Math.exp(-10 * dt);
      cameraX += (targetCamX - cameraX) * followRate;
      cameraY += (targetCamY - cameraY) * followRate;
    }

    const effectiveGroundY = groundY + cameraY * ppu;
    const atmo = computeDayNightAtmosphere(state.timeOfDay);
    const weather = computeWeatherAtmosphere(
      state.weatherPhase,
      state.surfaceWetness,
      state.elapsedRunSeconds,
    );

    ctx.save();
    ctx.scale(dpr, dpr);

    // Layer 1: Crossfaded AI Mario 2D Backdrops + Weather Sky + Lightning + Fireflies
    drawSkyAndBackdrops(atmo, weather, effectiveGroundY);

    // Layer 2: Drifting Mario Clouds + Midground Hills, Trees & Bushes
    drawDriftingClouds(atmo, weather, effectiveGroundY);
    drawMidgroundProps(atmo, weather, ppu, effectiveGroundY);

    // Layer 3: Sparkling Ravine Rivers & Checkered Lush Mario Ground + Rain Puddles
    drawGroundAndRivers(state.gaps, atmo, weather, ppu, effectiveGroundY);

    // Layer 4: Glossy 2D Mario Blocks, Pipes, Platforms, Castles, Coins & Enemies
    for (let i = 0; i < state.blocks.length; i++) {
      drawBlock(state.blocks[i], atmo, weather, ppu, effectiveGroundY);
    }
    for (let i = 0; i < state.coins.length; i++) {
      drawCoin(state.coins[i], ppu, effectiveGroundY);
    }
    for (let i = 0; i < state.enemies.length; i++) {
      drawEnemy(state.enemies[i], ppu, effectiveGroundY);
    }

    // Layer 5: Expressive Animated 2D Mario-Style Runner Hero
    drawPlayer(state, ppu, effectiveGroundY);

    // Layer 6: Juice Particles, Floating Popups, Diagonal Rain & Unified Lighting Grade
    drawParticlesAndPopups(ppu, effectiveGroundY);
    drawRainAndAtmosphere(atmo, weather, dt, ppu, effectiveGroundY);

    ctx.restore();
  };

  let rafId = 0;
  let lastMs = performance.now();
  let disposed = false;

  const loop = (nowMs: number) => {
    if (disposed) return;
    rafId = requestAnimationFrame(loop);

    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastMs) / 1000));
    lastMs = nowMs;
    visualTime += dt;

    onTick(dt, nowMs);

    if (latestState) {
      renderFrame(latestState, dt);
    }
  };

  rafId = requestAnimationFrame(loop);

  return {
    syncSimulation(state: SimulationState, dt: number) {
      latestState = state;
      updateVfxFromSimulation(state, dt);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
    },
  };
}

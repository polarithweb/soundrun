import type { DayPhaseLabel } from './types';

export interface DayNightAtmosphere {
  phaseLabel: DayPhaseLabel;
  sunElevation: number; // -1 (midnight) to +1 (high noon)
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  sunIntensity: number;
  hemiSkyColor: [number, number, number];
  hemiGroundColor: [number, number, number];
  hemiIntensity: number;
  fogColor: [number, number, number];
  fogDensity: number;
  lampGlow: number; // 0 (off in day) to 1 (full at night)
  dayBackdropWeight: number;
  sunsetBackdropWeight: number;
  nightBackdropWeight: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function advanceTimeOfDay(
  current: number,
  dt: number,
  cycleSeconds = 90,
): number {
  const next = (current + dt / Math.max(1, cycleSeconds)) % 1;
  return next < 0 ? next + 1 : next;
}

export function getDayPhaseLabel(timeOfDay: number): DayPhaseLabel {
  const t = ((timeOfDay % 1) + 1) % 1;
  if (t < 0.22 || t >= 0.92) return 'Day';
  if (t < 0.42) return 'Golden Hour';
  if (t < 0.78) return 'Night';
  return 'Dawn';
}

// Smoothly interpolates lighting, fog, streetlamps, and AI panorama weights
// t = 0.00: Bright Noon Day
// t = 0.30: Golden Hour Sunset
// t = 0.60: Clear Starry Meadow Night
// t = 0.86: Fresh Coastal Dawn
export function computeDayNightAtmosphere(timeOfDay: number): DayNightAtmosphere {
  const t = ((timeOfDay % 1) + 1) % 1;
  const phaseLabel = getDayPhaseLabel(t);

  // Sun angle: highest at t=0, sets around t=0.35, lowest at t=0.60, rises at t=0.85
  const angle = t * Math.PI * 2;
  const sunElevation = Math.cos(angle); // +1 at noon, -1 at t=0.5

  // Compute panorama crossfade weights summing to 1.0
  let dayW = 0;
  let sunsetW = 0;
  let nightW = 0;

  if (t < 0.18) {
    dayW = 1;
  } else if (t < 0.32) {
    const k = clamp01((t - 0.18) / 0.14);
    dayW = 1 - k;
    sunsetW = k;
  } else if (t < 0.45) {
    const k = clamp01((t - 0.32) / 0.13);
    sunsetW = 1 - k;
    nightW = k;
  } else if (t < 0.76) {
    nightW = 1;
  } else if (t < 0.88) {
    const k = clamp01((t - 0.76) / 0.12);
    nightW = 1 - k;
    sunsetW = k;
  } else {
    const k = clamp01((t - 0.88) / 0.12);
    sunsetW = 1 - k;
    dayW = k;
  }

  // Palette anchors (linear 0..1 RGB)
  const daySun: [number, number, number] = [1.0, 0.96, 0.88];
  const sunsetSun: [number, number, number] = [1.0, 0.56, 0.22];
  const nightMoon: [number, number, number] = [0.42, 0.58, 0.92];

  const dayHemiSky: [number, number, number] = [0.53, 0.81, 0.98];
  const sunsetHemiSky: [number, number, number] = [0.95, 0.52, 0.38];
  const nightHemiSky: [number, number, number] = [0.11, 0.17, 0.34];

  const dayHemiGround: [number, number, number] = [0.22, 0.34, 0.19];
  const sunsetHemiGround: [number, number, number] = [0.26, 0.18, 0.14];
  const nightHemiGround: [number, number, number] = [0.05, 0.07, 0.11];

  const dayFog: [number, number, number] = [0.68, 0.84, 0.96];
  const sunsetFog: [number, number, number] = [0.85, 0.52, 0.36];
  const nightFog: [number, number, number] = [0.06, 0.09, 0.18];

  const blendColor = (
    d: [number, number, number],
    s: [number, number, number],
    n: [number, number, number],
  ): [number, number, number] => [
    d[0] * dayW + s[0] * sunsetW + n[0] * nightW,
    d[1] * dayW + s[1] * sunsetW + n[1] * nightW,
    d[2] * dayW + s[2] * sunsetW + n[2] * nightW,
  ];

  const sunColor = blendColor(daySun, sunsetSun, nightMoon);
  const hemiSkyColor = blendColor(dayHemiSky, sunsetHemiSky, nightHemiSky);
  const hemiGroundColor = blendColor(dayHemiGround, sunsetHemiGround, nightHemiGround);
  const fogColor = blendColor(dayFog, sunsetFog, nightFog);

  const sunIntensity = dayW * 2.4 + sunsetW * 1.65 + nightW * 0.65;
  const hemiIntensity = dayW * 0.95 + sunsetW * 0.72 + nightW * 0.42;
  const fogDensity = dayW * 0.0085 + sunsetW * 0.011 + nightW * 0.0135;
  const lampGlow = clamp01(sunsetW * 0.45 + nightW * 1.0);

  // Keep key directional light angled slightly forward-left so shadows look crisp
  const lightX = -0.35 + Math.sin(angle) * 0.55;
  const lightY = Math.max(0.28, Math.abs(sunElevation) * 0.85 + 0.25);
  const lightZ = 0.55;

  // Ensure exact normalized color fallback
  const safeFog = lerpRgb(fogColor, fogColor, 0);

  return {
    phaseLabel,
    sunElevation,
    sunDirection: [lightX, lightY, lightZ],
    sunColor,
    sunIntensity,
    hemiSkyColor,
    hemiGroundColor,
    hemiIntensity,
    fogColor: safeFog,
    fogDensity,
    lampGlow,
    dayBackdropWeight: dayW,
    sunsetBackdropWeight: sunsetW,
    nightBackdropWeight: nightW,
  };
}

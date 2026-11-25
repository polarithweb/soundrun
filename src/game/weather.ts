import type { WeatherStateLabel } from './types';

export interface WeatherAtmosphere {
  stateLabel: WeatherStateLabel;
  cloudCover: number; // 0 (clear) .. 1 (heavy overcast/storm)
  rainIntensity: number; // 0 (dry) .. 1 (heavy downpour)
  wetness: number; // 0 (dry) .. 1 (soaked puddles)
  windStrength: number; // 0.25 (gentle breeze) .. 1.0 (storm gust)
  lightningFlash: number; // 0 .. 1 brief atmospheric lightning pulse
  sunAttenuation: number; // 1.0 (clear) .. 0.24 (rainstorm)
  fogBoost: number; // additional FogExp2 density from mist & rain
  skyDesaturation: number; // 0 (vibrant clear) .. 0.72 (storm slate)
  exposureMultiplier: number; // 1.0 .. 0.84
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Advances continuous weather cycle phase in [0, 1).
 * Uses a 68-second harmonic period so weather shifts organically against the 90-second day-night cycle.
 */
export function advanceWeatherPhase(
  current: number,
  dt: number,
  cycleSeconds = 68,
): number {
  const next = (current + dt / Math.max(1, cycleSeconds)) % 1;
  return next < 0 ? next + 1 : next;
}

/**
 * Physically integrates surface wetness: puddles form rapidly during rain and evaporate gradually after rain stops.
 */
export function updateSurfaceWetness(
  currentWetness: number,
  rainIntensity: number,
  dt: number,
): number {
  const safeDt = Math.max(0, Math.min(0.25, dt));
  const safeRain = clamp01(rainIntensity);
  if (safeRain > 0.08) {
    return clamp01(currentWetness + safeRain * 0.22 * safeDt);
  }
  return clamp01(currentWetness - 0.055 * safeDt);
}

export function getWeatherStateLabel(weatherPhase: number): WeatherStateLabel {
  const w = ((weatherPhase % 1) + 1) % 1;
  if (w < 0.36 || w >= 0.96) return 'Clear';
  if (w < 0.62 || w >= 0.88) return 'Overcast';
  return 'Rainy';
}

/**
 * Computes smooth environmental weather weights for lighting, fog, sky, water, foliage, and wetness shaders.
 * Timeline:
 *  - 0.00..0.32: Clear bright sky
 *  - 0.32..0.46: Clouds roll in -> Overcast
 *  - 0.46..0.58: Overcast brooding sky
 *  - 0.58..0.68: Rain begins and intensifies -> Rainy
 *  - 0.68..0.84: Steady rain shower with gusts and occasional distant lightning
 *  - 0.84..0.92: Rain subsides back to Overcast
 *  - 0.92..1.00: Clouds part back to Clear
 */
export function computeWeatherAtmosphere(
  weatherPhase: number,
  surfaceWetness: number,
  elapsedSeconds = 0,
): WeatherAtmosphere {
  const w = ((weatherPhase % 1) + 1) % 1;
  const stateLabel = getWeatherStateLabel(w);

  // Cloud cover rises smoothly from Clear -> Overcast -> Rainy, then clears near 1.0
  const cloudIn = smoothstep(0.28, 0.48, w);
  const cloudOut = 1 - smoothstep(0.9, 0.99, w);
  const stormExtra = smoothstep(0.56, 0.68, w) * (1 - smoothstep(0.84, 0.92, w));
  const cloudCover = clamp01(cloudIn * cloudOut * 0.76 + stormExtra * 0.24);

  // Rain intensity ramps in during the rainy window
  const rainIn = smoothstep(0.58, 0.68, w);
  const rainOut = 1 - smoothstep(0.82, 0.91, w);
  const rainIntensity = clamp01(rainIn * rainOut);

  const wetness = clamp01(Math.max(surfaceWetness, rainIntensity * 0.35));

  // Wind strengthens progressively from gentle meadow breeze -> overcast gusts -> rain squalls
  const gustWave =
    0.5 + 0.5 * Math.sin(elapsedSeconds * 1.15) * Math.cos(elapsedSeconds * 0.47);
  const windStrength = clamp01(
    0.22 + cloudCover * 0.28 + rainIntensity * (0.36 + gustWave * 0.14),
  );

  // Occasional brief atmospheric lightning pulse during peak rain
  let lightningFlash = 0;
  if (rainIntensity > 0.65) {
    const cycle = (elapsedSeconds * 0.19) % 1;
    if (cycle > 0.965) {
      const local = (cycle - 0.965) / 0.035;
      // Sharp double-flicker envelope
      const pulse =
        Math.exp(-Math.pow((local - 0.2) * 14, 2)) +
        0.65 * Math.exp(-Math.pow((local - 0.55) * 16, 2));
      lightningFlash = clamp01(pulse * (rainIntensity - 0.65) * 2.85);
    }
  }

  const sunAttenuation = clamp01(1.0 - cloudCover * 0.52 - rainIntensity * 0.26);
  const fogBoost = cloudCover * 0.005 + rainIntensity * 0.0085;
  const skyDesaturation = clamp01(cloudCover * 0.48 + rainIntensity * 0.28);
  const exposureMultiplier = 1.0 - cloudCover * 0.08 - rainIntensity * 0.08;

  return {
    stateLabel,
    cloudCover,
    rainIntensity,
    wetness,
    windStrength,
    lightningFlash,
    sunAttenuation,
    fogBoost,
    skyDesaturation,
    exposureMultiplier,
  };
}

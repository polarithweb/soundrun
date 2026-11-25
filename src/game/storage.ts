import type { AudioCalibration, PersistedSaveData } from './types';

const STORAGE_KEY = 'highway_echo_run_save_v2';

export const PLAYER_NAME_MAX_LENGTH = 24;
export const PLAYER_ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

/**
 * Sanitizes a player display name to strictly match firebase-blueprint.json constraints:
 * trims whitespace, strips control/HTML chars, collapses spaces, max 24 characters.
 */
export function sanitizePlayerName(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLAYER_NAME_MAX_LENGTH);
}

export function isValidPlayerId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length >= 4 &&
    id.length <= 64 &&
    PLAYER_ID_PATTERN.test(id)
  );
}

export function generateDevicePlayerId(): string {
  const ts = Date.now().toString(36);
  let rand = '';
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    rand = Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 10);
  } else {
    rand = Math.random().toString(36).slice(2, 12);
  }
  return `p_${ts}_${rand}`.slice(0, 32);
}

export function createDefaultSaveData(): PersistedSaveData {
  return {
    playerId: generateDevicePlayerId(),
    playerName: '',
    bestDistance: 0,
    bestScore: 0,
    totalCoinsBank: 0,
    calibration: {
      threshold: 0.12,
      sensitivity: 1.5,
    },
    mutedSfx: false,
  };
}

export function clampCalibration(
  cal: Partial<AudioCalibration> | undefined,
): AudioCalibration {
  const rawThreshold =
    typeof cal?.threshold === 'number' && Number.isFinite(cal.threshold)
      ? cal.threshold
      : 0.12;
  const rawSensitivity =
    typeof cal?.sensitivity === 'number' && Number.isFinite(cal.sensitivity)
      ? cal.sensitivity
      : 1.5;

  return {
    threshold: Math.min(0.48, Math.max(0.04, rawThreshold)),
    sensitivity: Math.min(3.0, Math.max(0.5, rawSensitivity)),
  };
}

export function loadSaveData(): PersistedSaveData {
  const fallback = createDefaultSaveData();
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      persistSaveData(fallback);
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedSaveData>;
    const playerId = isValidPlayerId(parsed.playerId)
      ? parsed.playerId
      : fallback.playerId;

    const loaded: PersistedSaveData = {
      playerId,
      playerName: sanitizePlayerName(
        typeof parsed.playerName === 'string' ? parsed.playerName : '',
      ),
      bestDistance: Math.max(0, Math.floor(Number(parsed.bestDistance) || 0)),
      bestScore: Math.max(0, Math.floor(Number(parsed.bestScore) || 0)),
      totalCoinsBank: Math.max(
        0,
        Math.floor(Number(parsed.totalCoinsBank) || 0),
      ),
      calibration: clampCalibration(parsed.calibration),
      mutedSfx: Boolean(parsed.mutedSfx),
    };
    return loaded;
  } catch {
    return fallback;
  }
}

export function persistSaveData(data: PersistedSaveData): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  buildFirestoreErrorInfo,
  db,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  isValidPlayerId,
  PLAYER_NAME_MAX_LENGTH,
  sanitizePlayerName,
} from './storage';
import type { LeaderboardEntry } from './types';

export const LEADERBOARD_COLLECTION = 'leaderboard';
export const LEADERBOARD_LIMIT = 25;
export const MAX_SCORE_LIMIT = 10_000_000;
export const MAX_DISTANCE_LIMIT = 1_000_000;
export const MAX_COINS_LIMIT = 1_000_000;
export const MAX_PINK_COINS_LIMIT = 100_000;

export interface ScoreSyncPayload {
  playerId: string;
  playerName: string;
  score: number;
  distance: number;
  coinsCollected: number;
  pinkCoinsCollected: number;
}

export interface ScoreSyncResult {
  synced: boolean;
  isNewBest: boolean;
  errorMessage: string | null;
}

function clampNonNegativeInt(val: number, max: number): number {
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.min(max, Math.floor(val));
}

function formatFriendlyFirestoreError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/quota exceeded/i.test(raw)) {
    return 'Leaderboard daily free quota was reached. Your score is saved locally and sync will resume tomorrow.';
  }
  if (/offline|unavailable|network/i.test(raw)) {
    return 'You appear to be offline. Scores are saved on your device until connection returns.';
  }
  if (/permission|insufficient/i.test(raw)) {
    return 'Could not sync leaderboard right now due to database rules.';
  }
  return 'Could not reach the global leaderboard right now. Your progress is still saved on this device.';
}

/**
 * Validates and clamps a leaderboard write payload to match firebase-blueprint.json verbatim.
 */
export function sanitizeLeaderboardPayload(payload: ScoreSyncPayload): {
  playerId: string;
  playerName: string;
  bestScore: number;
  bestDistance: number;
  coinsCollected: number;
  pinkCoinsCollected: number;
} | null {
  if (!isValidPlayerId(payload.playerId)) return null;
  const cleanName = sanitizePlayerName(payload.playerName).slice(
    0,
    PLAYER_NAME_MAX_LENGTH,
  );
  if (cleanName.length < 1) return null;

  return {
    playerId: payload.playerId,
    playerName: cleanName,
    bestScore: clampNonNegativeInt(payload.score, MAX_SCORE_LIMIT),
    bestDistance: clampNonNegativeInt(payload.distance, MAX_DISTANCE_LIMIT),
    coinsCollected: clampNonNegativeInt(payload.coinsCollected, MAX_COINS_LIMIT),
    pinkCoinsCollected: clampNonNegativeInt(
      payload.pinkCoinsCollected,
      MAX_PINK_COINS_LIMIT,
    ),
  };
}

/**
 * Subscribes in real time to the top 25 highest scores on Firestore.
 * Uses `where('bestScore', '>=', 0)` + `limit(25)` to satisfy Firestore's static query security rules.
 */
export function subscribeToLeaderboard(
  onData: (entries: LeaderboardEntry[]) => void,
  onError: (friendlyMessage: string) => void,
): Unsubscribe {
  const leaderboardQuery = query(
    collection(db, LEADERBOARD_COLLECTION),
    where('bestScore', '>=', 0),
    orderBy('bestScore', 'desc'),
    limit(LEADERBOARD_LIMIT),
  );

  return onSnapshot(
    leaderboardQuery,
    (snapshot) => {
      const entries: LeaderboardEntry[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const updatedAtMs =
          d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : 0;
        entries.push({
          playerId: typeof d.playerId === 'string' ? d.playerId : docSnap.id,
          playerName:
            typeof d.playerName === 'string' && d.playerName.trim().length > 0
              ? d.playerName.trim()
              : 'Runner',
          bestScore: clampNonNegativeInt(Number(d.bestScore) || 0, MAX_SCORE_LIMIT),
          bestDistance: clampNonNegativeInt(
            Number(d.bestDistance) || 0,
            MAX_DISTANCE_LIMIT,
          ),
          coinsCollected: clampNonNegativeInt(
            Number(d.coinsCollected) || 0,
            MAX_COINS_LIMIT,
          ),
          pinkCoinsCollected: clampNonNegativeInt(
            Number(d.pinkCoinsCollected) || 0,
            MAX_PINK_COINS_LIMIT,
          ),
          updatedAtMs,
        });
      });
      onData(entries);
    },
    (error) => {
      // Log structured FirestoreErrorInfo diagnostics and notify UI gracefully
      const info = buildFirestoreErrorInfo(
        error,
        OperationType.LIST,
        LEADERBOARD_COLLECTION,
      );
      console.error('Firestore Error: ', JSON.stringify(info));
      onError(formatFriendlyFirestoreError(error));
    },
  );
}

/**
 * Syncs a player's best score to `/leaderboard/{playerId}` with no auth required.
 * Enforces monotonic high-score updates so existing personal bests are never downgraded.
 */
export async function syncPlayerScoreToLeaderboard(
  payload: ScoreSyncPayload,
): Promise<ScoreSyncResult> {
  const clean = sanitizeLeaderboardPayload(payload);
  if (!clean) {
    return {
      synced: false,
      isNewBest: false,
      errorMessage: 'Please enter a valid player name (1-24 characters) to sync scores.',
    };
  }

  const docPath = `${LEADERBOARD_COLLECTION}/${clean.playerId}`;
  const docRef = doc(db, LEADERBOARD_COLLECTION, clean.playerId);

  try {
    const existingSnap = await getDoc(docRef);

    if (!existingSnap.exists()) {
      await setDoc(docRef, {
        playerId: clean.playerId,
        playerName: clean.playerName,
        bestScore: clean.bestScore,
        bestDistance: clean.bestDistance,
        coinsCollected: clean.coinsCollected,
        pinkCoinsCollected: clean.pinkCoinsCollected,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { synced: true, isNewBest: clean.bestScore > 0, errorMessage: null };
    }

    const prev = existingSnap.data();
    const prevScore = clampNonNegativeInt(
      Number(prev.bestScore) || 0,
      MAX_SCORE_LIMIT,
    );
    const prevDistance = clampNonNegativeInt(
      Number(prev.bestDistance) || 0,
      MAX_DISTANCE_LIMIT,
    );
    const prevCoins = clampNonNegativeInt(
      Number(prev.coinsCollected) || 0,
      MAX_COINS_LIMIT,
    );
    const prevPinkCoins = clampNonNegativeInt(
      Number(prev.pinkCoinsCollected) || 0,
      MAX_PINK_COINS_LIMIT,
    );

    const isNewBest = clean.bestScore > prevScore;
    const isNewDistance = clean.bestDistance > prevDistance;

    if (isNewBest || isNewDistance) {
      await updateDoc(docRef, {
        playerName: clean.playerName,
        bestScore: Math.max(prevScore, clean.bestScore),
        bestDistance: Math.max(prevDistance, clean.bestDistance),
        coinsCollected: isNewBest
          ? clean.coinsCollected
          : Math.max(prevCoins, clean.coinsCollected),
        pinkCoinsCollected: isNewBest
          ? clean.pinkCoinsCollected
          : Math.max(prevPinkCoins, clean.pinkCoinsCollected),
        updatedAt: serverTimestamp(),
      });
      return { synced: true, isNewBest, errorMessage: null };
    }

    // Score did not exceed existing record; update name only if it changed
    if (prev.playerName !== clean.playerName) {
      await updateDoc(docRef, {
        playerName: clean.playerName,
        updatedAt: serverTimestamp(),
      });
    }

    return { synced: true, isNewBest: false, errorMessage: null };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, docPath);
    } catch {
      // Structured diagnostic logged by handleFirestoreError; surface friendly UI error
    }
    return {
      synced: false,
      isNewBest: false,
      errorMessage: formatFriendlyFirestoreError(error),
    };
  }
}

/**
 * Updates the player's display name on Firestore if they already have an entry,
 * or creates an entry if they already have a saved local score.
 */
export async function syncPlayerNameToLeaderboard(
  playerId: string,
  playerName: string,
  localBestScore: number,
  localBestDistance: number,
): Promise<void> {
  const cleanName = sanitizePlayerName(playerName);
  if (!isValidPlayerId(playerId) || cleanName.length < 1) return;

  const docPath = `${LEADERBOARD_COLLECTION}/${playerId}`;
  const docRef = doc(db, LEADERBOARD_COLLECTION, playerId);

  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      await updateDoc(docRef, {
        playerName: cleanName,
        updatedAt: serverTimestamp(),
      });
    } else if (localBestScore > 0) {
      await setDoc(docRef, {
        playerId,
        playerName: cleanName,
        bestScore: clampNonNegativeInt(localBestScore, MAX_SCORE_LIMIT),
        bestDistance: clampNonNegativeInt(localBestDistance, MAX_DISTANCE_LIMIT),
        coinsCollected: 0,
        pinkCoinsCollected: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    } catch {
      // Non-blocking background name sync; local device save always succeeds
    }
  }
}

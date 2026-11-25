export type GamePhase = 'menu' | 'playing' | 'paused' | 'game_over';

export type DayPhaseLabel = 'Day' | 'Golden Hour' | 'Night' | 'Dawn';

export type WeatherStateLabel = 'Clear' | 'Overcast' | 'Rainy';

export type SolidBlockKind =
  | 'brick'
  | 'question'
  | 'platform'
  | 'pipe'
  | 'spring'
  | 'pause'
  | 'goal_flag';

export interface SolidBlock {
  id: string;
  kind: SolidBlockKind;
  x: number;
  y: number;
  width: number;
  height: number;
  colorHex: string;
  hitCount: number;
  maxHits: number;
  hitAnimTimer: number;
  reward?: 'coins' | 'mushroom';
  broken?: boolean;
  passed?: boolean;
}

export interface CoinEntity {
  id: string;
  x: number;
  y: number;
  isStarCoin: boolean;
  collected: boolean;
}

export interface PatrolEnemy {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minX: number;
  maxX: number;
  vx: number;
  alive: boolean;
  squashedTimer: number;
}

export interface GapSegment {
  id: string;
  startX: number;
  endX: number;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  grounded: boolean;
  coyoteTimer: number;
  airBoostTimer: number;
  spinTimer: number;
  vaultTimer: number;
  pauseBlockTimer: number;
  inBubble: boolean;
  bubbleTimer: number;
  bubblesLeft: number;
  invulnTimer: number;
  isSuper: boolean;
  runCycle: number;
  squashY: number;
  lastJumpPower: number;
  lastJumpLabel: string;
  flagpoleSlideTimer: number;
}

export interface SimulationState {
  phase: GamePhase;
  baseSpeed: number;
  distance: number;
  score: number;
  coinsCollected: number;
  pinkCoinsCollected: number;
  comboCount: number;
  timeOfDay: number; // 0..1 gradual cycle starting at Day (0.0)
  weatherPhase: number; // 0..1 gradual cycle starting at Clear (0.0)
  surfaceWetness: number; // 0..1 physical wetness accumulator for environmental shaders
  player: PlayerState;
  blocks: SolidBlock[];
  coins: CoinEntity[];
  enemies: PatrolEnemy[];
  gaps: GapSegment[];
  generatedUntilX: number;
  chunkSeed: number;
  nextFlagpoleX: number;
  elapsedRunSeconds: number;
  deathReason: string | null;
}

export interface AudioCalibration {
  threshold: number; // 0.04 .. 0.48 (Move Gate; Jump Gate is threshold + 0.30)
  sensitivity: number; // 0.5 .. 3.0
  autoCalibrate?: boolean; // Whether the border line was auto-calibrated from ambient noise
}

export type NoiseEnvironmentLabel = 'Quiet' | 'Moderate' | 'Noisy';

export interface AutoCalibrationState {
  isScanning: boolean;
  progress: number; // 0..1
  ambientNoisePct: number | null; // 0..100 normalized ambient noise floor
  environmentLabel: NoiseEnvironmentLabel | null;
  statusMessage: string | null;
}

export interface AudioTelemetry {
  isMicActive: boolean;
  isRequesting: boolean;
  micError: string | null;
  rawRms: number;
  normalizedLevel: number;
  peakLevel: number;
  moveSpeedRatio: number; // 0 when silent/below Move Gate, smoothly 0..1 up to Jump Gate
  jumpThreshold: number; // Sound level where jumping triggers
  soundStateLabel: string;
  triggeredThisFrame: boolean;
  predictedJumpPower: number;
}

export interface PersistedSaveData {
  playerId: string;
  playerName: string;
  bestDistance: number;
  bestScore: number;
  totalCoinsBank: number;
  calibration: AudioCalibration;
  mutedSfx: boolean;
}

export interface LeaderboardEntry {
  playerId: string;
  playerName: string;
  bestScore: number;
  bestDistance: number;
  coinsCollected: number;
  pinkCoinsCollected: number;
  updatedAtMs: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  distance: number;
  score: number;
  coinsCollected: number;
  pinkCoinsCollected: number;
  bubblesLeft: number;
  inBubble: boolean;
  isSuper: boolean;
  dayPhaseLabel: DayPhaseLabel;
  timeOfDay: number;
  weatherLabel: WeatherStateLabel;
  rainIntensity: number;
  lastJumpPower: number;
  lastJumpLabel: string;
  deathReason: string | null;
}

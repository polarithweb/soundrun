import {
  createInitialMeadowEntities,
  generateMeadowChunk,
  makeBlock,
} from './courses';
import { advanceTimeOfDay, getDayPhaseLabel } from './dayNight';
import {
  computeJumpThreshold,
  describeJumpPower,
  jumpPowerToVelocity,
  MAX_RUN_SPEED,
  soundLevelToRunSpeed,
} from './soundPhysics';
import {
  advanceWeatherPhase,
  computeWeatherAtmosphere,
  getWeatherStateLabel,
  updateSurfaceWetness,
} from './weather';
import type { HudSnapshot, SimulationState, SolidBlock } from './types';

export const GRAVITY = 34.0;
export const PLAYER_WIDTH = 0.85;
export const PLAYER_HEIGHT = 1.65;
export const AUTO_VAULT_MAX_HEIGHT = 1.05;
export const FLAGPOLE_INTERVAL_M = 200;

export interface StepInput {
  dt: number;
  jumpPowerTriggered: number | null;
  sustainedSoundLevel: number;
  threshold: number;
}

export interface StepEvents {
  jumpedPower: number | null;
  spinTriggered: boolean;
  vaulted: boolean;
  coinsPicked: number;
  pinkCoinsPicked: number;
  bonkedBlock: boolean;
  springLaunched: boolean;
  stompedEnemy: boolean;
  enteredBubble: boolean;
  poppedBubble: boolean;
  reachedFlagpole: boolean;
  gameOver: boolean;
}

export function createSimulationState(): SimulationState {
  const initial = createInitialMeadowEntities();
  return {
    phase: 'playing',
    baseSpeed: MAX_RUN_SPEED,
    distance: 0,
    score: 0,
    coinsCollected: 0,
    pinkCoinsCollected: 0,
    comboCount: 0,
    timeOfDay: 0.0, // Starts in bright midday and changes gradually over time
    weatherPhase: 0.0, // Starts in Clear weather and transitions through Overcast & Rainy
    surfaceWetness: 0.0,
    player: {
      x: 0,
      y: 0,
      vx: 0, // Strictly stationary until sound exceeds the Move Gate
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      grounded: true,
      coyoteTimer: 0.11,
      airBoostTimer: 0,
      spinTimer: 0,
      vaultTimer: 0,
      pauseBlockTimer: 0,
      inBubble: false,
      bubbleTimer: 0,
      bubblesLeft: 2,
      invulnTimer: 0,
      isSuper: false,
      runCycle: 0,
      squashY: 1,
      lastJumpPower: 0,
      lastJumpLabel: '',
      flagpoleSlideTimer: 0,
    },
    blocks: initial.blocks,
    coins: initial.coins,
    enemies: initial.enemies,
    gaps: initial.gaps,
    generatedUntilX: 36,
    chunkSeed: 731942,
    nextFlagpoleX: FLAGPOLE_INTERVAL_M,
    elapsedRunSeconds: 0,
    deathReason: null,
  };
}

export function isOverGap(x: number, gaps: SimulationState['gaps']): boolean {
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    if (x > g.startX + 0.18 && x < g.endX - 0.18) {
      return true;
    }
  }
  return false;
}

function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return (
    ax - aw / 2 < bx + bw / 2 &&
    ax + aw / 2 > bx - bw / 2 &&
    ay < by + bh &&
    ay + ah > by
  );
}

function triggerBubbleOrGameOver(
  state: SimulationState,
  events: StepEvents,
  reason: string,
): boolean {
  const p = state.player;
  if (p.bubblesLeft > 0) {
    p.bubblesLeft -= 1;
    p.inBubble = true;
    p.bubbleTimer = 3.5;
    p.y = Math.max(2.6, p.y + 1.8);
    p.vy = 0;
    p.vx = -4.2; // Drift safely back inside a Rescue Bubble
    p.invulnTimer = 2.0;
    state.comboCount = 0;
    events.enteredBubble = true;
    return false;
  }
  state.phase = 'game_over';
  state.deathReason = reason;
  events.gameOver = true;
  return true;
}

export function stepSimulation(
  state: SimulationState,
  input: StepInput,
): StepEvents {
  const events: StepEvents = {
    jumpedPower: null,
    spinTriggered: false,
    vaulted: false,
    coinsPicked: 0,
    pinkCoinsPicked: 0,
    bonkedBlock: false,
    springLaunched: false,
    stompedEnemy: false,
    enteredBubble: false,
    poppedBubble: false,
    reachedFlagpole: false,
    gameOver: false,
  };

  if (state.phase !== 'playing') {
    return events;
  }

  const dt = Math.min(0.05, Math.max(0.001, input.dt));
  state.elapsedRunSeconds += dt;
  state.timeOfDay = advanceTimeOfDay(state.timeOfDay, dt, 90);
  state.weatherPhase = advanceWeatherPhase(state.weatherPhase, dt, 68);
  const weatherAtmo = computeWeatherAtmosphere(
    state.weatherPhase,
    state.surfaceWetness,
    state.elapsedRunSeconds,
  );
  state.surfaceWetness = updateSurfaceWetness(
    state.surfaceWetness,
    weatherAtmo.rainIntensity,
    dt,
  );

  const p = state.player;
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  p.vaultTimer = Math.max(0, p.vaultTimer - dt);
  p.spinTimer = Math.max(0, p.spinTimer - dt);
  p.squashY += (1 - p.squashY) * Math.min(1, dt * 14);

  // Flagpole celebration slide, then seamless sprint onward!
  if (p.flagpoleSlideTimer > 0) {
    p.flagpoleSlideTimer = Math.max(0, p.flagpoleSlideTimer - dt);
    p.vy = -6.0;
    p.y = Math.max(0, p.y + p.vy * dt);
    p.vx = 0;
    return events;
  }

  // Super Mario Run Rescue Bubble floating state
  if (p.inBubble) {
    p.bubbleTimer = Math.max(0, p.bubbleTimer - dt);
    p.x += p.vx * dt;
    p.y = 3.2 + Math.sin(state.elapsedRunSeconds * 3.5) * 0.45;
    // Pop bubble on sound trigger OR automatically after 3.5s over safe ground
    const overSafeGround = !isOverGap(p.x, state.gaps);
    if ((input.jumpPowerTriggered !== null || p.bubbleTimer === 0) && overSafeGround) {
      p.inBubble = false;
      p.vy = 4.5;
      p.grounded = false;
      p.invulnTimer = 1.6;
      events.poppedBubble = true;
    }
    return events;
  }

  if (p.grounded) {
    p.coyoteTimer = 0.11;
  } else {
    p.coyoteTimer = Math.max(0, p.coyoteTimer - dt);
  }

  // Sound-driven movement:
  // - Below Move Gate (threshold): strictly ZERO horizontal movement on the ground!
  // - Between Move Gate & Jump Gate: speed scales smoothly from tiny creep to fast sprint.
  // - At or above Jump Gate: full sprint + jump scaled by loudness!
  const speedBoost = Math.min(3.2, state.distance * 0.005);
  const maxAllowedSpeed = state.baseSpeed + speedBoost;
  const soundTargetSpeed = soundLevelToRunSpeed(
    input.sustainedSoundLevel,
    input.threshold,
    maxAllowedSpeed,
  );
  const jumpThreshold = computeJumpThreshold(input.threshold);

  // Pause Block hold!
  if (p.pauseBlockTimer > 0) {
    p.pauseBlockTimer = Math.max(0, p.pauseBlockTimer - dt);
    p.vx = 0;
    if (input.jumpPowerTriggered !== null) {
      p.pauseBlockTimer = 0;
    }
  } else if (p.grounded) {
    if (soundTargetSpeed <= 0) {
      // Strictly zero drift or creep when quiet
      p.vx = 0;
    } else if (p.vx <= 0.01) {
      p.vx = soundTargetSpeed;
    } else {
      p.vx += (soundTargetSpeed - p.vx) * Math.min(1, dt * 14);
    }
  } else {
    // Mid-air: voice sustains/steers speed; brief silence gently preserves jump arc momentum
    if (soundTargetSpeed > 0) {
      p.vx += (soundTargetSpeed - p.vx) * Math.min(1, dt * 8);
    } else {
      p.vx *= Math.max(0, 1 - dt * 1.6);
      if (p.vx < 0.12) p.vx = 0;
    }
  }

  // Trigger jump ONLY when sound intensity reaches the loud Jump Gate
  if (input.jumpPowerTriggered !== null) {
    if (p.coyoteTimer > 0) {
      const power = Math.min(1, Math.max(0, input.jumpPowerTriggered));
      p.vy = jumpPowerToVelocity(power);
      p.vx = Math.max(p.vx, soundTargetSpeed, 6.2 + power * 5.2);
      p.grounded = false;
      p.coyoteTimer = 0;
      p.airBoostTimer = 0.22;
      p.squashY = 1.2;
      p.lastJumpPower = power;
      p.lastJumpLabel = describeJumpPower(power);
      events.jumpedPower = power;
    } else if (!p.grounded && p.spinTimer <= 0) {
      // Mid-air loud sound triggers spin slowing descent
      p.spinTimer = 0.36;
      p.vy = Math.max(p.vy, 2.2);
      events.spinTriggered = true;
    }
  }

  // Variable sound sustain lift while loudness stays above the Jump Gate
  if (!p.grounded && p.vy > 0 && p.airBoostTimer > 0) {
    p.airBoostTimer = Math.max(0, p.airBoostTimer - dt);
    if (input.sustainedSoundLevel >= jumpThreshold) {
      const extraLift =
        ((input.sustainedSoundLevel - jumpThreshold) /
          Math.max(0.1, 1 - jumpThreshold)) *
        10.5;
      p.vy += Math.min(10.5, extraLift) * dt;
    }
  }

  const prevX = p.x;
  const prevY = p.y;
  p.x += p.vx * dt;
  const effectiveGravity = p.spinTimer > 0 && p.vy < 0 ? GRAVITY * 0.45 : GRAVITY;
  p.vy -= effectiveGravity * dt;
  p.y += p.vy * dt;

  if (p.grounded && p.vx > 0) {
    p.runCycle += dt * p.vx * 1.4;
  }

  for (let i = 0; i < state.blocks.length; i++) {
    const b = state.blocks[i];
    if (b.hitAnimTimer > 0) {
      b.hitAnimTimer = Math.max(0, b.hitAnimTimer - dt);
    }
  }

  let landed = false;
  const overGap = isOverGap(p.x, state.gaps);
  if (!overGap && prevY >= -0.35 && p.y <= 0 && p.vy <= 0) {
    if (!p.grounded && p.vy < -6) {
      p.squashY = 0.82;
    }
    p.y = 0;
    p.vy = 0;
    landed = true;
  }

  for (let i = 0; i < state.blocks.length; i++) {
    const b: SolidBlock = state.blocks[i];
    if (b.broken) continue;

    if (b.kind === 'goal_flag') {
      if (!b.passed && p.x >= b.x - 0.35) {
        b.passed = true;
        const heightRatio = Math.min(1, Math.max(0.1, p.y / (b.height - 1.2)));
        const bonus = Math.round(500 + heightRatio * 1500);
        state.score += bonus;
        p.flagpoleSlideTimer = 0.85;
        p.x = b.x - 0.25;
        events.reachedFlagpole = true;
      }
      continue;
    }

    if (
      !aabbOverlap(
        p.x,
        p.y,
        p.width,
        p.height,
        b.x,
        b.y,
        b.width,
        b.height,
      )
    ) {
      continue;
    }

    const blockTop = b.y + b.height;
    const prevBottom = prevY;
    const prevTop = prevY + p.height;

    if (prevBottom >= blockTop - 0.35 && p.vy <= 0) {
      if (b.kind === 'spring') {
        p.y = blockTop;
        p.vy = 21.5;
        p.grounded = false;
        p.coyoteTimer = 0;
        p.squashY = 1.26;
        b.hitAnimTimer = 0.25;
        events.springLaunched = true;
        state.score += 100;
      } else if (b.kind === 'pause' && !b.passed) {
        b.passed = true;
        p.y = blockTop;
        p.vy = 0;
        p.pauseBlockTimer = 0.85;
        landed = true;
      } else {
        if (!p.grounded && p.vy < -5) {
          p.squashY = 0.84;
        }
        p.y = blockTop;
        p.vy = 0;
        landed = true;
      }
      continue;
    }

    if (prevTop <= b.y + 0.32 && p.vy > 0) {
      p.y = b.y - p.height;
      p.vy = -2.0;
      events.bonkedBlock = true;
      b.hitAnimTimer = 0.22;

      if (b.kind === 'question' && b.hitCount < b.maxHits) {
        b.hitCount += 1;
        if (b.reward === 'mushroom') {
          p.isSuper = true;
          state.score += 250;
        } else {
          state.coinsCollected += 5;
          state.score += 250;
          events.coinsPicked += 5;
        }
      } else if (b.kind === 'brick') {
        b.broken = true;
        state.score += 50;
      }
      continue;
    }

    const stepUpHeight = blockTop - p.y;
    if (
      p.vx > 0.25 &&
      prevX + p.width / 2 <= b.x - b.width / 2 + 0.55 &&
      stepUpHeight <= AUTO_VAULT_MAX_HEIGHT
    ) {
      p.y = blockTop;
      p.vy = 4.4;
      p.grounded = false;
      p.vaultTimer = 0.25;
      p.squashY = 1.14;
      events.vaulted = true;
      state.score += 25;
      continue;
    }

    if (p.x < b.x) {
      p.x = b.x - b.width / 2 - p.width / 2;
      p.coyoteTimer = 0.08;
    }
  }

  p.grounded = landed;

  for (let i = 0; i < state.coins.length; i++) {
    const c = state.coins[i];
    if (c.collected) continue;
    const radius = c.isStarCoin ? 1.05 : 0.85;
    const dx = p.x - c.x;
    const dy = p.y + p.height * 0.5 - c.y;
    if (dx * dx + dy * dy <= radius * radius) {
      c.collected = true;
      if (c.isStarCoin) {
        state.pinkCoinsCollected += 1;
        state.score += 500;
        events.pinkCoinsPicked += 1;
      } else {
        state.coinsCollected += 1;
        state.score += 50;
        events.coinsPicked += 1;
      }
    }
  }

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (!e.alive) {
      if (e.squashedTimer > 0) {
        e.squashedTimer = Math.max(0, e.squashedTimer - dt);
      }
      continue;
    }

    e.x += e.vx * dt;
    if (e.x <= e.minX) {
      e.x = e.minX;
      e.vx = Math.abs(e.vx);
    } else if (e.x >= e.maxX) {
      e.x = e.maxX;
      e.vx = -Math.abs(e.vx);
    }

    if (
      !aabbOverlap(
        p.x,
        p.y,
        p.width,
        p.height,
        e.x,
        e.y,
        e.width,
        e.height,
      )
    ) {
      continue;
    }

    const enemyTop = e.y + e.height;
    // Stomp from above OR auto-vault over a grounded mushroom critter when running forward
    if (
      (p.vy < 0 && prevY >= enemyTop - 0.45) ||
      (p.grounded && p.vx >= 1.5 && Math.abs(p.y - e.y) <= 0.18)
    ) {
      e.alive = false;
      e.squashedTimer = 0.45;
      p.vy = 10.5;
      p.grounded = false;
      p.vaultTimer = 0.25;
      state.comboCount += 1;
      state.score += 150 * state.comboCount;
      events.stompedEnemy = true;
    } else if (p.invulnTimer <= 0) {
      p.invulnTimer = 1.4;
      if (p.isSuper) {
        p.isSuper = false;
        p.vy = 8.0;
        p.grounded = false;
      } else {
        if (triggerBubbleOrGameOver(state, events, 'Bumped a wild mushroom critter')) {
          return events;
        }
      }
    }
  }

  if (p.y < -4.5) {
    if (triggerBubbleOrGameOver(state, events, 'Fell into a valley ravine')) {
      return events;
    }
  }

  const deltaDist = Math.max(0, p.x - state.distance);
  state.distance = Math.max(state.distance, p.x);
  state.score += Math.floor(deltaDist * 5);

  if (p.x + 68 > state.generatedUntilX) {
    if (state.generatedUntilX >= state.nextFlagpoleX) {
      state.blocks.push(
        makeBlock(
          `flag_${state.nextFlagpoleX}`,
          'goal_flag',
          state.nextFlagpoleX,
          0,
          1.2,
          9.0,
        ),
      );
      state.nextFlagpoleX += FLAGPOLE_INTERVAL_M;
    }

    const chunkIdx = Math.floor(state.generatedUntilX / 29);
    const chunk = generateMeadowChunk(
      state.generatedUntilX,
      state.chunkSeed,
      chunkIdx,
    );
    state.generatedUntilX = chunk.endX;
    state.chunkSeed = chunk.nextSeed;
    state.blocks.push(...chunk.blocks);
    state.coins.push(...chunk.coins);
    state.enemies.push(...chunk.enemies);
    state.gaps.push(...chunk.gaps);

    const cutoff = p.x - 42;
    state.blocks = state.blocks.filter((b) => b.x + b.width > cutoff);
    state.coins = state.coins.filter((c) => c.x > cutoff);
    state.enemies = state.enemies.filter((e) => e.maxX > cutoff);
    state.gaps = state.gaps.filter((g) => g.endX > cutoff);
  }

  return events;
}

export function extractHudSnapshot(state: SimulationState): HudSnapshot {
  const weatherAtmo = computeWeatherAtmosphere(
    state.weatherPhase,
    state.surfaceWetness,
    state.elapsedRunSeconds,
  );
  return {
    phase: state.phase,
    distance: state.distance,
    score: state.score,
    coinsCollected: state.coinsCollected,
    pinkCoinsCollected: state.pinkCoinsCollected,
    bubblesLeft: state.player.bubblesLeft,
    inBubble: state.player.inBubble,
    isSuper: state.player.isSuper,
    dayPhaseLabel: getDayPhaseLabel(state.timeOfDay),
    timeOfDay: state.timeOfDay,
    weatherLabel: getWeatherStateLabel(state.weatherPhase),
    rainIntensity: weatherAtmo.rainIntensity,
    lastJumpPower: state.player.lastJumpPower,
    lastJumpLabel: state.player.lastJumpLabel,
    deathReason: state.deathReason,
  };
}

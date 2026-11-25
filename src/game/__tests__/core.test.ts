import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMeadowChunk } from '../courses';
import {
  advanceTimeOfDay,
  computeDayNightAtmosphere,
  getDayPhaseLabel,
} from '../dayNight';
import { createSimulationState, stepSimulation } from '../simulation';
import {
  computeJumpPower,
  computeJumpThreshold,
  computeMoveSpeedRatio,
  computeRmsFromBytes,
  describeSoundState,
  jumpPowerToVelocity,
  normalizeSoundLevel,
  soundLevelToRunSpeed,
} from '../soundPhysics';
import {
  clampCalibration,
  generateDevicePlayerId,
  isValidPlayerId,
  PLAYER_NAME_MAX_LENGTH,
  sanitizePlayerName,
} from '../storage';
import {
  advanceWeatherPhase,
  computeWeatherAtmosphere,
  getWeatherStateLabel,
  updateSurfaceWetness,
} from '../weather';

test('soundPhysics: silent = zero speed, soft = slow creep, louder = faster, loud = jump', () => {
  const silent = new Uint8Array(256).fill(128);
  assert.equal(computeRmsFromBytes(silent), 0);
  assert.equal(normalizeSoundLevel(0, 1.5), 0);

  const moveGate = 0.12;
  const jumpGate = computeJumpThreshold(moveGate);
  assert.ok(jumpGate > moveGate + 0.25);

  // Below move gate: strictly zero speed and no jump
  assert.equal(computeMoveSpeedRatio(0, moveGate), 0);
  assert.equal(computeMoveSpeedRatio(0.11, moveGate), 0);
  assert.equal(soundLevelToRunSpeed(0.11, moveGate), 0);
  assert.equal(computeJumpPower(0.11, moveGate), null);
  assert.equal(describeSoundState(0.05, moveGate), 'Still');

  // Low sound moves slowly; louder sound moves progressively faster without jumping yet
  const creepSpeed = soundLevelToRunSpeed(0.15, moveGate);
  const walkSpeed = soundLevelToRunSpeed(0.26, moveGate);
  const sprintSpeed = soundLevelToRunSpeed(0.39, moveGate);
  assert.ok(creepSpeed > 0);
  assert.ok(walkSpeed > creepSpeed);
  assert.ok(sprintSpeed > walkSpeed);
  assert.equal(computeJumpPower(0.39, moveGate), null);

  // Loud sound past jump gate triggers jump scaled by loudness
  const softJump = computeJumpPower(jumpGate + 0.08, moveGate);
  const loudJump = computeJumpPower(0.95, moveGate);
  assert.ok(softJump !== null && loudJump !== null);
  assert.ok(loudJump > softJump);
  assert.ok(jumpPowerToVelocity(loudJump) > jumpPowerToVelocity(softJump));
});

test('dayNight: starts in Day and smoothly transitions through Sunset, Night, and Dawn', () => {
  assert.equal(getDayPhaseLabel(0.0), 'Day');
  assert.equal(getDayPhaseLabel(0.3), 'Golden Hour');
  assert.equal(getDayPhaseLabel(0.6), 'Night');
  assert.equal(getDayPhaseLabel(0.85), 'Dawn');

  const dayAtmo = computeDayNightAtmosphere(0.0);
  const nightAtmo = computeDayNightAtmosphere(0.6);
  assert.equal(dayAtmo.dayBackdropWeight, 1);
  assert.equal(dayAtmo.lampGlow, 0);
  assert.equal(nightAtmo.nightBackdropWeight, 1);
  assert.equal(nightAtmo.lampGlow, 1);
  assert.ok(advanceTimeOfDay(0.0, 9, 90) > 0.05);
});

test('simulation: stands completely still without sound, scales speed with loudness, and jumps on loud sound', () => {
  const simSoft = createSimulationState();
  const simLoud = createSimulationState();
  assert.equal(simSoft.timeOfDay, 0.0);
  assert.equal(simSoft.player.vx, 0);

  // Silence or below Move Gate: character must NOT move a single bit!
  for (let i = 0; i < 10; i++) {
    const quietEv = stepSimulation(simSoft, {
      dt: 0.016,
      jumpPowerTriggered: null,
      sustainedSoundLevel: 0.05,
      threshold: 0.12,
    });
    assert.equal(quietEv.jumpedPower, null);
  }
  assert.equal(simSoft.player.x, 0);
  assert.equal(simSoft.player.vx, 0);
  assert.equal(simSoft.player.grounded, true);

  // Low sound moves a tiny bit
  stepSimulation(simSoft, {
    dt: 0.05,
    jumpPowerTriggered: null,
    sustainedSoundLevel: 0.15,
    threshold: 0.12,
  });
  const distAfterLow = simSoft.player.x;
  const speedAfterLow = simSoft.player.vx;
  assert.ok(distAfterLow > 0);
  assert.ok(speedAfterLow > 0);

  // Louder sound moves noticeably faster
  stepSimulation(simSoft, {
    dt: 0.05,
    jumpPowerTriggered: null,
    sustainedSoundLevel: 0.36,
    threshold: 0.12,
  });
  assert.ok(simSoft.player.vx > speedAfterLow);

  // Going silent on the ground stops movement immediately
  const xBeforeStop = simSoft.player.x;
  stepSimulation(simSoft, {
    dt: 0.05,
    jumpPowerTriggered: null,
    sustainedSoundLevel: 0.0,
    threshold: 0.12,
  });
  assert.equal(simSoft.player.vx, 0);
  assert.equal(simSoft.player.x, xBeforeStop);

  // Loud sound triggers jump scaled by power
  const softEv = stepSimulation(simSoft, {
    dt: 0.016,
    jumpPowerTriggered: 0.15,
    sustainedSoundLevel: 0.5,
    threshold: 0.12,
  });
  const loudEv = stepSimulation(simLoud, {
    dt: 0.016,
    jumpPowerTriggered: 0.95,
    sustainedSoundLevel: 0.95,
    threshold: 0.12,
  });

  assert.equal(softEv.jumpedPower, 0.15);
  assert.equal(loudEv.jumpedPower, 0.95);
  assert.ok(simLoud.player.vy > simSoft.player.vy);

  // Sound in mid-air triggers spin
  const spinEv = stepSimulation(simLoud, {
    dt: 0.016,
    jumpPowerTriggered: 0.4,
    sustainedSoundLevel: 0.65,
    threshold: 0.12,
  });
  assert.equal(spinEv.spinTriggered, true);
  assert.ok(simLoud.player.spinTimer > 0);
});

test('simulation: auto-vaults low pipes while running with voice and Rescue Bubble saves from ravine falls', () => {
  const sim = createSimulationState();
  sim.player.x = 13.9;
  sim.player.y = 0;

  let vaulted = false;
  for (let i = 0; i < 20; i++) {
    const ev = stepSimulation(sim, {
      dt: 0.016,
      jumpPowerTriggered: null,
      sustainedSoundLevel: 0.35, // Running with medium sound (below jump threshold)
      threshold: 0.12,
    });
    if (ev.vaulted) vaulted = true;
  }
  assert.equal(vaulted, true);

  // Falling below cliff lip (-1.5) stays falling even when horizontally near ground edge
  sim.player.y = -1.5;
  sim.player.vy = -5.0;
  sim.player.grounded = false;
  stepSimulation(sim, {
    dt: 0.016,
    jumpPowerTriggered: null,
    sustainedSoundLevel: 0,
    threshold: 0.12,
  });
  assert.ok(sim.player.y < -1.5);

  // Ravine fall triggers Rescue Bubble when bubblesLeft > 0
  sim.player.y = -4.6;
  const bubbleEv = stepSimulation(sim, {
    dt: 0.016,
    jumpPowerTriggered: null,
    sustainedSoundLevel: 0,
    threshold: 0.12,
  });
  assert.equal(bubbleEv.enteredBubble, true);
  assert.equal(sim.player.inBubble, true);
  assert.equal(sim.player.bubblesLeft, 1);

  // Sound pops the bubble over safe ground
  const popEv = stepSimulation(sim, {
    dt: 0.016,
    jumpPowerTriggered: 0.5,
    sustainedSoundLevel: 0.7,
    threshold: 0.12,
  });
  assert.equal(popEv.poppedBubble, true);
  assert.equal(sim.player.inBubble, false);
});

test('courses & storage: meadow chunks stream forward and calibration clamps safely', () => {
  const chunk = generateMeadowChunk(40, 12345, 1);
  assert.ok(chunk.endX > 40);
  assert.ok(chunk.blocks.length > 0);

  const clamped = clampCalibration({ threshold: 2.0, sensitivity: -5 });
  assert.equal(clamped.threshold, 0.48);
  assert.equal(clamped.sensitivity, 0.5);
});

test('weather: transitions smoothly from Clear -> Overcast -> Rainy and integrates wetness', () => {
  assert.equal(getWeatherStateLabel(0.0), 'Clear');
  assert.equal(getWeatherStateLabel(0.5), 'Overcast');
  assert.equal(getWeatherStateLabel(0.75), 'Rainy');

  const clearAtmo = computeWeatherAtmosphere(0.0, 0, 10);
  const overcastAtmo = computeWeatherAtmosphere(0.52, 0, 10);
  const rainyAtmo = computeWeatherAtmosphere(0.76, 0.8, 10);

  assert.equal(clearAtmo.cloudCover, 0);
  assert.equal(clearAtmo.rainIntensity, 0);
  assert.equal(clearAtmo.sunAttenuation, 1);

  assert.ok(overcastAtmo.cloudCover > 0.6);
  assert.equal(overcastAtmo.rainIntensity, 0);
  assert.ok(overcastAtmo.sunAttenuation < clearAtmo.sunAttenuation);

  assert.ok(rainyAtmo.rainIntensity > 0.85);
  assert.ok(rainyAtmo.windStrength > overcastAtmo.windStrength);
  assert.ok(rainyAtmo.fogBoost > overcastAtmo.fogBoost);
  assert.ok(rainyAtmo.wetness >= 0.8);

  // Wetness accumulates in rain and dries gradually when clear
  const wetter = updateSurfaceWetness(0.1, 0.9, 0.2);
  assert.ok(wetter > 0.1);
  const drier = updateSurfaceWetness(wetter, 0.0, 0.2);
  assert.ok(drier < wetter);

  // Simulation advances weatherPhase continuously alongside timeOfDay
  const sim = createSimulationState();
  assert.equal(sim.weatherPhase, 0.0);
  stepSimulation(sim, {
    dt: 0.05,
    jumpPowerTriggered: null,
    sustainedSoundLevel: 0,
    threshold: 0.16,
  });
  assert.ok(sim.weatherPhase > 0);
  assert.ok(advanceWeatherPhase(0.0, 6.8, 68) > 0.09);
});

test('leaderboard storage: sanitizes player names and validates device player IDs', () => {
  assert.equal(sanitizePlayerName('  Priyam   <script>  '), 'Priyam script');
  assert.equal(sanitizePlayerName('   '), '');
  assert.equal(
    sanitizePlayerName('A'.repeat(60)).length,
    PLAYER_NAME_MAX_LENGTH,
  );

  const generatedId = generateDevicePlayerId();
  assert.equal(isValidPlayerId(generatedId), true);
  assert.equal(isValidPlayerId('../admin'), false);
  assert.equal(isValidPlayerId('ab'), false);
  assert.equal(isValidPlayerId('x'.repeat(120)), false);
});


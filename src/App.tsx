import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { MenuOverlays } from './components/MenuOverlays';
import { PortraitGuard } from './components/PortraitGuard';
import {
  createCanvas2DScene,
  type Canvas2DSceneController,
} from './game/canvas2dRenderer';
import {
  subscribeToLeaderboard,
  syncPlayerNameToLeaderboard,
  syncPlayerScoreToLeaderboard,
} from './game/leaderboardService';
import { gameSfx } from './game/sfx';
import {
  createSimulationState,
  extractHudSnapshot,
  stepSimulation,
} from './game/simulation';
import {
  AmbientNoiseCalibrator,
  computeJumpThreshold,
  MicInputController,
} from './game/soundPhysics';
import {
  loadSaveData,
  persistSaveData,
  sanitizePlayerName,
} from './game/storage';
import type {
  AudioCalibration,
  AudioTelemetry,
  AutoCalibrationState,
  HudSnapshot,
  LeaderboardEntry,
  PersistedSaveData,
  SimulationState,
} from './game/types';

function checkIsPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerHeight > window.innerWidth;
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Canvas2DSceneController | null>(null);
  const micRef = useRef<MicInputController | null>(null);

  const [saveData, setSaveData] = useState<PersistedSaveData>(() => loadSaveData());
  const saveDataRef = useRef<PersistedSaveData>(saveData);

  const [isPortrait, setIsPortrait] = useState<boolean>(() => checkIsPortrait());
  const isPortraitRef = useRef<boolean>(isPortrait);

  const [renderError, setRenderError] = useState<string | null>(null);

  // Real-time Firestore leaderboard state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState<boolean>(true);
  const [leaderboardSyncing, setLeaderboardSyncing] = useState<boolean>(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboardSubKey, setLeaderboardSubKey] = useState<number>(0);
  const [lastRunWasNewBest, setLastRunWasNewBest] = useState<boolean>(false);

  const simRef = useRef<SimulationState>(
    (() => {
      const initial = createSimulationState();
      initial.phase = 'menu';
      return initial;
    })(),
  );

  const [hud, setHud] = useState<HudSnapshot>(() =>
    extractHudSnapshot(simRef.current),
  );
  const calibratorRef = useRef<AmbientNoiseCalibrator>(new AmbientNoiseCalibrator());
  const hasAutoCalibratedRef = useRef<boolean>(false);

  const [autoCalState, setAutoCalState] = useState<AutoCalibrationState>({
    isScanning: false,
    progress: 0,
    ambientNoisePct: null,
    environmentLabel: null,
    statusMessage: null,
  });

  const [audioTelemetry, setAudioTelemetry] = useState<AudioTelemetry>({
    isMicActive: false,
    isRequesting: false,
    micError: null,
    rawRms: 0,
    normalizedLevel: 0,
    peakLevel: 0,
    moveSpeedRatio: 0,
    jumpThreshold: computeJumpThreshold(saveData.calibration.threshold),
    soundStateLabel: 'Still',
    triggeredThisFrame: false,
    predictedJumpPower: 0,
  });

  useEffect(() => {
    saveDataRef.current = saveData;
    gameSfx.setMuted(saveData.mutedSfx);
    persistSaveData(saveData);
  }, [saveData]);

  // Subscribe to real-time Global High Scores from Firestore (no auth required)
  useEffect(() => {
    setLeaderboardLoading(true);
    setLeaderboardError(null);

    const unsubscribe = subscribeToLeaderboard(
      (entries) => {
        setLeaderboard(entries);
        setLeaderboardLoading(false);
        setLeaderboardError(null);
      },
      (friendlyErr) => {
        setLeaderboardLoading(false);
        setLeaderboardError(friendlyErr);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [leaderboardSubKey]);

  const handleRetryLeaderboard = useCallback(() => {
    setLeaderboardSubKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const onOrientChange = () => {
      const portrait = checkIsPortrait();
      isPortraitRef.current = portrait;
      setIsPortrait(portrait);
      if (portrait && simRef.current.phase === 'playing') {
        simRef.current.phase = 'paused';
        setHud(extractHudSnapshot(simRef.current));
      }
    };
    window.addEventListener('resize', onOrientChange);
    window.addEventListener('orientationchange', onOrientChange);
    return () => {
      window.removeEventListener('resize', onOrientChange);
      window.removeEventListener('orientationchange', onOrientChange);
    };
  }, []);

  const recordRunProgress = useCallback((sim: SimulationState) => {
    const current = saveDataRef.current;
    const runDist = Math.floor(sim.distance);
    const runScore = Math.floor(sim.score);
    const beatLocalBest = runScore > current.bestScore;

    setLastRunWasNewBest(beatLocalBest && runScore > 0);

    const nextBestDistance = Math.max(current.bestDistance, runDist);
    const nextBestScore = Math.max(current.bestScore, runScore);

    setSaveData((prev) => ({
      ...prev,
      bestDistance: Math.max(prev.bestDistance, runDist),
      bestScore: Math.max(prev.bestScore, runScore),
      totalCoinsBank: prev.totalCoinsBank + sim.coinsCollected,
    }));

    const activeName = sanitizePlayerName(current.playerName);
    if (activeName.length > 0 && (nextBestScore > 0 || runScore > 0)) {
      setLeaderboardSyncing(true);
      void syncPlayerScoreToLeaderboard({
        playerId: current.playerId,
        playerName: activeName,
        score: nextBestScore,
        distance: nextBestDistance,
        coinsCollected: sim.coinsCollected,
        pinkCoinsCollected: sim.pinkCoinsCollected,
      }).then((res) => {
        setLeaderboardSyncing(false);
        if (res.errorMessage) {
          setLeaderboardError(res.errorMessage);
        } else {
          setLeaderboardError(null);
          if (res.isNewBest) {
            setLastRunWasNewBest(true);
          }
        }
      });
    }
  }, []);

  const handleSavePlayerName = useCallback((rawName: string) => {
    const clean = sanitizePlayerName(rawName);
    if (!clean) return;
    setSaveData((prev) => {
      const updated = { ...prev, playerName: clean };
      saveDataRef.current = updated;
      return updated;
    });
    const current = saveDataRef.current;
    void syncPlayerNameToLeaderboard(
      current.playerId,
      clean,
      current.bestScore,
      current.bestDistance,
    );
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const mic = new MicInputController();
    micRef.current = mic;

    let hudAccum = 0;
    let sceneController: Canvas2DSceneController;

    try {
      sceneController = createCanvas2DScene(container, (dt, nowMs) => {
        const sim = simRef.current;
        let cal = saveDataRef.current.calibration;
        const sampled = mic.sample(cal, nowMs, dt);

        // Feed live ambient noise samples into Auto Calibrator while scanning
        const calibrator = calibratorRef.current;
        if (calibrator.isScanning() && sampled.isMicActive) {
          const scanUpdate = calibrator.pushSample(sampled.rawRms, nowMs);
          if (scanUpdate.result) {
            const res = scanUpdate.result;
            hasAutoCalibratedRef.current = true;
            cal = res.calibration;
            const nextSave: PersistedSaveData = {
              ...saveDataRef.current,
              calibration: res.calibration,
            };
            saveDataRef.current = nextSave;
            setSaveData(nextSave);
            setAutoCalState({
              isScanning: false,
              progress: 1,
              ambientNoisePct: res.ambientNoisePct,
              environmentLabel: res.environmentLabel,
              statusMessage: `${res.environmentLabel} room · Move border auto-set to ${Math.round(res.calibration.threshold * 100)}%`,
            });
          } else if (hudAccum + dt >= 0.05) {
            setAutoCalState((prev) =>
              prev.isScanning
                ? { ...prev, progress: scanUpdate.progress }
                : prev,
            );
          }
        }

        if (sim.phase === 'playing' && !isPortraitRef.current) {
          const events = stepSimulation(sim, {
            dt,
            jumpPowerTriggered: sampled.triggeredThisFrame
              ? sampled.predictedJumpPower
              : null,
            sustainedSoundLevel: sampled.normalizedLevel,
            threshold: cal.threshold,
          });

          if (events.jumpedPower !== null) gameSfx.jump(events.jumpedPower);
          if (events.spinTriggered) gameSfx.vault();
          if (events.vaulted) gameSfx.vault();
          if (events.coinsPicked > 0) gameSfx.coin();
          if (events.pinkCoinsPicked > 0) gameSfx.starCoin();
          if (events.bonkedBlock) gameSfx.bonk();
          if (events.springLaunched) gameSfx.spring();
          if (events.stompedEnemy) gameSfx.stomp();
          if (events.enteredBubble) gameSfx.damage();
          if (events.poppedBubble) gameSfx.vault();
          if (events.reachedFlagpole) gameSfx.flagpole();

          if (events.gameOver) {
            recordRunProgress(sim);
            setHud(extractHudSnapshot(sim));
          }
        } else if (sim.phase === 'menu') {
          if (!calibrator.isScanning() && sampled.moveSpeedRatio > 0) {
            sim.player.vx = sampled.moveSpeedRatio * 8.5;
            sim.player.runCycle += dt * (2.2 + sampled.moveSpeedRatio * 10);
          } else {
            sim.player.vx = 0;
          }
          sim.elapsedRunSeconds += dt;
        }

        sceneController.syncSimulation(sim, dt);

        hudAccum += dt;
        if (hudAccum >= 0.05) {
          hudAccum = 0;
          setAudioTelemetry(sampled);
          setHud(extractHudSnapshot(sim));
        }
      });

      sceneRef.current = sceneController;
    } catch {
      setRenderError(
        '2D Canvas graphics could not be initialized on this browser.',
      );
    }

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      mic.dispose();
      micRef.current = null;
      gameSfx.dispose();
    };
  }, [recordRunProgress]);

  const beginAmbientCalibrationScan = useCallback(() => {
    const calibrator = calibratorRef.current;
    calibrator.start(
      performance.now(),
      saveDataRef.current.calibration.sensitivity,
    );
    setAutoCalState((prev) => ({
      ...prev,
      isScanning: true,
      progress: 0,
      statusMessage: 'Stay quiet for 2s — measuring room noise...',
    }));
  }, []);

  const handleAutoCalibrate = useCallback(async () => {
    const calibrator = calibratorRef.current;
    if (calibrator.isScanning()) {
      calibrator.cancel();
      setAutoCalState((prev) => ({
        ...prev,
        isScanning: false,
        progress: 0,
        statusMessage: 'Auto-calibration cancelled.',
      }));
      return;
    }

    const mic = micRef.current;
    if (!mic) return;

    if (!mic.getStatus().isMicActive) {
      setAudioTelemetry((prev) => ({ ...prev, isRequesting: true, micError: null }));
      const started = await mic.start();
      const status = mic.getStatus();
      setAudioTelemetry((prev) => ({
        ...prev,
        isMicActive: status.isMicActive,
        isRequesting: status.isRequesting,
        micError: status.micError,
      }));
      if (!started) return;
    }

    beginAmbientCalibrationScan();
  }, [beginAmbientCalibrationScan]);

  const handleEnableMicTest = useCallback(async () => {
    const mic = micRef.current;
    if (!mic) return;
    setAudioTelemetry((prev) => ({ ...prev, isRequesting: true, micError: null }));
    const started = await mic.start();
    const status = mic.getStatus();
    setAudioTelemetry((prev) => ({
      ...prev,
      isMicActive: status.isMicActive,
      isRequesting: status.isRequesting,
      micError: status.micError,
    }));

    // Automatically calibrate the sound border to room noise on first mic activation
    if (
      started &&
      !hasAutoCalibratedRef.current &&
      saveDataRef.current.calibration.autoCalibrate !== false
    ) {
      beginAmbientCalibrationScan();
    }
  }, [beginAmbientCalibrationScan]);

  const handleStartRun = useCallback(
    async (overrideName?: string) => {
      if (calibratorRef.current.isScanning()) {
        calibratorRef.current.cancel();
        setAutoCalState((prev) => ({
          ...prev,
          isScanning: false,
          progress: 0,
          statusMessage: null,
        }));
      }

      if (overrideName) {
        handleSavePlayerName(overrideName);
      }

      const mic = micRef.current;
      if (mic && !mic.getStatus().isMicActive) {
        setAudioTelemetry((prev) => ({
          ...prev,
          isRequesting: true,
          micError: null,
        }));
        await mic.start();
        const status = mic.getStatus();
        setAudioTelemetry((prev) => ({
          ...prev,
          isMicActive: status.isMicActive,
          isRequesting: status.isRequesting,
          micError: status.micError,
        }));
      }

      try {
        const orientation = screen.orientation as ScreenOrientation & {
          lock?: (orientation: 'landscape') => Promise<void>;
        };
        if (orientation && typeof orientation.lock === 'function') {
          void orientation.lock('landscape').catch(() => {});
        }
      } catch {
        // Ignore if orientation lock requires standalone/fullscreen
      }

      setLastRunWasNewBest(false);
      const nextSim = createSimulationState();
      simRef.current = nextSim;
      setHud(extractHudSnapshot(nextSim));
    },
    [handleSavePlayerName],
  );

  const handleChangeCalibration = useCallback((cal: AudioCalibration) => {
    // Manual slider adjustment stops any active scan and switches to manual mode
    if (calibratorRef.current.isScanning()) {
      calibratorRef.current.cancel();
    }
    setAutoCalState((prev) => ({
      ...prev,
      isScanning: false,
      progress: 0,
      statusMessage: null,
    }));
    setSaveData((prev) => ({
      ...prev,
      calibration: { ...cal, autoCalibrate: false },
    }));
  }, []);

  const handleToggleMute = useCallback(() => {
    setSaveData((prev) => ({ ...prev, mutedSfx: !prev.mutedSfx }));
  }, []);

  const handlePause = useCallback(() => {
    if (simRef.current.phase === 'playing') {
      simRef.current.phase = 'paused';
      setHud(extractHudSnapshot(simRef.current));
    }
  }, []);

  const handleResume = useCallback(() => {
    if (simRef.current.phase === 'paused' && !isPortraitRef.current) {
      simRef.current.phase = 'playing';
      setHud(extractHudSnapshot(simRef.current));
    }
  }, []);

  const handleBackToMenu = useCallback(() => {
    // Save any progress achieved before quitting a paused run
    if (simRef.current.phase === 'paused' && simRef.current.score > 0) {
      recordRunProgress(simRef.current);
    }
    const preview = createSimulationState();
    preview.phase = 'menu';
    simRef.current = preview;
    setHud(extractHudSnapshot(preview));
  }, [recordRunProgress]);

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-950">
      <div
        ref={mountRef}
        aria-label="Echo Meadow Run 2D game viewport"
        className="absolute inset-0 h-full w-full"
      />

      {hud.phase !== 'menu' && (
        <GameHud
          hud={hud}
          audio={audioTelemetry}
          calibration={saveData.calibration}
          autoCalibration={autoCalState}
          mutedSfx={saveData.mutedSfx}
          onChangeCalibration={handleChangeCalibration}
          onAutoCalibrate={handleAutoCalibrate}
          onToggleMute={handleToggleMute}
          onPause={handlePause}
          onRetryMic={handleEnableMicTest}
        />
      )}

      <MenuOverlays
        hud={hud}
        saveData={saveData}
        audio={audioTelemetry}
        calibration={saveData.calibration}
        autoCalibration={autoCalState}
        renderError={renderError}
        leaderboard={leaderboard}
        leaderboardLoading={leaderboardLoading}
        leaderboardSyncing={leaderboardSyncing}
        leaderboardError={leaderboardError}
        lastRunWasNewBest={lastRunWasNewBest}
        onSavePlayerName={handleSavePlayerName}
        onRetryLeaderboard={handleRetryLeaderboard}
        onStartRun={handleStartRun}
        onEnableMicTest={handleEnableMicTest}
        onAutoCalibrate={handleAutoCalibrate}
        onChangeCalibration={handleChangeCalibration}
        onResume={handleResume}
        onBackToMenu={handleBackToMenu}
      />

      <PortraitGuard isPortrait={isPortrait} />
    </main>
  );
}

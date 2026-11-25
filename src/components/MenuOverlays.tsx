import {
  AudioLines,
  Check,
  Mic,
  MicOff,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  Trophy,
  User,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { PLAYER_NAME_MAX_LENGTH, sanitizePlayerName } from '../game/storage';
import type {
  AudioCalibration,
  AudioTelemetry,
  AutoCalibrationState,
  HudSnapshot,
  LeaderboardEntry,
  PersistedSaveData,
} from '../game/types';
import { LeaderboardPanel } from './LeaderboardPanel';

interface MenuOverlaysProps {
  hud: HudSnapshot;
  saveData: PersistedSaveData;
  audio: AudioTelemetry;
  calibration: AudioCalibration;
  autoCalibration: AutoCalibrationState;
  renderError: string | null;
  leaderboard: LeaderboardEntry[];
  leaderboardLoading: boolean;
  leaderboardSyncing: boolean;
  leaderboardError: string | null;
  lastRunWasNewBest: boolean;
  onSavePlayerName: (name: string) => void;
  onRetryLeaderboard: () => void;
  onStartRun: (overrideName?: string) => void;
  onEnableMicTest: () => void;
  onAutoCalibrate: () => void;
  onChangeCalibration: (next: AudioCalibration) => void;
  onResume: () => void;
  onBackToMenu: () => void;
}

export function MenuOverlays({
  hud,
  saveData,
  audio,
  calibration,
  autoCalibration,
  renderError,
  leaderboard,
  leaderboardLoading,
  leaderboardSyncing,
  leaderboardError,
  lastRunWasNewBest,
  onSavePlayerName,
  onRetryLeaderboard,
  onStartRun,
  onEnableMicTest,
  onAutoCalibrate,
  onChangeCalibration,
  onResume,
  onBackToMenu,
}: MenuOverlaysProps) {
  const [nameInput, setNameInput] = useState(saveData.playerName);
  const [isEditingName, setIsEditingName] = useState(
    saveData.playerName.length === 0,
  );
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setNameInput(saveData.playerName);
    if (saveData.playerName.length === 0) {
      setIsEditingName(true);
    }
  }, [saveData.playerName]);

  const meterPct = Math.round(audio.normalizedLevel * 100);
  const movePct = Math.round(calibration.threshold * 100);
  const jumpPct = Math.round(audio.jumpThreshold * 100);
  const isJumpingZone = audio.normalizedLevel >= audio.jumpThreshold;
  const isMovingZone = audio.normalizedLevel >= calibration.threshold;

  const commitName = (): string | null => {
    const cleaned = sanitizePlayerName(nameInput);
    if (cleaned.length < 1) {
      setNameError('Enter a runner name (1-24 characters) to join the leaderboard.');
      return null;
    }
    setNameError(null);
    onSavePlayerName(cleaned);
    setNameInput(cleaned);
    setIsEditingName(false);
    return cleaned;
  };

  const handleNameFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    commitName();
  };

  const handleStartWithNameCheck = () => {
    if (isEditingName || saveData.playerName.length === 0) {
      const saved = commitName();
      if (!saved) return;
      onStartRun(saved);
      return;
    }
    onStartRun();
  };

  if (hud.phase === 'menu') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/45 p-3 sm:p-4">
        <div className="grid max-h-[94dvh] w-full max-w-4xl grid-cols-1 gap-3.5 overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/92 p-4 text-slate-50 shadow-2xl sm:grid-cols-12 sm:p-5">
          {/* Left Column: Title, Instant Device Name, Sound Calibration, Play */}
          <div className="flex flex-col justify-between gap-3 sm:col-span-7">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    Echo Meadow Run
                  </h1>
                  <p className="mt-0.5 text-xs font-medium text-slate-400">
                    Developer: Priyam Kesh
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">
                    <strong className="text-amber-400">
                      100% voice-driven movement:
                    </strong>{' '}
                    stay silent to stop dead still, hum softly to creep, speak
                    louder to sprint, and shout past the gold line to jump!
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-slate-400">
                  <div className="inline-flex items-center gap-1 text-amber-300">
                    <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="font-mono-tabular font-semibold">
                      {Math.floor(saveData.bestDistance)}m
                    </span>
                  </div>
                  <div className="font-mono-tabular">
                    {saveData.bestScore.toLocaleString()} pts
                  </div>
                </div>
              </div>

              {/* Passwordless Device Player Name Bar */}
              <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/90 p-3">
                {isEditingName ? (
                  <form onSubmit={handleNameFormSubmit} className="flex flex-col gap-1.5">
                    <label
                      htmlFor="runner-name-input"
                      className="flex items-center justify-between text-[11px] font-semibold text-slate-200"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                        <span>Runner Name (Saved on this device — no login)</span>
                      </span>
                      <span className="font-mono-tabular text-slate-400">
                        {nameInput.trim().length}/{PLAYER_NAME_MAX_LENGTH}
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="runner-name-input"
                        type="text"
                        value={nameInput}
                        maxLength={PLAYER_NAME_MAX_LENGTH}
                        placeholder="Type your name..."
                        autoComplete="nickname"
                        onChange={(e) => {
                          setNameInput(e.target.value);
                          if (nameError) setNameError(null);
                        }}
                        className="min-h-[38px] flex-1 rounded-lg border border-white/15 bg-slate-950 px-3 text-xs font-semibold text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Save</span>
                      </button>
                    </div>
                    {nameError && (
                      <p role="alert" className="text-[11px] text-rose-300">
                        {nameError}
                      </p>
                    )}
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <User
                        className="h-4 w-4 shrink-0 text-emerald-400"
                        aria-hidden="true"
                      />
                      <span className="text-slate-400">Playing as</span>
                      <span className="truncate font-bold text-white">
                        {saveData.playerName}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsEditingName(true)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                    >
                      <Pencil className="h-3 w-3" aria-hidden="true" />
                      <span>Change</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Live Sound Intensity Calibration */}
              <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/90 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                    {audio.isMicActive ? (
                      <Mic className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <MicOff className="h-4 w-4 text-amber-400" aria-hidden="true" />
                    )}
                    <span>Sound Intensity Calibration</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onAutoCalibrate}
                      disabled={audio.isRequesting}
                      aria-busy={autoCalibration.isScanning}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        autoCalibration.isScanning
                          ? 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                          : 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40 hover:bg-sky-500/30'
                      }`}
                    >
                      <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {autoCalibration.isScanning
                          ? `Scanning ${Math.round(autoCalibration.progress * 100)}%`
                          : 'Auto Calibrate'}
                      </span>
                    </button>
                    {!audio.isMicActive && (
                      <button
                        type="button"
                        onClick={onEnableMicTest}
                        disabled={audio.isRequesting}
                        className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-slate-700 disabled:opacity-50"
                      >
                        {audio.isRequesting ? 'Connecting...' : 'Test Mic'}
                      </button>
                    )}
                  </div>
                </div>

                {autoCalibration.isScanning && (
                  <div className="mt-2" role="status" aria-live="polite">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-sky-400 transition-all duration-75"
                        style={{ width: `${Math.round(autoCalibration.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  {autoCalibration.ambientNoisePct !== null && (
                    <div
                      aria-hidden="true"
                      title={`Measured room noise floor: ${autoCalibration.ambientNoisePct}%`}
                      className="absolute top-0 bottom-0 left-0 bg-sky-400/20"
                      style={{ width: `${autoCalibration.ambientNoisePct}%` }}
                    />
                  )}
                  <div
                    className={`relative h-full transition-colors duration-75 ${
                      autoCalibration.isScanning
                        ? 'bg-sky-400/80'
                        : isJumpingZone
                          ? 'bg-amber-400'
                          : isMovingZone
                            ? 'bg-emerald-400'
                            : 'bg-slate-600'
                    }`}
                    style={{ width: `${meterPct}%` }}
                  />
                  <div
                    aria-hidden="true"
                    title="Move threshold"
                    className="absolute top-0 bottom-0 w-0.5 bg-white"
                    style={{ left: `${movePct}%` }}
                  />
                  <div
                    aria-hidden="true"
                    title="Jump threshold"
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-300"
                    style={{ left: `${jumpPct}%` }}
                  />
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span className="truncate">
                    {autoCalibration.isScanning
                      ? 'Stay quiet for 2s — measuring room noise...'
                      : autoCalibration.statusMessage
                        ? autoCalibration.statusMessage
                        : audio.isMicActive
                          ? isJumpingZone
                            ? `Jumping (${audio.soundStateLabel})`
                            : isMovingZone
                              ? `Moving (${audio.soundStateLabel} — louder to jump)`
                              : 'Silent — character stands still'
                          : 'Tap Auto Calibrate or Test Mic to match your room noise'}
                  </span>
                  <span className="shrink-0 font-mono-tabular text-slate-200">
                    {meterPct}%
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-[11px] text-slate-300">
                    <span className="flex justify-between">
                      <span>Move / Jump</span>
                      <span className="font-mono-tabular">
                        {movePct}% / {jumpPct}%
                      </span>
                    </span>
                    <input
                      type="range"
                      min={4}
                      max={48}
                      value={movePct}
                      onChange={(e) =>
                        onChangeCalibration({
                          ...calibration,
                          threshold: Number(e.target.value) / 100,
                        })
                      }
                      className="accent-amber-400"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-[11px] text-slate-300">
                    <span className="flex justify-between">
                      <span>Sensitivity</span>
                      <span className="font-mono-tabular">
                        {calibration.sensitivity.toFixed(1)}x
                      </span>
                    </span>
                    <input
                      type="range"
                      min={5}
                      max={30}
                      value={Math.round(calibration.sensitivity * 10)}
                      onChange={(e) =>
                        onChangeCalibration({
                          ...calibration,
                          sensitivity: Number(e.target.value) / 10,
                        })
                      }
                      className="accent-emerald-400"
                    />
                  </label>
                </div>

                {audio.micError && (
                  <p className="mt-2 rounded-md bg-rose-950/80 px-2.5 py-1.5 text-[11px] text-rose-200">
                    {audio.micError}
                  </p>
                )}
                {renderError && (
                  <p className="mt-2 rounded-md bg-amber-950/80 px-2.5 py-1.5 text-[11px] text-amber-200">
                    {renderError}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartWithNameCheck}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              <span>Enable Mic &amp; Start Run</span>
            </button>
          </div>

          {/* Right Column: Live Global High Scores Leaderboard */}
          <div className="sm:col-span-5">
            <LeaderboardPanel
              entries={leaderboard}
              currentPlayerId={saveData.playerId}
              isLoading={leaderboardLoading}
              isSyncing={leaderboardSyncing}
              error={leaderboardError}
              onRetry={onRetryLeaderboard}
            />
          </div>
        </div>
      </div>
    );
  }

  if (hud.phase === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-950/95 p-6 text-center text-slate-50 shadow-2xl">
          <h2 className="font-display text-2xl font-bold text-white">
            Run Paused
          </h2>
          <p className="mt-1 text-xs text-slate-300">
            {saveData.playerName ? `${saveData.playerName} · ` : ''}
            {hud.dayPhaseLabel} · {Math.floor(hud.distance)}m
          </p>
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="min-h-[44px] w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              Resume Run
            </button>
            <button
              type="button"
              onClick={() => onStartRun()}
              className="min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800"
            >
              Restart Run
            </button>
            <button
              type="button"
              onClick={onBackToMenu}
              className="min-h-[44px] w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-900"
            >
              Main Menu &amp; Leaderboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (hud.phase === 'game_over') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-3 sm:p-4">
        <div className="grid max-h-[94dvh] w-full max-w-4xl grid-cols-1 gap-4 overflow-y-auto rounded-2xl border border-rose-500/30 bg-slate-950/95 p-4 text-slate-50 shadow-2xl sm:grid-cols-12 sm:p-5">
          {/* Left Column: Run Summary */}
          <div className="flex flex-col justify-between text-center sm:col-span-6 sm:text-left">
            <div>
              {lastRunWasNewBest && (
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-300">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>New Personal Best Synced!</span>
                </div>
              )}

              <h2 className="font-display text-3xl font-bold text-white">
                Run Ended
              </h2>
              <p className="mt-1 text-xs text-slate-300">
                {hud.deathReason || 'Out of rescue bubbles'}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-white/10 bg-slate-900/90 p-3 text-center">
                  <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    Score
                  </div>
                  <div className="mt-0.5 font-mono-tabular text-lg font-bold text-amber-400">
                    {hud.score.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/90 p-3 text-center">
                  <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    Distance
                  </div>
                  <div className="mt-0.5 font-mono-tabular text-lg font-bold text-white">
                    {Math.floor(hud.distance)}m
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/90 p-3 text-center">
                  <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    Coins
                  </div>
                  <div className="mt-0.5 font-mono-tabular text-lg font-bold text-amber-300">
                    {hud.coinsCollected}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                <span>
                  Runner:{' '}
                  <strong className="text-white">
                    {saveData.playerName || 'Guest'}
                  </strong>
                </span>
                <span className="font-mono-tabular text-amber-300">
                  Best: {saveData.bestScore.toLocaleString()} pts
                </span>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => onStartRun()}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Retry Now</span>
              </button>
              <button
                type="button"
                onClick={onBackToMenu}
                className="min-h-[44px] flex-1 rounded-xl border border-white/15 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                Main Menu
              </button>
            </div>
          </div>

          {/* Right Column: Live Global High Scores Leaderboard */}
          <div className="sm:col-span-6">
            <LeaderboardPanel
              entries={leaderboard}
              currentPlayerId={saveData.playerId}
              isLoading={leaderboardLoading}
              isSyncing={leaderboardSyncing}
              error={leaderboardError}
              onRetry={onRetryLeaderboard}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

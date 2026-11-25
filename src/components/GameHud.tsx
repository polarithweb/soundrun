import {
  ChevronDown,
  ChevronUp,
  CircleDot,
  Cloud,
  CloudRain,
  Coins,
  Mic,
  MicOff,
  Moon,
  Pause,
  Shield,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import type {
  AudioCalibration,
  AudioTelemetry,
  HudSnapshot,
} from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  audio: AudioTelemetry;
  calibration: AudioCalibration;
  mutedSfx: boolean;
  onChangeCalibration: (next: AudioCalibration) => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRetryMic: () => void;
}

function DayPhaseIcon({ label }: { label: HudSnapshot['dayPhaseLabel'] }) {
  if (label === 'Day') {
    return <Sun className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />;
  }
  if (label === 'Golden Hour') {
    return <Sunset className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />;
  }
  if (label === 'Night') {
    return <Moon className="h-3.5 w-3.5 text-sky-300" aria-hidden="true" />;
  }
  return <Sunrise className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />;
}

function WeatherIcon({ label }: { label: HudSnapshot['weatherLabel'] }) {
  if (label === 'Rainy') {
    return <CloudRain className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />;
  }
  if (label === 'Overcast') {
    return <Cloud className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />;
  }
  return <Sparkles className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />;
}

export function GameHud({
  hud,
  audio,
  calibration,
  mutedSfx,
  onChangeCalibration,
  onToggleMute,
  onPause,
  onRetryMic,
}: GameHudProps) {
  const [dockExpanded, setDockExpanded] = useState(false);

  const meterPct = Math.round(audio.normalizedLevel * 100);
  const movePct = Math.round(calibration.threshold * 100);
  const jumpPct = Math.round(audio.jumpThreshold * 100);
  const isJumpingZone = audio.normalizedLevel >= audio.jumpThreshold;
  const isMovingZone = audio.normalizedLevel >= calibration.threshold;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/80 px-3.5 py-2 text-slate-50">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="font-display text-sm font-bold text-white">
              Echo Meadow Run
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <DayPhaseIcon label={hud.dayPhaseLabel} />
              <span>{hud.dayPhaseLabel}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <WeatherIcon label={hud.weatherLabel} />
              <span>{hud.weatherLabel}</span>
            </span>
          </div>

          <div className="mt-1 flex items-center gap-3 text-xs">
            <span className="font-mono-tabular font-bold text-amber-400">
              {Math.floor(hud.distance)}m
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular text-slate-200">
              {hud.score.toLocaleString()} pts
            </span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/80 px-3.5 py-2 text-xs">
            <span className="inline-flex items-center gap-1 font-mono-tabular font-semibold text-amber-300">
              <Coins className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{hud.coinsCollected}</span>
            </span>

            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>

            <span className="inline-flex items-center gap-1 font-mono-tabular font-semibold text-pink-400">
              <Star className="h-3.5 w-3.5 fill-pink-500" aria-hidden="true" />
              <span>{hud.pinkCoinsCollected}</span>
            </span>

            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>

            <span className="inline-flex items-center gap-1 font-mono-tabular">
              <CircleDot
                className="h-3.5 w-3.5 text-sky-300"
                aria-label="Rescue Bubbles"
              />
              <span className="text-slate-100">{hud.bubblesLeft}</span>
              {hud.isSuper && (
                <Shield
                  className="ml-1 h-3.5 w-3.5 fill-emerald-400/30 text-emerald-400"
                  aria-label="Super growth active"
                />
              )}
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={mutedSfx ? 'Unmute sound effects' : 'Mute sound effects'}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-slate-950/80 text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            {mutedSfx ? (
              <VolumeX className="h-4 w-4 text-slate-400" />
            ) : (
              <Volume2 className="h-4 w-4 text-slate-100" />
            )}
          </button>

          <button
            type="button"
            onClick={onPause}
            aria-label="Pause game"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-slate-950/80 text-slate-100 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            <Pause className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="pointer-events-auto mx-auto flex w-full max-w-lg flex-col items-center">
        {hud.inBubble && (
          <div className="mb-2 rounded-lg border border-sky-400/40 bg-slate-950/90 px-3.5 py-1.5 text-xs font-medium text-sky-200">
            Floating in Rescue Bubble — make a sound to pop back onto safe ground!
          </div>
        )}

        {audio.micError && (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-rose-500/40 bg-slate-950/90 px-3 py-1.5 text-xs text-rose-200">
            <MicOff className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
            <span className="truncate">{audio.micError}</span>
            <button
              type="button"
              onClick={onRetryMic}
              className="shrink-0 rounded bg-rose-500 px-2.5 py-1 font-semibold text-white hover:bg-rose-400"
            >
              Retry Mic
            </button>
          </div>
        )}

        <div className="w-full rounded-xl border border-white/10 bg-slate-950/85 px-3.5 py-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-200">
              {audio.isMicActive ? (
                <Mic className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              ) : (
                <MicOff className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
              )}
              <span className="whitespace-nowrap">Voice Drive</span>
            </span>

            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-colors duration-75 ${
                  isJumpingZone
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

            <span className="w-20 shrink-0 text-right font-mono-tabular text-[11px] text-slate-300">
              {audio.soundStateLabel}
            </span>

            <button
              type="button"
              onClick={() => setDockExpanded((v) => !v)}
              aria-expanded={dockExpanded}
              aria-label={dockExpanded ? 'Hide mic settings' : 'Show mic settings'}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              {dockExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
          </div>

          {dockExpanded && (
            <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-white/10 pt-2.5">
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span className="flex justify-between">
                  <span>Move / Jump</span>
                  <span className="font-mono-tabular text-slate-100">
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

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span className="flex justify-between">
                  <span>Mic Sensitivity</span>
                  <span className="font-mono-tabular text-slate-100">
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
          )}
        </div>
      </div>
    </div>
  );
}

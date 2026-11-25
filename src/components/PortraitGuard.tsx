import { Maximize2, Smartphone } from 'lucide-react';
import { useState } from 'react';

interface PortraitGuardProps {
  isPortrait: boolean;
}

export function PortraitGuard({ isPortrait }: PortraitGuardProps) {
  const [lockMessage, setLockMessage] = useState<string | null>(null);

  if (!isPortrait) {
    return null;
  }

  const handleLockLandscape = async () => {
    setLockMessage(null);
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (orientation: 'landscape') => Promise<void>;
      };
      if (orientation && typeof orientation.lock === 'function') {
        await orientation.lock('landscape');
      } else {
        setLockMessage('Rotate your phone sideways to continue in landscape.');
      }
    } catch {
      setLockMessage('Rotate your phone sideways to continue in landscape.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="portrait-guard-title"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 px-6 text-center text-slate-50"
    >
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-amber-400/40 bg-slate-900">
        <Smartphone className="h-10 w-10 rotate-90 text-amber-400" aria-hidden="true" />
      </div>
      <h2
        id="portrait-guard-title"
        className="font-display text-2xl font-bold tracking-wide text-white"
      >
        Rotate Device to Landscape
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-300">
        Echo Meadow Run is designed strictly for widescreen landscape play. Turn your
        device horizontally to sprint across the rolling green hills.
      </p>
      <button
        type="button"
        onClick={handleLockLandscape}
        className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        <Maximize2 className="h-4 w-4" aria-hidden="true" />
        <span>Enter Fullscreen Landscape</span>
      </button>
      {lockMessage && (
        <p className="mt-3 text-xs text-slate-400">{lockMessage}</p>
      )}
    </div>
  );
}

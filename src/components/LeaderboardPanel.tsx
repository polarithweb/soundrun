import {
  AlertCircle,
  Crown,
  Medal,
  RefreshCw,
  Star,
  Trophy,
} from 'lucide-react';
import type { LeaderboardEntry } from '../game/types';

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  currentPlayerId: string;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  onRetry: () => void;
}

export function LeaderboardPanel({
  entries,
  currentPlayerId,
  isLoading,
  isSyncing,
  error,
  onRetry,
}: LeaderboardPanelProps) {
  const myIndex = entries.findIndex((e) => e.playerId === currentPlayerId);
  const myRank = myIndex >= 0 ? myIndex + 1 : null;

  const topThree = entries.slice(0, 3);
  const rest = entries.slice(3);

  // Classic podium order: #2 (left), #1 (center), #3 (right)
  const podiumSlots: Array<{
    entry: LeaderboardEntry | undefined;
    rank: 1 | 2 | 3;
  }> = [
    { entry: topThree[1], rank: 2 },
    { entry: topThree[0], rank: 1 },
    { entry: topThree[2], rank: 3 },
  ];

  return (
    <section
      aria-label="Global High Scores Leaderboard"
      className="flex h-full min-h-[240px] flex-col rounded-xl border border-white/12 bg-slate-900/90 p-3.5 text-slate-100"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold tracking-wide text-white uppercase">
            Global High Scores
          </h2>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          {myRank !== null && (
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono-tabular font-semibold text-emerald-300">
              Rank #{myRank}
            </span>
          )}
          <span className="font-mono-tabular text-slate-400">
            {isSyncing ? 'Syncing...' : 'Live'}
          </span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-rose-500/35 bg-rose-950/70 px-2.5 py-2 text-[11px] text-rose-200"
        >
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
            <span>{error}</span>
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-500/30 px-2 py-1 font-semibold text-rose-100 hover:bg-rose-500/45"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="mt-3 flex flex-1 flex-col gap-2" aria-busy="true">
          <div className="grid grid-cols-3 gap-2">
            <div className="h-20 rounded-lg bg-slate-800/80" />
            <div className="h-24 rounded-lg bg-slate-800/90" />
            <div className="h-20 rounded-lg bg-slate-800/80" />
          </div>
          <div className="h-8 rounded-md bg-slate-800/60" />
          <div className="h-8 rounded-md bg-slate-800/50" />
          <div className="h-8 rounded-md bg-slate-800/40" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <Crown className="h-7 w-7 text-amber-400/70" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-slate-200">
            No champions on the board yet
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Enter your name and finish a run to claim #1!
          </p>
        </div>
      ) : (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2.5">
          {/* Top 3 Champions Podium */}
          <div className="grid grid-cols-3 items-end gap-2">
            {podiumSlots.map(({ entry, rank }) => {
              if (!entry) {
                return (
                  <div
                    key={rank}
                    className="flex h-20 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-slate-950/40 text-[10px] text-slate-500"
                  >
                    <span>#{rank}</span>
                    <span>Open</span>
                  </div>
                );
              }

              const isMe = entry.playerId === currentPlayerId;
              const isGold = rank === 1;
              const isSilver = rank === 2;

              const borderClass = isMe
                ? 'border-emerald-400/80 bg-emerald-950/45'
                : isGold
                  ? 'border-amber-400/60 bg-amber-950/35'
                  : isSilver
                    ? 'border-slate-300/35 bg-slate-800/70'
                    : 'border-orange-400/40 bg-orange-950/30';

              return (
                <div
                  key={entry.playerId}
                  className={`flex flex-col items-center justify-between rounded-lg border px-2 py-2 text-center ${borderClass} ${
                    isGold ? 'min-h-[96px]' : 'min-h-[82px]'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-bold">
                    {isGold ? (
                      <Crown className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                    ) : (
                      <Medal
                        className={`h-3.5 w-3.5 ${
                          isSilver ? 'text-slate-300' : 'text-orange-400'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={
                        isGold
                          ? 'text-amber-300'
                          : isSilver
                            ? 'text-slate-200'
                            : 'text-orange-300'
                      }
                    >
                      #{rank}
                    </span>
                  </div>

                  <div className="mt-0.5 flex w-full items-center justify-center gap-1">
                    <span className="truncate text-xs font-bold text-white">
                      {entry.playerName}
                    </span>
                    {isMe && (
                      <span className="shrink-0 rounded bg-emerald-500/30 px-1 text-[9px] font-bold text-emerald-200 uppercase">
                        You
                      </span>
                    )}
                  </div>

                  <div className="mt-1 font-mono-tabular text-xs font-bold text-amber-300">
                    {entry.bestScore.toLocaleString()}
                  </div>
                  <div className="font-mono-tabular text-[10px] text-slate-400">
                    {entry.bestDistance}m
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ranked List #4 to #25 */}
          {rest.length > 0 && (
            <div className="max-h-36 flex-1 overflow-y-auto pr-1 sm:max-h-44">
              <ol className="flex flex-col gap-1">
                {rest.map((entry, idx) => {
                  const rank = idx + 4;
                  const isMe = entry.playerId === currentPlayerId;
                  return (
                    <li
                      key={entry.playerId}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                        isMe
                          ? 'border-emerald-400/60 bg-emerald-950/50 text-white'
                          : 'border-white/5 bg-slate-950/60 text-slate-200'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-6 shrink-0 font-mono-tabular text-[11px] font-semibold text-slate-400">
                          #{rank}
                        </span>
                        <span className="truncate font-semibold">
                          {entry.playerName}
                        </span>
                        {isMe && (
                          <span className="shrink-0 rounded bg-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200 uppercase">
                            You
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2.5 font-mono-tabular text-[11px]">
                        <span className="text-slate-400">{entry.bestDistance}m</span>
                        {entry.pinkCoinsCollected > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-pink-400">
                            <Star
                              className="h-3 w-3 fill-pink-500"
                              aria-hidden="true"
                            />
                            <span>{entry.pinkCoinsCollected}</span>
                          </span>
                        )}
                        <span className="w-16 text-right font-bold text-amber-300">
                          {entry.bestScore.toLocaleString()}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Crown, Handshake, RotateCcw, ShieldX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GameOutcome } from '@/lib/chess/outcome'

interface GameOverModalProps {
  /** Null while the game is still running; the modal is then not rendered. */
  outcome: GameOutcome | null
  open: boolean
  onRematch: () => void
  /** Dismiss without starting a new game, so the final position stays visible. */
  onDismiss: () => void
  /** Number of moves played, shown as a small footnote. */
  moveCount: number
}

const TONE = {
  win: {
    Icon: Crown,
    ring: 'ring-emerald-400/40',
    glow: 'from-emerald-400/25',
    text: 'text-emerald-300',
    chip: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30',
    label: 'Victory',
  },
  loss: {
    Icon: ShieldX,
    ring: 'ring-red-400/40',
    glow: 'from-red-400/25',
    text: 'text-red-300',
    chip: 'bg-red-400/10 text-red-300 border-red-400/30',
    label: 'Defeat',
  },
  draw: {
    Icon: Handshake,
    ring: 'ring-amber-300/40',
    glow: 'from-amber-300/25',
    text: 'text-amber-200',
    chip: 'bg-amber-300/10 text-amber-200 border-amber-300/30',
    label: 'Drawn',
  },
} as const

/**
 * End-of-game announcement.
 *
 * The result used to live only in a 24px status strip under the board, in the
 * same slot and near enough the same styling as "White to move" — easy to miss
 * entirely, and for a player driving with their eyes, the one moment the game
 * genuinely needs to interrupt them.
 */
export default function GameOverModal({
  outcome,
  open,
  onRematch,
  onDismiss,
  moveCount,
}: GameOverModalProps) {
  const tone = outcome ? TONE[outcome.tone] : null

  return (
    <AnimatePresence>
      {open && outcome && tone && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={onDismiss}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="game-over-headline"
            aria-describedby="game-over-detail"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-8 text-center shadow-2xl ring-1 ${tone.ring}`}
          >
            <div
              className={`pointer-events-none absolute inset-x-0 -top-24 h-48 bg-gradient-to-b ${tone.glow} to-transparent blur-2xl`}
            />

            <button
              onClick={onDismiss}
              aria-label="Dismiss result and view the final position"
              className="absolute right-3 top-3 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative space-y-5">
              <motion.div
                initial={{ scale: 0.5, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.08, type: 'spring', stiffness: 240, damping: 16 }}
                className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-background ${tone.text}`}
              >
                <tone.Icon className="h-8 w-8" />
              </motion.div>

              <div className="space-y-2">
                <span
                  className={`inline-block rounded-full border px-3 py-0.5 text-xs font-semibold uppercase tracking-widest ${tone.chip}`}
                >
                  {tone.label}
                </span>
                <h2
                  id="game-over-headline"
                  className={`text-3xl font-bold tracking-tight sm:text-4xl ${tone.text}`}
                >
                  {outcome.headline}
                </h2>
                <p id="game-over-detail" className="text-sm leading-relaxed text-muted-foreground">
                  {outcome.detail}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                {moveCount} {moveCount === 1 ? 'move' : 'moves'} played
              </p>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button onClick={onRematch} size="lg" className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Play again
                </Button>
                <Button onClick={onDismiss} variant="outline" size="lg">
                  View board
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

'use client'

import { motion } from 'framer-motion'
import { Move } from '@/lib/chess/types'
import { Clock } from 'lucide-react'

interface MoveHistoryPanelProps {
  moves: Move[]
}

export default function MoveHistoryPanel({ moves }: MoveHistoryPanelProps) {
  // Group moves into pairs (white move, black move)
  const movePairs = []
  for (let i = 0; i < moves.length; i += 2) {
    movePairs.push({
      number: i / 2 + 1,
      white: moves[i] || null,
      black: moves[i + 1] || null,
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="h-full flex flex-col gap-4 p-6 bg-card border-l border-border rounded-lg"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-foreground">Move History</h3>
      </div>

      {/* Move List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
        {movePairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No moves yet...</p>
        ) : (
          movePairs.map((pair) => (
            <motion.div
              key={pair.number}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-2 text-sm font-mono"
            >
              <span className="w-8 text-muted-foreground min-w-fit">
                {pair.number}.
              </span>
              <div className="flex gap-2 flex-1">
                <motion.span
                  key={`white-${pair.number}`}
                  initial={{ scale: 1.1, color: 'rgba(168, 85, 247, 0.8)' }}
                  animate={{ scale: 1, color: 'rgba(149, 165, 166, 1)' }}
                  transition={{ duration: 0.2 }}
                  className="px-2 py-1 rounded bg-primary/10 text-primary flex-1 text-center"
                >
                  {pair.white?.notation || '—'}
                </motion.span>
                <span className="px-2 py-1 rounded bg-muted/50 text-foreground flex-1 text-center">
                  {pair.black?.notation || '—'}
                </span>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Statistics */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Moves:</span>
          <span className="font-semibold text-foreground">{moves.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Move Pairs:</span>
          <span className="font-semibold text-foreground">{movePairs.length}</span>
        </div>
      </div>
    </motion.div>
  )
}

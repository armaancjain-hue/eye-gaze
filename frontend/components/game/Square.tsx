'use client'

import { motion } from 'framer-motion'
import { Piece } from '@/lib/chess/types'
import { PIECE_UNICODE } from '@/lib/chess/constants'

interface SquareProps {
  row: number
  col: number
  piece: Piece | null
  isLight: boolean
  isSelected: boolean
  isLastMove: boolean
  isCheck: boolean
  isLegalMove: boolean
  onClick: () => void
  /** 0..1 gaze-dwell progress toward activating this square, if any. */
  dwellProgress?: number
  /** 0..1 confidence in that square, which fades the ring when it is weak. */
  dwellConfidence?: number
  /** File letter, drawn in-square on the bottom rank only. */
  fileLabel?: string
  /** Rank number, drawn in-square on the a-file only. */
  rankLabel?: string
}

export default function Square({
  row,
  col,
  piece,
  isLight,
  isSelected,
  isLastMove,
  isCheck,
  isLegalMove,
  onClick,
  dwellProgress = 0,
  dwellConfidence = 1,
  fileLabel,
  rankLabel,
}: SquareProps) {
  const baseColor = isLight ? 'bg-card' : 'bg-muted'
  const hoverColor = isLight ? 'hover:bg-primary/20' : 'hover:bg-primary/30'

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      data-square={`${row}-${col}`}
      style={{ containerType: 'size' }}
      className={`
        relative w-full aspect-square flex items-center justify-center
        ${baseColor} ${hoverColor}
        transition-all duration-200
        border border-transparent
        ${isSelected ? 'border-2 border-primary ring-2 ring-primary/50' : ''}
        ${isLastMove ? 'bg-accent/20' : ''}
        ${isCheck ? 'bg-destructive/30 ring-2 ring-destructive' : ''}
        ${isLegalMove ? 'ring-2 ring-primary/40' : ''}
        cursor-pointer
      `}
    >
      {/* Coordinates are drawn inside the edge squares rather than in gutters
          around the board. The gutters cost ~36px of layout in both axes, and on
          a height-constrained screen that is the difference between the board
          fitting at one square size and the next one down. */}
      {rankLabel && (
        <span
          aria-hidden
          className="absolute left-[4cqmin] top-[2cqmin] font-semibold text-muted-foreground/70 select-none pointer-events-none"
          style={{ fontSize: '13cqmin', lineHeight: 1 }}
        >
          {rankLabel}
        </span>
      )}
      {fileLabel && (
        <span
          aria-hidden
          className="absolute right-[4cqmin] bottom-[2cqmin] font-semibold text-muted-foreground/70 select-none pointer-events-none uppercase"
          style={{ fontSize: '13cqmin', lineHeight: 1 }}
        >
          {fileLabel}
        </span>
      )}

      {/* Gaze dwell progress ring. Its opacity tracks confidence, so a square
          the tracker is only half-sure about looks half-sure rather than
          identical to a certain one. */}
      {dwellProgress > 0 && (
        <div
          className="absolute inset-0 pointer-events-none rounded-sm"
          style={{
            background: `conic-gradient(rgba(168,85,247,${0.2 + 0.45 * Math.max(0, Math.min(1, dwellConfidence))}) ${dwellProgress * 360}deg, transparent 0deg)`,
            WebkitMaskImage: 'radial-gradient(circle, transparent 62%, black 64%)',
            maskImage: 'radial-gradient(circle, transparent 62%, black 64%)',
          }}
        />
      )}

      {/* Legal move indicator */}
      {isLegalMove && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`absolute ${piece ? 'w-4 h-4 ring-2 ring-primary' : 'w-2 h-2 bg-primary/60 rounded-full'}`}
        />
      )}

      {/* Piece */}
      {piece && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 20,
          }}
          style={{ fontSize: '70cqmin', lineHeight: 1 }}
          className="cursor-move select-none"
        >
          {PIECE_UNICODE[`${piece.color}_${piece.type}`]}
        </motion.div>
      )}
    </motion.button>
  )
}

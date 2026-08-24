'use client'

import { Fragment, useMemo } from 'react'
import { motion } from 'framer-motion'
import { GameState, BoardPosition } from '@/lib/chess/types'
import { BOARD_SIZE, COLUMN_LABELS, PIECE_UNICODE } from '@/lib/chess/constants'
import { getLegalMoves, getPieceAt } from '@/lib/chess/engine'
import Square from './Square'

interface ChessboardProps {
  gameState: GameState
  onSquareClick: (row: number, col: number) => void
  /** Square currently being dwelled on via gaze, if any. */
  dwellSquare?: BoardPosition | null
  /** 0..1 progress of the current dwell. */
  dwellProgress?: number
  /** 0..1 confidence that the dwelled square is the one being looked at. */
  dwellConfidence?: number
  /** True while the engine (Black) is computing its move. */
  isThinking?: boolean
}

export default function Chessboard({
  gameState,
  onSquareClick,
  dwellSquare = null,
  dwellProgress = 0,
  dwellConfidence = 1,
  isThinking = false,
}: ChessboardProps) {
  const legalMoves = useMemo(() => {
    if (!gameState.selectedSquare) return []
    return getLegalMoves(gameState.board, gameState.selectedSquare.row, gameState.selectedSquare.col)
  }, [gameState.selectedSquare, gameState.board])
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-2 w-full min-w-0">
      {/* Board — scales to the available space and never overflows. Its width is
          the smallest of: the container, the leftover viewport height after the
          top bar / labels / status (so it also fits vertically without clipping),
          and a large maximum for big monitors. Bigger squares are the single most
          reliable accuracy win: gaze error stays roughly fixed in pixels, so wider
          targets are hit far more often. Square cells are `1fr` columns with a 1:1
          aspect ratio, so everything derives from that width. */}
      {/* Opacity-only entrance: a `scale` here would leave the board rendered at
          <100% if the animation is ever interrupted or throttled, silently
          shrinking every square — the opposite of what we want for accuracy. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="rounded-lg overflow-hidden border-2 border-primary/30 shadow-2xl bg-background"
        style={{ width: 'min(100%, calc(100vh - 150px), 1180px)' }}
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: 'minmax(1rem, auto) repeat(8, 1fr)' }}
        >
          {/* Corner spacer + file labels */}
          <div />
          {COLUMN_LABELS.map((label) => (
            <div
              key={label}
              className="h-5 flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase"
            >
              {label}
            </div>
          ))}

          {gameState.board.map((row, rowIndex) => (
            <Fragment key={rowIndex}>
              {/* Rank label */}
              <div className="flex items-center justify-center px-1 text-xs font-semibold text-muted-foreground">
                {BOARD_SIZE - rowIndex}
              </div>

              {/* Squares */}
              {row.map((piece, colIndex) => {
                const isLight = (rowIndex + colIndex) % 2 === 0
                const isSelected =
                  gameState.selectedSquare?.row === rowIndex &&
                  gameState.selectedSquare?.col === colIndex
                const isLastMove = !!(
                  gameState.lastMove &&
                  ((gameState.lastMove.from.row === rowIndex &&
                    gameState.lastMove.from.col === colIndex) ||
                    (gameState.lastMove.to.row === rowIndex &&
                      gameState.lastMove.to.col === colIndex))
                )
                const isCheckSquare =
                  gameState.status.includes('check') &&
                  piece?.type === 'K' &&
                  piece?.color === (gameState.whiteToMove ? 'white' : 'black')
                const isLegalMove = legalMoves.some(
                  (move) => move.row === rowIndex && move.col === colIndex
                )
                const isDwelling =
                  dwellSquare?.row === rowIndex && dwellSquare?.col === colIndex

                return (
                  <Square
                    key={`${rowIndex}-${colIndex}`}
                    row={rowIndex}
                    col={colIndex}
                    piece={piece}
                    isLight={isLight}
                    isSelected={isSelected}
                    isLastMove={isLastMove}
                    isCheck={isCheckSquare}
                    isLegalMove={isLegalMove}
                    onClick={() => onSquareClick(rowIndex, colIndex)}
                    dwellProgress={isDwelling ? dwellProgress : 0}
                    dwellConfidence={dwellConfidence}
                  />
                )
              })}
            </Fragment>
          ))}
        </div>
      </motion.div>

      {/* Game status */}
      <div className="text-center text-sm">
        {gameState.status === 'checkmate' ? (
          <p className="text-accent font-semibold">Checkmate</p>
        ) : gameState.status === 'stalemate' ? (
          <p className="text-muted-foreground font-semibold">Stalemate — draw</p>
        ) : isThinking ? (
          <p className="text-primary font-semibold animate-pulse">
            Stockfish is thinking…
          </p>
        ) : (
          <p className="text-muted-foreground">
            {gameState.whiteToMove ? 'White' : 'Black'} to move
          </p>
        )}
        {gameState.status.includes('check') && (
          <p className="text-accent font-semibold">Check!</p>
        )}
      </div>
    </div>
  )
}

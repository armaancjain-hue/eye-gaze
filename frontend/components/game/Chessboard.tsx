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
  /** True while the engine (Black) is computing its move. */
  isThinking?: boolean
}

export default function Chessboard({
  gameState,
  onSquareClick,
  dwellSquare = null,
  dwellProgress = 0,
  isThinking = false,
}: ChessboardProps) {
  const legalMoves = useMemo(() => {
    if (!gameState.selectedSquare) return []
    return getLegalMoves(gameState.board, gameState.selectedSquare.row, gameState.selectedSquare.col)
  }, [gameState.selectedSquare, gameState.board])
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 w-full min-w-0">
      {/* Board — scales to the available space and never overflows. Its width is
          the smallest of: the container, a share of viewport height (so it also
          fits vertically), and a comfortable maximum. Square cells are `1fr`
          columns with a 1:1 aspect ratio, so everything derives from that width. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="rounded-lg overflow-hidden border-2 border-primary/30 shadow-2xl bg-background"
        style={{ width: 'min(100%, 82vh, 880px)' }}
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

'use client'

import ChessPiece from '@/components/game/ChessPiece'
import { BOARD_COLORS, COLUMN_LABELS } from '@/lib/chess/constants'
import type { Piece, PieceType } from '@/lib/chess/types'

/**
 * The decorative board in the landing hero.
 *
 * It renders the same piece set and the same square palette as the real game,
 * so what a visitor is shown on the marketing page is literally what they get
 * when they press Start Playing.
 */

const BACK_RANK: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']

/** Start position with White's king pawn already pushed to e4 — the highlighted square. */
function openingPosition(): (Piece | null)[][] {
  const empty = (): (Piece | null)[] => Array.from({ length: 8 }, () => null)
  const board: (Piece | null)[][] = Array.from({ length: 8 }, empty)

  board[0] = BACK_RANK.map((type) => ({ type, color: 'black' as const }))
  board[1] = Array.from({ length: 8 }, () => ({ type: 'P' as PieceType, color: 'black' as const }))
  board[6] = Array.from({ length: 8 }, () => ({ type: 'P' as PieceType, color: 'white' as const }))
  board[7] = BACK_RANK.map((type) => ({ type, color: 'white' as const }))

  // e2 -> e4. Row 4 is rank 4, column 4 is the e-file.
  board[6][4] = null
  board[4][4] = { type: 'P', color: 'white' }

  return board
}

/** Row/col of the square the hero's gaze beam lands on (e4). */
export const HIGHLIGHT = { row: 4, col: 4 }

export default function MiniBoard({ className = '' }: { className?: string }) {
  const board = openingPosition()

  return (
    <div className={`rounded-xl overflow-hidden ring-1 ring-white/10 shadow-2xl ${className}`}>
      <div className="grid grid-cols-8">
        {board.map((rank, row) =>
          rank.map((piece, col) => {
            const isLight = (row + col) % 2 === 0
            const isHighlight = row === HIGHLIGHT.row && col === HIGHLIGHT.col
            return (
              <div
                key={`${row}-${col}`}
                data-hero-square={isHighlight ? 'target' : undefined}
                className="relative aspect-square flex items-center justify-center"
                style={{
                  containerType: 'size',
                  backgroundColor: isLight ? BOARD_COLORS.light : BOARD_COLORS.dark,
                }}
              >
                {isHighlight && (
                  <span
                    className="absolute inset-0 animate-pulse"
                    style={{
                      background:
                        'radial-gradient(circle at center, rgba(167,139,250,0.55), rgba(167,139,250,0.08) 70%)',
                      boxShadow: 'inset 0 0 0 2px rgba(196,181,253,0.85)',
                    }}
                  />
                )}
                {col === 0 && (
                  <span
                    aria-hidden
                    className="absolute left-[5cqmin] top-[3cqmin] font-bold"
                    style={{
                      fontSize: '18cqmin',
                      lineHeight: 1,
                      color: isLight ? BOARD_COLORS.labelOnLight : BOARD_COLORS.labelOnDark,
                    }}
                  >
                    {8 - row}
                  </span>
                )}
                {row === 7 && (
                  <span
                    aria-hidden
                    className="absolute right-[5cqmin] bottom-[3cqmin] font-bold"
                    style={{
                      fontSize: '18cqmin',
                      lineHeight: 1,
                      color: isLight ? BOARD_COLORS.labelOnLight : BOARD_COLORS.labelOnDark,
                    }}
                  >
                    {COLUMN_LABELS[col]}
                  </span>
                )}
                {piece && (
                  <div className="relative w-[84cqmin] h-[84cqmin]">
                    <ChessPiece type={piece.type} color={piece.color} className="w-full h-full" />
                  </div>
                )}
              </div>
            )
          }),
        )}
      </div>
    </div>
  )
}

export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K'
export type PieceColor = 'white' | 'black'

export interface Piece {
  type: PieceType
  color: PieceColor
}

export type SquareContent = Piece | null

export interface BoardPosition {
  row: number
  col: number
}

export interface Move {
  from: BoardPosition
  to: BoardPosition
  /** Standard algebraic notation, e.g. "Nf3", "exd5", "O-O", "e8=Q+". */
  notation: string
  timestamp: number
}

/**
 * How the game currently stands. The draw variants are distinguished because
 * "stalemate" and "draw by repetition" mean very different things to a player,
 * and a game that silently keeps going after a threefold repetition is a bug
 * the previous rules engine had no way to notice.
 */
export type GameStatus =
  | 'playing'
  | 'white_check'
  | 'black_check'
  | 'checkmate'
  | 'stalemate'
  | 'draw_repetition'
  | 'draw_fifty_move'
  | 'draw_insufficient'

export interface GameState {
  /**
   * Full FEN — the authoritative position, and the only field that is written
   * to directly. Castling rights, the en-passant target and the halfmove clock
   * live here and nowhere else; `board` cannot represent them, which is exactly
   * why deriving those by inspecting piece placement used to get them wrong.
   */
  fen: string
  /** Piece placement derived from `fen`, for rendering. Row 0 is rank 8. */
  board: SquareContent[][]
  /** Derived from `fen`. */
  whiteToMove: boolean
  moves: Move[]
  status: GameStatus
  selectedSquare: BoardPosition | null
  lastMove: Move | null
  capturedPieces: {
    white: PieceType[]
    black: PieceType[]
  }
}

/** True for any status that means the game is over. */
export function isGameOver(status: GameStatus): boolean {
  return status !== 'playing' && status !== 'white_check' && status !== 'black_check'
}

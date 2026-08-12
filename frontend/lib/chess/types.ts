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
  notation: string
  timestamp: number
}

export interface GameState {
  board: SquareContent[][]
  whiteToMove: boolean
  moves: Move[]
  status: 'playing' | 'white_check' | 'black_check' | 'checkmate' | 'stalemate'
  selectedSquare: BoardPosition | null
  lastMove: Move | null
  capturedPieces: {
    white: PieceType[]
    black: PieceType[]
  }
}

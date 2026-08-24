export const BOARD_SIZE = 8
export const SQUARE_SIZE_PX = 88

export const COLUMN_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const ROW_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

// Both colours use the solid (filled) glyph set; the piece's actual colour is
// applied in the UI (Square.tsx). Using the outline glyphs for one side made
// those pieces read as "white" regardless of which side they were on, so the
// board looked like White was on top. Solid-for-both + real colour keeps White
// (the player) unmistakably white at the bottom.
export const PIECE_UNICODE: Record<string, string> = {
  'white_P': '♟',
  'white_N': '♞',
  'white_B': '♝',
  'white_R': '♜',
  'white_Q': '♛',
  'white_K': '♚',
  'black_P': '♟',
  'black_N': '♞',
  'black_B': '♝',
  'black_R': '♜',
  'black_Q': '♛',
  'black_K': '♚',
}

export const INITIAL_BOARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'

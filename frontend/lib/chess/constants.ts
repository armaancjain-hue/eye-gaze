export const BOARD_SIZE = 8
export const SQUARE_SIZE_PX = 64

export const COLUMN_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const ROW_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

export const PIECE_UNICODE: Record<string, string> = {
  'black_P': '♙',
  'black_N': '♘',
  'black_B': '♗',
  'black_R': '♖',
  'black_Q': '♕',
  'black_K': '♔',
  'white_P': '♟',
  'white_N': '♞',
  'white_B': '♝',
  'white_R': '♜',
  'white_Q': '♛',
  'white_K': '♚',
}

export const INITIAL_BOARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'

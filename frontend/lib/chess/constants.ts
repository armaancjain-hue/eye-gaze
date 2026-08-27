export const BOARD_SIZE = 8
export const SQUARE_SIZE_PX = 88

export const COLUMN_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const ROW_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

export const INITIAL_BOARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'

/**
 * Board palette — deep green and near-black, replacing the old grey-on-grey
 * pair. The two square colours differ in hue as well as lightness, so the grid
 * stays readable for players who see little contrast between two greys, and the
 * cream/charcoal piece set reads cleanly on both.
 */
export const BOARD_COLORS = {
  light: '#69926f',
  dark: '#1e2823',
  /** Ring/edge tint used for the frame around the board. */
  edge: '#2f4237',
  /** Wash laid over the from/to squares of the last move. */
  lastMove: 'rgba(245, 212, 92, 0.38)',
  /** Wash over the king's square while it is in check. */
  check: 'rgba(220, 68, 55, 0.55)',
  /** In-square coordinate labels, drawn in the *other* square colour. */
  labelOnLight: 'rgba(30, 40, 35, 0.75)',
  labelOnDark: 'rgba(105, 146, 111, 0.85)',
} as const

import { GameState, Move } from './types'

export const createInitialBoard = () => {
  const board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null))

  // Place black pieces
  board[0][0] = { type: 'R', color: 'black' }
  board[0][1] = { type: 'N', color: 'black' }
  board[0][2] = { type: 'B', color: 'black' }
  board[0][3] = { type: 'Q', color: 'black' }
  board[0][4] = { type: 'K', color: 'black' }
  board[0][5] = { type: 'B', color: 'black' }
  board[0][6] = { type: 'N', color: 'black' }
  board[0][7] = { type: 'R', color: 'black' }

  for (let col = 0; col < 8; col++) {
    board[1][col] = { type: 'P', color: 'black' }
  }

  // Place white pieces
  for (let col = 0; col < 8; col++) {
    board[6][col] = { type: 'P', color: 'white' }
  }

  board[7][0] = { type: 'R', color: 'white' }
  board[7][1] = { type: 'N', color: 'white' }
  board[7][2] = { type: 'B', color: 'white' }
  board[7][3] = { type: 'Q', color: 'white' }
  board[7][4] = { type: 'K', color: 'white' }
  board[7][5] = { type: 'B', color: 'white' }
  board[7][6] = { type: 'N', color: 'white' }
  board[7][7] = { type: 'R', color: 'white' }

  return board
}

const mockMoves: Move[] = [
  {
    from: { row: 6, col: 4 },
    to: { row: 4, col: 4 },
    notation: 'e4',
    timestamp: Date.now() - 5000,
  },
  {
    from: { row: 1, col: 4 },
    to: { row: 3, col: 4 },
    notation: 'e5',
    timestamp: Date.now() - 3000,
  },
  {
    from: { row: 7, col: 6 },
    to: { row: 5, col: 5 },
    notation: 'Nf3',
    timestamp: Date.now() - 1000,
  },
]

export const createInitialGameState = (): GameState => {
  const board = createInitialBoard()

  return {
    board,
    whiteToMove: true,
    moves: mockMoves,
    status: 'playing',
    selectedSquare: null,
    lastMove: mockMoves[mockMoves.length - 1] || null,
    capturedPieces: {
      white: [],
      black: [],
    },
  }
}

export const mockCapturedPieces = {
  white: [] as any[],
  black: [] as any[],
}

export const getMoveHistory = () => {
  return mockMoves
}

import { GameState, BoardPosition, Move, Piece, PieceType, SquareContent } from './types'

export function isValidPosition(row: number, col: number): boolean {
  return row >= 0 && row <= 7 && col >= 0 && col <= 7
}

export function getPieceAt(board: SquareContent[][], row: number, col: number): Piece | null {
  if (!isValidPosition(row, col)) return null
  return board[row][col]
}

export function isSameColor(piece1: Piece | null, piece2: Piece | null): boolean {
  if (!piece1 || !piece2) return false
  return piece1.color === piece2.color
}

function getPawnMoves(board: SquareContent[][], row: number, col: number, piece: Piece): BoardPosition[] {
  const moves: BoardPosition[] = []
  const direction = piece.color === 'white' ? -1 : 1
  const startRow = piece.color === 'white' ? 6 : 1

  // One square forward
  const nextRow = row + direction
  if (isValidPosition(nextRow, col) && !getPieceAt(board, nextRow, col)) {
    moves.push({ row: nextRow, col })

    // Two squares forward on first move
    if (row === startRow) {
      const twoSquaresRow = row + 2 * direction
      if (!getPieceAt(board, twoSquaresRow, col)) {
        moves.push({ row: twoSquaresRow, col })
      }
    }
  }

  // Captures diagonally
  const capturePositions = [
    { row: nextRow, col: col - 1 },
    { row: nextRow, col: col + 1 },
  ]

  capturePositions.forEach(({ row: captureRow, col: captureCol }) => {
    if (isValidPosition(captureRow, captureCol)) {
      const targetPiece = getPieceAt(board, captureRow, captureCol)
      if (targetPiece && targetPiece.color !== piece.color) {
        moves.push({ row: captureRow, col: captureCol })
      }
    }
  })

  return moves
}

function getRookMoves(board: SquareContent[][], row: number, col: number, piece: Piece): BoardPosition[] {
  const moves: BoardPosition[] = []
  const directions = [
    { dRow: -1, dCol: 0 }, // up
    { dRow: 1, dCol: 0 },  // down
    { dRow: 0, dCol: -1 }, // left
    { dRow: 0, dCol: 1 },  // right
  ]

  directions.forEach(({ dRow, dCol }) => {
    let newRow = row + dRow
    let newCol = col + dCol

    while (isValidPosition(newRow, newCol)) {
      const target = getPieceAt(board, newRow, newCol)
      if (!target) {
        moves.push({ row: newRow, col: newCol })
      } else {
        if (target.color !== piece.color) {
          moves.push({ row: newRow, col: newCol })
        }
        break
      }
      newRow += dRow
      newCol += dCol
    }
  })

  return moves
}

function getKnightMoves(board: SquareContent[][], row: number, col: number, piece: Piece): BoardPosition[] {
  const moves: BoardPosition[] = []
  const knightMoves = [
    { dRow: -2, dCol: -1 },
    { dRow: -2, dCol: 1 },
    { dRow: -1, dCol: -2 },
    { dRow: -1, dCol: 2 },
    { dRow: 1, dCol: -2 },
    { dRow: 1, dCol: 2 },
    { dRow: 2, dCol: -1 },
    { dRow: 2, dCol: 1 },
  ]

  knightMoves.forEach(({ dRow, dCol }) => {
    const newRow = row + dRow
    const newCol = col + dCol

    if (isValidPosition(newRow, newCol)) {
      const target = getPieceAt(board, newRow, newCol)
      if (!target || target.color !== piece.color) {
        moves.push({ row: newRow, col: newCol })
      }
    }
  })

  return moves
}

function getBishopMoves(board: SquareContent[][], row: number, col: number, piece: Piece): BoardPosition[] {
  const moves: BoardPosition[] = []
  const directions = [
    { dRow: -1, dCol: -1 },
    { dRow: -1, dCol: 1 },
    { dRow: 1, dCol: -1 },
    { dRow: 1, dCol: 1 },
  ]

  directions.forEach(({ dRow, dCol }) => {
    let newRow = row + dRow
    let newCol = col + dCol

    while (isValidPosition(newRow, newCol)) {
      const target = getPieceAt(board, newRow, newCol)
      if (!target) {
        moves.push({ row: newRow, col: newCol })
      } else {
        if (target.color !== piece.color) {
          moves.push({ row: newRow, col: newCol })
        }
        break
      }
      newRow += dRow
      newCol += dCol
    }
  })

  return moves
}

function getQueenMoves(board: SquareContent[][], row: number, col: number, piece: Piece): BoardPosition[] {
  const rookMoves = getRookMoves(board, row, col, piece)
  const bishopMoves = getBishopMoves(board, row, col, piece)
  return [...rookMoves, ...bishopMoves]
}

function getKingMoves(board: SquareContent[][], row: number, col: number, piece: Piece): BoardPosition[] {
  const moves: BoardPosition[] = []
  const kingMoves = [
    { dRow: -1, dCol: -1 },
    { dRow: -1, dCol: 0 },
    { dRow: -1, dCol: 1 },
    { dRow: 0, dCol: -1 },
    { dRow: 0, dCol: 1 },
    { dRow: 1, dCol: -1 },
    { dRow: 1, dCol: 0 },
    { dRow: 1, dCol: 1 },
  ]

  kingMoves.forEach(({ dRow, dCol }) => {
    const newRow = row + dRow
    const newCol = col + dCol

    if (isValidPosition(newRow, newCol)) {
      const target = getPieceAt(board, newRow, newCol)
      if (!target || target.color !== piece.color) {
        moves.push({ row: newRow, col: newCol })
      }
    }
  })

  return moves
}

export function getLegalMoves(
  board: SquareContent[][],
  row: number,
  col: number
): BoardPosition[] {
  const piece = getPieceAt(board, row, col)
  if (!piece) return []

  let moves: BoardPosition[] = []

  switch (piece.type) {
    case 'P':
      moves = getPawnMoves(board, row, col, piece)
      break
    case 'R':
      moves = getRookMoves(board, row, col, piece)
      break
    case 'N':
      moves = getKnightMoves(board, row, col, piece)
      break
    case 'B':
      moves = getBishopMoves(board, row, col, piece)
      break
    case 'Q':
      moves = getQueenMoves(board, row, col, piece)
      break
    case 'K':
      moves = getKingMoves(board, row, col, piece)
      break
  }

  return moves
}

export function isLegalMove(
  board: SquareContent[][],
  from: BoardPosition,
  to: BoardPosition
): boolean {
  const legalMoves = getLegalMoves(board, from.row, from.col)
  return legalMoves.some((move) => move.row === to.row && move.col === to.col)
}

export function getPieceNotation(piece: Piece, from: BoardPosition, to: BoardPosition, isCapture: boolean): string {
  const colLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const rowLabels = ['1', '2', '3', '4', '5', '6', '7', '8']
  const toSquare = colLabels[to.col] + rowLabels[7 - to.row]

  if (piece.type === 'P') {
    if (isCapture) {
      return colLabels[from.col] + 'x' + toSquare
    }
    return toSquare
  }

  const pieceLetters: Record<string, string> = {
    N: 'N',
    B: 'B',
    R: 'R',
    Q: 'Q',
    K: 'K',
  }

  return (pieceLetters[piece.type] || '') + (isCapture ? 'x' : '') + toSquare
}

export function makeMove(
  gameState: GameState,
  from: BoardPosition,
  to: BoardPosition
): GameState | null {
  const piece = getPieceAt(gameState.board, from.row, from.col)

  // Validate move
  if (!piece || piece.color !== (gameState.whiteToMove ? 'white' : 'black')) {
    return null
  }

  if (!isLegalMove(gameState.board, from, to)) {
    return null
  }

  // Create new board with move applied
  const newBoard = gameState.board.map((row) => [...row])
  const capturedPiece = newBoard[to.row][to.col]

  newBoard[to.row][to.col] = piece
  newBoard[from.row][from.col] = null

  // Check for pawn promotion
  if (piece.type === 'P' && (to.row === 0 || to.row === 7)) {
    newBoard[to.row][to.col] = { ...piece, type: 'Q' }
  }

  // Create move record
  const isCapture = !!capturedPiece
  const notation = getPieceNotation(piece, from, to, isCapture)
  const newMove: Move = {
    from,
    to,
    notation,
    timestamp: Date.now(),
  }

  // Update captured pieces
  const newCapturedPieces = { ...gameState.capturedPieces }
  if (capturedPiece) {
    newCapturedPieces[capturedPiece.color].push(capturedPiece.type)
  }

  // Create new game state
  const newGameState: GameState = {
    board: newBoard,
    whiteToMove: !gameState.whiteToMove,
    moves: [...gameState.moves, newMove],
    status: 'playing',
    selectedSquare: null,
    lastMove: newMove,
    capturedPieces: newCapturedPieces,
  }

  return newGameState
}

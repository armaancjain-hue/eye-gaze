import { GameState } from './types'
import { boardToFen } from './fen'

/**
 * Client for the backend Stockfish endpoint.
 *
 * The endpoint URL and the request/response shapes are centralized here so that
 * matching them to the actual backend contract is a one-file change.
 *
 * Configure the URL via NEXT_PUBLIC_STOCKFISH_URL (defaults to the local
 * backend on :3000). Request payload sends the position as FEN plus difficulty
 * hints; the response parser is deliberately tolerant of field naming.
 */
const ENDPOINT =
  process.env.NEXT_PUBLIC_STOCKFISH_URL ?? 'http://localhost:3004/ai-move'

export interface EngineResult {
  /** Best move in UCI (e.g. "e2e4"). Empty string means no move (game over). */
  move: string
  /** Optional game status reported by the backend. */
  status?: GameState['status']
  /** Optional resulting FEN, if the backend echoes it. */
  fen?: string
}

interface DifficultyProfile {
  skillLevel: number // Stockfish "Skill Level" option, 0..20
  depth: number // search depth hint
}

function mapDifficulty(difficulty: string): DifficultyProfile {
  switch (difficulty.toLowerCase()) {
    case 'beginner':
      return { skillLevel: 1, depth: 5 }
    case 'advanced':
      return { skillLevel: 15, depth: 14 }
    case 'expert':
      return { skillLevel: 20, depth: 18 }
    case 'intermediate':
    default:
      return { skillLevel: 8, depth: 10 }
  }
}

/** Normalize whatever "move" field the backend uses into a clean UCI string. */
function extractMove(data: Record<string, unknown>): string | null {
  const raw =
    (data.bestmove as string) ??
    (data.move as string) ??
    (data.best_move as string) ??
    (data.uci as string)
  if (typeof raw !== 'string') return null
  // Tolerate a raw UCI line like "bestmove e2e4 ponder e7e5".
  const token = raw.replace(/^bestmove\s+/i, '').trim().split(/\s+/)[0]
  if (!token || token === '(none)') return ''
  return token
}

function extractStatus(data: Record<string, unknown>): GameState['status'] | undefined {
  // Backend signals a terminal position with gameOver + a mate score:
  // mate === 0 means the side to move is checkmated; otherwise it's a draw.
  if (data.gameOver === true) {
    return data.mate === 0 ? 'checkmate' : 'stalemate'
  }
  const valid: GameState['status'][] = [
    'playing',
    'white_check',
    'black_check',
    'checkmate',
    'stalemate',
  ]
  const s = data.status as GameState['status']
  if (valid.includes(s)) return s
  if (data.checkmate === true) return 'checkmate'
  if (data.stalemate === true || data.draw === true) return 'stalemate'
  return undefined
}

/**
 * Ask the backend for the engine's move in the current position.
 * Returns null on network/parse failure so the caller can degrade gracefully.
 */
export async function getBestMove(
  gameState: GameState,
  difficulty: string,
): Promise<EngineResult | null> {
  const fen = boardToFen(gameState)
  const { skillLevel, depth } = mapDifficulty(difficulty)

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, difficulty, skillLevel, depth }),
    })
  } catch (err) {
    console.error('[stockfish] request failed:', err)
    return null
  }

  if (!res.ok) {
    console.error('[stockfish] backend returned', res.status)
    return null
  }

  let data: Record<string, unknown>
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    console.error('[stockfish] response was not JSON')
    return null
  }

  const move = extractMove(data)
  if (move === null) {
    console.error('[stockfish] no move field in response', data)
    return null
  }

  return {
    move,
    status: extractStatus(data),
    fen: typeof data.fen === 'string' ? data.fen : undefined,
  }
}

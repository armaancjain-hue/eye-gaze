import { NextResponse } from 'next/server'
import { analyze } from '@/lib/server/stockfish'
import { readJsonBody } from '@/lib/server/validation'

/**
 * POST /api/ai-move — ask Stockfish for the best move in a position.
 *
 * Body: { fen, skillLevel?, depth? }
 *   fen        full FEN of the current position (required)
 *   skillLevel 0..20 difficulty knob (default 8)
 *   depth      search depth hint (default 12, clamped by the engine)
 */

// The WASM engine needs the Node runtime; it cannot run on the Edge runtime.
export const runtime = 'nodejs'
// A cold start loads ~7MB of WASM before the first search. The engine's own
// movetime bound keeps the search itself well short of this ceiling.
export const maxDuration = 60
// The reply depends entirely on the posted position, so there is nothing to cache.
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  const fen = body?.fen

  if (typeof fen !== 'string' || fen.trim() === '') {
    return NextResponse.json(
      { success: false, msg: 'A FEN string for the current position is required' },
      { status: 400 },
    )
  }

  const depth = Number(body?.depth) || 12
  const skillLevel = body?.skillLevel === undefined ? 8 : Number(body.skillLevel)

  try {
    const result = await analyze(fen, skillLevel, depth)
    return NextResponse.json({
      success: true,
      bestmove: result.bestmove, // UCI, "" if the position is terminal
      ponder: result.ponder,
      evaluation: result.evaluation,
      mate: result.mate,
      gameOver: result.bestmove === '',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ai-move] engine failed:', message)
    return NextResponse.json(
      { success: false, msg: 'Engine failed to produce a move' },
      { status: 500 },
    )
  }
}

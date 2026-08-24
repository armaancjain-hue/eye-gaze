import initEngine from 'stockfish'

/**
 * Stockfish (bundled WASM via the `stockfish` npm package), running inside the
 * Next.js server rather than a separate service.
 *
 * Two things matter in a serverless context that did not on a long-lived server:
 *
 *  - The engine is cached at module scope. A warm container reuses it across
 *    invocations; a cold one pays the ~7MB WASM load once. Rebuilding it per
 *    request would make every move take seconds.
 *  - Every search is bounded by wall-clock time as well as depth. Depth alone is
 *    unbounded in practice — a tactical middlegame at depth 14 can take an order
 *    of magnitude longer than a quiet one — and overrunning the function's time
 *    limit fails the request outright rather than returning a weaker move.
 *
 * A single WASM engine can only search one position at a time, so concurrent
 * requests to the same warm container are serialized through a promise chain.
 */

interface StockfishEngine {
  listener: ((line: string) => void) | null
  sendCommand: (cmd: string) => void
}

export interface EngineResult {
  /** Best move in UCI (e.g. "e2e4"); empty string if the position is terminal. */
  bestmove: string
  ponder: string | null
  /** Evaluation in pawns from the side-to-move's perspective, or null. */
  evaluation: number | null
  /** Moves-to-mate (positive = side to move mates), or null. */
  mate: number | null
}

/** Hard ceiling on a single search. Comfortably inside the route's maxDuration. */
const MAX_MOVETIME_MS = 4000
/** Give up entirely past this — the engine is wedged, not merely slow. */
const HARD_TIMEOUT_MS = 20000
/** Depth ceiling. Beyond this the movetime bound is what stops the search anyway. */
const MAX_DEPTH = 15

let enginePromise: Promise<StockfishEngine> | null = null

/** UCI handshake: uci -> uciok, isready -> readyok. */
function handshake(engine: StockfishEngine): Promise<void> {
  return new Promise((resolve) => {
    engine.listener = (line: string) => {
      if (line === 'uciok') {
        engine.sendCommand('isready')
      } else if (line === 'readyok') {
        engine.listener = null
        resolve()
      }
    }
    engine.sendCommand('uci')
  })
}

function loadEngine(): Promise<StockfishEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      // "lite-single" is the single-threaded 7MB build: it needs no workers or
      // SharedArrayBuffer, and it is the only flavour small enough to fit inside
      // a serverless function's size limit (the full build's WASM is ~113MB).
      const engine = await initEngine('lite-single')
      await handshake(engine)
      return engine
    })()
    // A failed load must not be cached forever, or every later request inherits
    // the same rejected promise and the route never recovers.
    enginePromise.catch(() => {
      enginePromise = null
    })
  }
  return enginePromise
}

// Serialize analysis requests so they never interleave on the single engine.
let chain: Promise<unknown> = Promise.resolve()

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(n)))

/**
 * Analyze a FEN and return the engine's chosen move.
 *
 * @param fen        full FEN string
 * @param skillLevel Stockfish "Skill Level" (0..20); the difficulty knob
 * @param depth      search depth, clamped for responsiveness
 * @param movetimeMs wall-clock bound on the search
 */
export function analyze(
  fen: string,
  skillLevel: number,
  depth: number,
  movetimeMs = MAX_MOVETIME_MS,
): Promise<EngineResult> {
  const run = async (): Promise<EngineResult> => {
    const engine = await loadEngine()

    return new Promise<EngineResult>((resolve, reject) => {
      let evaluation: number | null = null
      let mate: number | null = null

      const timeout = setTimeout(() => {
        engine.listener = null
        reject(new Error('Stockfish timed out'))
      }, HARD_TIMEOUT_MS)

      engine.listener = (line: string) => {
        if (line.startsWith('info')) {
          const score = line.match(/score (cp|mate) (-?\d+)/)
          if (score) {
            const kind = score[1]
            const value = score[2]
            if (kind === 'cp' && value !== undefined) {
              evaluation = Number(value) / 100
              mate = null
            } else if (kind === 'mate' && value !== undefined) {
              mate = Number(value)
              evaluation = null
            }
          }
        } else if (line.startsWith('bestmove')) {
          clearTimeout(timeout)
          engine.listener = null
          const parts = line.split(/\s+/)
          const move = parts[1]
          const bestmove = move && move !== '(none)' ? move : ''
          const ponderIdx = parts.indexOf('ponder')
          const ponder = ponderIdx >= 0 ? (parts[ponderIdx + 1] ?? null) : null
          resolve({ bestmove, ponder, evaluation, mate })
        }
      }

      engine.sendCommand(`setoption name Skill Level value ${clamp(skillLevel, 0, 20)}`)
      engine.sendCommand(`position fen ${fen}`)
      // Whichever bound is reached first ends the search.
      engine.sendCommand(
        `go depth ${clamp(depth, 1, MAX_DEPTH)} movetime ${clamp(movetimeMs, 50, MAX_MOVETIME_MS)}`,
      )
    })
  }

  // Append to the chain; run regardless of whether the previous request failed.
  const result = chain.then(run, run)
  chain = result.catch(() => {})
  return result
}

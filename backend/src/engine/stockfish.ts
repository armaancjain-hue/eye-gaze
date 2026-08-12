import initEngine from 'stockfish'

/**
 * Local Stockfish engine (bundled WASM via the `stockfish` npm package).
 *
 * The engine is loaded once and reused. A single WASM engine can only search
 * one position at a time, so requests are serialized through a promise chain.
 * We use the "lite-single" (single-threaded) flavor, which runs cleanly under
 * Node without workers / SharedArrayBuffer.
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
      const engine = await initEngine('lite-single')
      await handshake(engine)
      return engine
    })()
  }
  return enginePromise
}

// Serialize analysis requests so they never interleave on the single engine.
let chain: Promise<unknown> = Promise.resolve()

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(n)))

/**
 * Analyze a FEN and return the engine's chosen move.
 * @param fen        full FEN string
 * @param skillLevel Stockfish "Skill Level" (0..20); the difficulty knob
 * @param depth      search depth (clamped to a sane range for responsiveness)
 */
export function analyze(fen: string, skillLevel: number, depth: number): Promise<EngineResult> {
  const run = async (): Promise<EngineResult> => {
    const engine = await loadEngine()

    return new Promise<EngineResult>((resolve, reject) => {
      let evaluation: number | null = null
      let mate: number | null = null

      const timeout = setTimeout(() => {
        engine.listener = null
        reject(new Error('Stockfish timed out'))
      }, 20000)

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
          const ponder = ponderIdx >= 0 ? parts[ponderIdx + 1] ?? null : null
          resolve({ bestmove, ponder, evaluation, mate })
        }
      }

      engine.sendCommand(`setoption name Skill Level value ${clamp(skillLevel, 0, 20)}`)
      engine.sendCommand(`position fen ${fen}`)
      engine.sendCommand(`go depth ${clamp(depth, 1, 15)}`)
    })
  }

  // Append to the chain; run regardless of whether the previous request failed.
  const result = chain.then(run, run)
  chain = result.catch(() => {})
  return result
}

import initEngine from 'stockfish';
let enginePromise = null;
/** UCI handshake: uci -> uciok, isready -> readyok. */
function handshake(engine) {
    return new Promise((resolve) => {
        engine.listener = (line) => {
            if (line === 'uciok') {
                engine.sendCommand('isready');
            }
            else if (line === 'readyok') {
                engine.listener = null;
                resolve();
            }
        };
        engine.sendCommand('uci');
    });
}
function loadEngine() {
    if (!enginePromise) {
        enginePromise = (async () => {
            const engine = await initEngine('lite-single');
            await handshake(engine);
            return engine;
        })();
    }
    return enginePromise;
}
// Serialize analysis requests so they never interleave on the single engine.
let chain = Promise.resolve();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
/**
 * Analyze a FEN and return the engine's chosen move.
 * @param fen        full FEN string
 * @param skillLevel Stockfish "Skill Level" (0..20); the difficulty knob
 * @param depth      search depth (clamped to a sane range for responsiveness)
 */
export function analyze(fen, skillLevel, depth) {
    const run = async () => {
        const engine = await loadEngine();
        return new Promise((resolve, reject) => {
            let evaluation = null;
            let mate = null;
            const timeout = setTimeout(() => {
                engine.listener = null;
                reject(new Error('Stockfish timed out'));
            }, 20000);
            engine.listener = (line) => {
                if (line.startsWith('info')) {
                    const score = line.match(/score (cp|mate) (-?\d+)/);
                    if (score) {
                        const kind = score[1];
                        const value = score[2];
                        if (kind === 'cp' && value !== undefined) {
                            evaluation = Number(value) / 100;
                            mate = null;
                        }
                        else if (kind === 'mate' && value !== undefined) {
                            mate = Number(value);
                            evaluation = null;
                        }
                    }
                }
                else if (line.startsWith('bestmove')) {
                    clearTimeout(timeout);
                    engine.listener = null;
                    const parts = line.split(/\s+/);
                    const move = parts[1];
                    const bestmove = move && move !== '(none)' ? move : '';
                    const ponderIdx = parts.indexOf('ponder');
                    const ponder = ponderIdx >= 0 ? parts[ponderIdx + 1] ?? null : null;
                    resolve({ bestmove, ponder, evaluation, mate });
                }
            };
            engine.sendCommand(`setoption name Skill Level value ${clamp(skillLevel, 0, 20)}`);
            engine.sendCommand(`position fen ${fen}`);
            engine.sendCommand(`go depth ${clamp(depth, 1, 15)}`);
        });
    };
    // Append to the chain; run regardless of whether the previous request failed.
    const result = chain.then(run, run);
    chain = result.catch(() => { });
    return result;
}
//# sourceMappingURL=stockfish.js.map
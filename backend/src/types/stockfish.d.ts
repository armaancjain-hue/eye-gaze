// The `stockfish` npm package ships no TypeScript types. It exports a single
// initializer (CommonJS `module.exports = initEngine`) that resolves to an
// Emscripten engine object. We only use `listener` (output) and `sendCommand`.
declare module 'stockfish' {
  interface StockfishEngine {
    /** Called with each UCI output line. Set to null to detach. */
    listener: ((line: string) => void) | null
    /** Send a UCI command to the engine. */
    sendCommand: (cmd: string) => void
  }

  /**
   * @param enginePath optional engine flavor keyword
   *   ("full" | "lite" | "single" | "lite-single" | "asm") or a path.
   */
  function initEngine(enginePath?: string): Promise<StockfishEngine>

  export default initEngine
}

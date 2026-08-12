export interface EngineResult {
    /** Best move in UCI (e.g. "e2e4"); empty string if the position is terminal. */
    bestmove: string;
    ponder: string | null;
    /** Evaluation in pawns from the side-to-move's perspective, or null. */
    evaluation: number | null;
    /** Moves-to-mate (positive = side to move mates), or null. */
    mate: number | null;
}
/**
 * Analyze a FEN and return the engine's chosen move.
 * @param fen        full FEN string
 * @param skillLevel Stockfish "Skill Level" (0..20); the difficulty knob
 * @param depth      search depth (clamped to a sane range for responsiveness)
 */
export declare function analyze(fen: string, skillLevel: number, depth: number): Promise<EngineResult>;
//# sourceMappingURL=stockfish.d.ts.map
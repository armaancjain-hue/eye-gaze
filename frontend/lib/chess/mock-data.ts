import { createGame } from './engine'
import type { GameState } from './types'

/**
 * A fresh game. Note this used to seed the move history with three invented
 * moves (e4, e5, Nf3) while the board sat in its *starting* position — so a new
 * game opened showing moves that had not been played, and the FEN derived from
 * the move count told the engine it was already move two.
 */
export const createInitialGameState = (): GameState => createGame()

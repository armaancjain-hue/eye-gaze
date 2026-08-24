/**
 * Rules verification for the chess.js-backed engine.
 *
 * Run with `npm run verify:chess`. These cover the cases the previous
 * hand-written move generator got wrong — castling, en passant, pins, and
 * terminal detection — so a future change to the engine layer cannot quietly
 * reintroduce them.
 */
import { createGame, getLegalMoves, makeMove, toPosition } from '@/lib/chess/engine'
import { applyUciMove } from '@/lib/chess/apply-move'
import { boardToFen } from '@/lib/chess/fen'
import type { GameState } from '@/lib/chess/types'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail && !ok ? '  -> ' + detail : ''}`)
}
const sq = (s: string) => toPosition(s)
const at = (g: GameState, s: string) => {
  const p = sq(s); const piece = g.board[p.row][p.col]
  return piece ? `${piece.color[0]}${piece.type}` : '--'
}
const play = (g: GameState, from: string, to: string) => makeMove(g, sq(from), sq(to))

console.log('\n--- castling (was entirely absent before) ---')
{
  // Italian-ish opening, kingside castling available for White.
  let g = createGame()
  for (const [f, t] of [['e2','e4'],['e7','e5'],['g1','f3'],['b8','c6'],['f1','c4'],['g8','f6']]) {
    g = play(g, f, t)!
  }
  const kingMoves = getLegalMoves(g, sq('e1').row, sq('e1').col).map(p => `${'abcdefgh'[p.col]}${8-p.row}`)
  check('king is offered g1 as a castling destination', kingMoves.includes('g1'), kingMoves.join(','))
  const castled = play(g, 'e1', 'g1')
  check('castling move is accepted', !!castled)
  check('king ends on g1', at(castled!, 'g1') === 'wK', at(castled!, 'g1'))
  check('rook jumped h1 -> f1', at(castled!, 'f1') === 'wR' && at(castled!, 'h1') === '--',
        `f1=${at(castled!,'f1')} h1=${at(castled!,'h1')}`)
  check('notation is O-O', castled!.lastMove?.notation === 'O-O', castled!.lastMove?.notation)
}

console.log('\n--- castling rights are lost once the king moves ---')
{
  let g = createGame()
  for (const [f,t] of [['e2','e4'],['e7','e5'],['g1','f3'],['b8','c6'],['f1','c4'],['g8','f6'],
                       ['e1','f1'],['f8','c5'],['f1','e1'],['d7','d6']]) g = play(g,f,t)!
  const kingMoves = getLegalMoves(g, sq('e1').row, sq('e1').col).map(p => `${'abcdefgh'[p.col]}${8-p.row}`)
  check('king that moved and returned may NOT castle', !kingMoves.includes('g1'), kingMoves.join(','))
}

console.log('\n--- en passant ---')
{
  let g = createGame()
  for (const [f,t] of [['e2','e4'],['a7','a6'],['e4','e5'],['d7','d5']]) g = play(g,f,t)!
  const pawnMoves = getLegalMoves(g, sq('e5').row, sq('e5').col).map(p => `${'abcdefgh'[p.col]}${8-p.row}`)
  check('e5 pawn is offered the d6 en-passant capture', pawnMoves.includes('d6'), pawnMoves.join(','))
  const ep = play(g, 'e5', 'd6')
  check('en passant accepted', !!ep)
  check('captured pawn removed from d5', !!ep && at(ep, 'd5') === '--', ep ? at(ep, 'd5') : 'n/a')
  check('capture recorded', ep!.capturedPieces.black.includes('P'), JSON.stringify(ep!.capturedPieces))
}

console.log('\n--- illegal moves are refused (pins / leaving king in check) ---')
{
  // Black king e8, black knight e7, white ROOK on e1 -> the knight is pinned
  // along the e-file. (An earlier version of this test put the rook on g1,
  // where it pins nothing at all.)
  const g: GameState = { ...createGame(), fen: '4k3/4n3/8/8/8/8/8/4R2K b - - 0 1' }
  const loaded = applyUciMove(g, 'e8f8')
  check('a legal king move is accepted', !!loaded)
  const pinned = makeMove({ ...g }, sq('e7'), sq('c6'))
  check('pinned knight cannot move (would expose king)', pinned === null,
        pinned ? 'move was allowed!' : '')
  const moves = getLegalMoves({ ...g }, sq('e7').row, sq('e7').col)
  check('pinned knight reports zero legal moves', moves.length === 0, `got ${moves.length}`)
}

console.log('\n--- terminal detection ---')
{
  // Fool's mate position, white just got mated.
  const mate: GameState = { ...createGame(), fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' }
  const after = makeMove(mate, sq('a2'), sq('a3'))
  check('no legal move exists in a mated position', after === null)
  const g2 = applyUciMove({ ...createGame(), fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2' }, 'd8h4')
  check('checkmate detected', g2?.status === 'checkmate', g2?.status)

  // Qf7 leaves h8 unattacked but takes every escape square: stalemate.
  const stale = applyUciMove({ ...createGame(), fen: '7k/8/5Q2/8/8/8/8/7K w - - 0 1' }, 'f6f7')
  check('stalemate detected', stale?.status === 'stalemate', stale?.status)

  const ongoing = applyUciMove(createGame(), 'e2e4')
  check('ongoing game not misreported as draw', ongoing?.status === 'playing', ongoing?.status)
}

console.log('\n--- promotion ---')
{
  const g = applyUciMove({ ...createGame(), fen: '8/P6k/8/8/8/8/8/7K w - - 0 1' }, 'a7a8q')
  check('pawn promotes to queen', g !== null && at(g, 'a8') === 'wQ', g ? at(g,'a8') : 'null')
  check('promotion notation includes =Q', !!g?.lastMove?.notation.includes('=Q'), g?.lastMove?.notation)
}

console.log('\n--- FEN sent to Stockfish ---')
{
  let g = createGame()
  check('new game FEN is the start position', boardToFen(g).startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq'), boardToFen(g))
  check('new game has empty move history', g.moves.length === 0, `${g.moves.length} phantom moves`)
  g = play(g, 'e2', 'e4')!
  check('no en-passant target when no capture is available (modern FEN standard)',
        boardToFen(g).split(' ')[3] === '-', boardToFen(g))
  g = play(g, 'e7', 'e5')!
  check('fullmove counter advances correctly', boardToFen(g).split(' ')[5] === '2', boardToFen(g))
  check('halfmove clock is tracked, not hardcoded 0', boardToFen(g).split(' ')[4] === '0', boardToFen(g))
  const g3 = play(play(g, 'g1', 'f3')!, 'b8', 'c6')!
  check('halfmove clock counts non-pawn moves', boardToFen(g3).split(' ')[4] === '2', boardToFen(g3))
}

console.log('\n--- en-passant target IS emitted when the capture is real ---')
{
  let g = createGame()
  for (const [f,t] of [['e2','e4'],['a7','a6'],['e4','e5'],['d7','d5']]) g = play(g,f,t)!
  check('FEN carries the d6 target', boardToFen(g).split(' ')[3] === 'd6', boardToFen(g))
}

console.log('\n--- SAN notation quality ---')
{
  let g = createGame()
  for (const [f,t] of [['e2','e4'],['d7','d5']]) g = play(g,f,t)!
  const cap = play(g, 'e4', 'd5')!
  check('pawn capture is "exd5"', cap.lastMove?.notation === 'exd5', cap.lastMove?.notation)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

/**
 * Board-orientation verification. Run with `npm run verify:board`.
 *
 * Flipping the board moves pixels but must not move the position, and the gaze
 * mapping has to follow it — a screen point resolves to a different square in
 * each orientation, and the sub-square offset that feeds the confidence score
 * must be measured in drawing space.
 */
/** The flip must move pixels, not the position — and gaze must follow it. */
import { pointToSquare, squareCenter, toAlgebraic, type BoardGeometry } from '@/lib/eye-tracking/board-mapping'
import { toLogical, toVisual } from '@/lib/chess/orientation'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { ok ? pass++ : fail++; console.log(`${ok?'  ok  ':' FAIL '} ${n}${!ok&&d?'  -> '+d:''}`) }

const geom = (orientation: 'white-top' | 'white-bottom'): BoardGeometry =>
  ({ left: 100, top: 50, width: 800, height: 800, squareSize: 100, orientation })

console.log('\n--- flip is a true 180 degree rotation (an involution) ---')
for (const o of ['white-top', 'white-bottom'] as const) {
  let ok = true
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const there = toVisual({ row: r, col: c }, o)
    const back = toLogical(there, o)
    if (back.row !== r || back.col !== c) ok = false
  }
  check(`${o}: logical -> visual -> logical round-trips`, ok)
}

console.log('\n--- white at top puts the player\'s own back rank on top ---')
{
  const g = geom('white-top')
  // Logical row 7 = rank 1 = white's back rank. Where is it drawn?
  const e1 = toVisual({ row: 7, col: 4 }, 'white-top')
  check('white back rank (rank 1) is drawn on the top row', e1.row === 0, `drawn at row ${e1.row}`)
  const e8 = toVisual({ row: 0, col: 4 }, 'white-top')
  check('black back rank (rank 8) is drawn on the bottom row', e8.row === 7, `drawn at row ${e8.row}`)
  // Files mirror too, or the king and queen would swap sides.
  check('files mirror as well (d-file lands right of e-file)',
        toVisual({row:7,col:3},'white-top').col > toVisual({row:7,col:4},'white-top').col)
}

console.log('\n--- a screen point resolves to the correct square in each orientation ---')
{
  // Top-left corner of the drawn board.
  const topLeft = { x: 150, y: 100 }
  const std = pointToSquare(topLeft.x, topLeft.y, geom('white-bottom'))!
  const flip = pointToSquare(topLeft.x, topLeft.y, geom('white-top'))!
  check('white-bottom: top-left cell is a8', toAlgebraic(std.square) === 'a8', toAlgebraic(std.square))
  check('white-top: the same pixel is h1', toAlgebraic(flip.square) === 'h1', toAlgebraic(flip.square))
}

console.log('\n--- squareCenter and pointToSquare are inverses, both ways round ---')
for (const o of ['white-top', 'white-bottom'] as const) {
  const g = geom(o)
  let ok = true, bad = ''
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const centre = squareCenter(g, r, c)
    const hit = pointToSquare(centre.x, centre.y, g)
    if (!hit || hit.square.row !== r || hit.square.col !== c) {
      ok = false; bad = `${toAlgebraic({row:r,col:c})} -> ${hit ? toAlgebraic(hit.square) : 'null'}`
    }
    // The sub-square offset must be measured against the DRAWN cell, or
    // confidence collapses when flipped.
    if (hit && hit.centerDistance > 1e-6) { ok = false; bad = `centre of ${toAlgebraic({row:r,col:c})} reported offset ${hit.centerDistance.toFixed(3)}` }
  }
  check(`${o}: every square centre maps back to itself, offset 0`, ok, bad)
}

console.log('\n--- the drawn cell reported alongside the square is consistent ---')
{
  const g = geom('white-top')
  const centre = squareCenter(g, 7, 4) // e1
  const hit = pointToSquare(centre.x, centre.y, g)!
  check('cell matches toVisual(square)',
        hit.cell.row === toVisual(hit.square, 'white-top').row &&
        hit.cell.col === toVisual(hit.square, 'white-top').col,
        JSON.stringify(hit.cell))
  check('e1 is drawn in the top row when white is on top', hit.cell.row === 0, `row ${hit.cell.row}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

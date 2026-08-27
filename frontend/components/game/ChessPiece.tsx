'use client'

import type { PieceColor, PieceType } from '@/lib/chess/types'

/**
 * Vector piece set.
 *
 * The board used to draw both sides with the same Unicode glyph and separate
 * them by fill colour alone. At board sizes that fit on a laptop that reads as
 * "one dark blob, one light blob" — fine for telling sides apart, useless for
 * telling a bishop from a pawn at a glance, which is exactly the read a gaze
 * player needs before they commit a 1.5s dwell.
 *
 * These are drawn instead: a single silhouette per piece, filled in the side's
 * colour and outlined in the opposite one, so White stays legible on the light
 * squares and Black on the dark ones. Every path lives in the same 45x45 box
 * with a shared foot, so the pieces line up and share a visual weight.
 */

const VIEW_BOX = '0 0 45 45'

/**
 * Foot and plinth, shared by every piece so they all sit on the same line.
 *
 * Two separate closed subpaths rather than one outline: a single path that
 * doubles back on itself gets filled by the even-odd/non-zero rules into
 * stripes, which is exactly what the first version of this drew.
 */
const BASE =
  'M 13 32.5 L 32 32.5 L 35.5 37.5 L 36.5 37.5 L 36.5 41 L 8.5 41 L 8.5 37.5 L 9.5 37.5 Z'

/** A stem tapering from a collar down into the skirt. */
const STEM = 'M 16.5 27.5 L 14.5 32.5 L 30.5 32.5 L 28.5 27.5 Z'

interface PieceGeometry {
  /** Filled outlines, drawn in the piece colour. */
  shapes: string[]
  /** Detail strokes drawn in the outline colour only (eyes, mitre slit, bands). */
  details?: string[]
  /** Round accents (finials, crown jewels) as [cx, cy, r]. */
  dots?: [number, number, number][]
}

const GEOMETRY: Record<PieceType, PieceGeometry> = {
  P: {
    shapes: [
      'M 22.5 8 C 19 8 16.2 10.8 16.2 14.2 C 16.2 15.9 16.9 17.4 18 18.5 C 15.5 20.1 14 22.8 14 26 L 14 27.8 L 31 27.8 L 31 26 C 31 22.8 29.5 20.1 27 18.5 C 28.1 17.4 28.8 15.9 28.8 14.2 C 28.8 10.8 26 8 22.5 8 Z',
      STEM,
      BASE,
    ],
  },

  R: {
    shapes: [
      'M 10 10.5 L 14.6 10.5 L 14.6 14 L 19 14 L 19 10.5 L 26 10.5 L 26 14 L 30.4 14 L 30.4 10.5 L 35 10.5 L 35 19.5 L 31.5 22.5 L 31.5 27.8 L 13.5 27.8 L 13.5 22.5 L 10 19.5 Z',
      'M 12 27.8 L 33 27.8 L 33 32.5 L 12 32.5 Z',
      BASE,
    ],
    details: ['M 13.5 22.5 L 31.5 22.5'],
  },

  N: {
    shapes: [
      'M 24 8 C 20.4 8 17.6 9.6 15.5 12.8 L 10.6 18.8 C 8.4 21.6 8 24.4 10.2 25.6 C 11.6 26.3 13.2 25.8 14.6 24.8 C 14.8 27.6 14 30.2 12.6 32.5 L 33.5 32.5 C 35.4 23.6 34.7 15.6 30.8 10.8 C 29 8.6 26.6 8 24 8 Z',
      'M 23.4 8.4 L 25.6 2.6 L 30 9.4 Z',
      BASE,
    ],
    details: ['M 12.6 21.8 L 15.4 20.6'],
    dots: [[16.6, 16.4, 1.35]],
  },

  B: {
    shapes: [
      'M 22.5 9 C 18.6 12.6 15 18 15 21.8 C 15 22.8 15.4 23.4 16 23.8 L 29 23.8 C 29.6 23.4 30 22.8 30 21.8 C 30 18 26.4 12.6 22.5 9 Z',
      'M 12.6 23.8 L 32.4 23.8 L 32.4 27.8 L 12.6 27.8 Z',
      STEM,
      BASE,
    ],
    details: ['M 22.5 12.5 L 22.5 20.5', 'M 18.6 17.6 L 26.4 17.6'],
    dots: [[22.5, 7.6, 2.2]],
  },

  Q: {
    shapes: [
      'M 8.5 13.5 L 12.5 27.8 L 32.5 27.8 L 36.5 13.5 L 29.5 20 L 26 10.5 L 22.5 19.5 L 19 10.5 L 15.5 20 Z',
      'M 11.8 27.8 L 33.2 27.8 L 33.2 32.5 L 11.8 32.5 Z',
      BASE,
    ],
    details: ['M 13.4 23 L 31.6 23'],
    dots: [
      [8.5, 11.6, 2.2],
      [15.5, 8.6, 2.2],
      [22.5, 7.2, 2.4],
      [29.5, 8.6, 2.2],
      [36.5, 11.6, 2.2],
    ],
  },

  K: {
    shapes: [
      'M 21.1 3 L 23.9 3 L 23.9 6 L 26.9 6 L 26.9 8.8 L 23.9 8.8 L 23.9 12.5 L 21.1 12.5 L 21.1 8.8 L 18.1 8.8 L 18.1 6 L 21.1 6 Z',
      'M 22.5 12 C 15.6 12 11.2 16.4 11.2 22 L 12.2 27.8 L 32.8 27.8 L 33.8 22 C 33.8 16.4 29.4 12 22.5 12 Z',
      'M 11.8 27.8 L 33.2 27.8 L 33.2 32.5 L 11.8 32.5 Z',
      BASE,
    ],
    details: ['M 15.8 22.6 C 18.6 19.6 26.4 19.6 29.2 22.6'],
  },
}

/**
 * Fill / outline pair per side, plus how heavy that outline is.
 *
 * The two stroke widths are not a stylistic whim. A light rim on a dark piece
 * reads as *lighter* the thicker it gets, and at the ~50px squares of a
 * windowed board a symmetric 1.4 rim was enough to make Black look like an
 * outlined White at a glance. Black therefore gets the thinner rim — just
 * enough to separate it from the dark squares — and White the heavier one,
 * which it can afford because its rim is dark.
 */
const PALETTE: Record<PieceColor, { fill: string; line: string; width: number }> = {
  white: { fill: '#f7f3e8', line: '#14161a', width: 1.5 },
  black: { fill: '#14161a', line: '#dcd8cc', width: 1.05 },
}

interface ChessPieceProps {
  type: PieceType
  color: PieceColor
  /** Extra classes for the svg element (sizing is normally done by the parent). */
  className?: string
}

export default function ChessPiece({ type, color, className }: ChessPieceProps) {
  const geometry = GEOMETRY[type]
  const { fill, line, width } = PALETTE[color]

  return (
    <svg
      viewBox={VIEW_BOX}
      className={className}
      aria-hidden
      focusable="false"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <g
        fill={fill}
        stroke={line}
        strokeWidth={width}
        strokeLinejoin="round"
        strokeLinecap="round"
        // A soft drop shadow lifts the piece off the square without the glow
        // that used to make Black read as a lit-up White.
        style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.55))' }}
      >
        {geometry.shapes.map((d, i) => (
          <path key={`s${i}`} d={d} />
        ))}
        {geometry.dots?.map(([cx, cy, r], i) => (
          <circle key={`c${i}`} cx={cx} cy={cy} r={r} />
        ))}
        {geometry.details?.map((d, i) => (
          <path key={`d${i}`} d={d} fill="none" stroke={line} strokeWidth={width} />
        ))}
      </g>
    </svg>
  )
}

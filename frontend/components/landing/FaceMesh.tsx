'use client'

/**
 * Stylised face-mesh portrait for the landing hero.
 *
 * Drawn rather than photographed on purpose: the hero needs to show *what the
 * tracker sees* — a landmark mesh over a face in profile, looking at the board
 * — and any stock photo would either misrepresent that or tie the page to a
 * particular person's likeness.
 */
export default function FaceMesh({ className }: { className?: string }) {
  // Contour lines running across the face, standing in for the landmark mesh.
  const contours = [
    'M 52 62 C 84 46 120 50 146 68',
    'M 46 88 C 82 74 122 78 152 94',
    'M 44 112 C 80 100 120 104 150 118',
    'M 48 136 C 82 126 116 128 140 140',
    'M 56 158 C 84 150 110 152 128 160',
  ]
  const verticals = [
    'M 66 42 C 58 84 58 132 70 176',
    'M 92 34 C 88 84 88 134 96 178',
    'M 118 36 C 118 86 116 134 120 170',
    'M 142 56 C 146 92 142 130 134 158',
  ]

  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden focusable="false">
      <defs>
        <radialGradient id="face-fill" cx="45%" cy="35%">
          <stop offset="0%" stopColor="#3b2a5c" />
          <stop offset="100%" stopColor="#16121f" />
        </radialGradient>
        <clipPath id="face-clip">
          <path d="M 62 34 C 96 16 138 30 150 64 L 154 80 L 168 106 L 152 114 L 155 128 L 139 136 C 142 154 130 166 111 170 L 102 186 L 52 186 C 34 142 32 66 62 34 Z" />
        </clipPath>
      </defs>

      {/* Head, in profile, facing right toward the board. */}
      <path
        d="M 62 34 C 96 16 138 30 150 64 L 154 80 L 168 106 L 152 114 L 155 128 L 139 136 C 142 154 130 166 111 170 L 102 186 L 52 186 C 34 142 32 66 62 34 Z"
        fill="url(#face-fill)"
        stroke="rgba(167,139,250,0.85)"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />

      <g clipPath="url(#face-clip)" stroke="rgba(167,139,250,0.35)" strokeWidth={0.9} fill="none">
        {contours.map((d) => (
          <path key={d} d={d} />
        ))}
        {verticals.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Eye — the landmark the whole product hangs on. */}
      <ellipse cx={132} cy={82} rx={9} ry={5.5} fill="#0d0b14" stroke="rgba(196,181,253,0.9)" strokeWidth={1.4} />
      <circle cx={135} cy={82} r={2.6} fill="#c4b5fd" />
      <path d="M 120 70 C 128 65 140 65 146 70" stroke="rgba(196,181,253,0.7)" strokeWidth={1.4} fill="none" />
    </svg>
  )
}

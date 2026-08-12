'use client'

import { motion } from 'framer-motion'
import { GazePoint } from '@/lib/eye-tracking/types'

interface GazeRingProps {
  gazePoint: GazePoint
}

export default function GazeRing({ gazePoint }: GazeRingProps) {
  // Scale gaze point from full screen to preview container
  // Assuming the preview is roughly 100% width of the container (280px at base)
  const previewWidth = 280
  const previewHeight = 160

  // Normalize gaze point to preview dimensions
  const normalizedX = (gazePoint.x / window.innerWidth) * previewWidth
  const normalizedY = (gazePoint.y / window.innerHeight) * previewHeight

  return (
    <>
      {/* Outer glow ring */}
      <motion.div
        className="absolute pointer-events-none"
        animate={{
          x: normalizedX - 20,
          y: normalizedY - 20,
        }}
        transition={{
          type: 'tween',
          ease: 'easeOut',
          duration: 0.1,
        }}
      >
        <motion.div
          animate={{
            boxShadow: `0 0 20px 8px rgba(168, 85, 247, ${gazePoint.confidence})`,
          }}
          className="w-10 h-10 rounded-full border-2 border-primary"
        />
      </motion.div>

      {/* Inner dot */}
      <motion.div
        className="absolute w-2 h-2 bg-accent rounded-full pointer-events-none"
        animate={{
          x: normalizedX - 4,
          y: normalizedY - 4,
        }}
        transition={{
          type: 'tween',
          ease: 'easeOut',
          duration: 0.1,
        }}
      />

      {/* Crosshair lines */}
      <motion.div
        className="absolute w-0.5 h-6 bg-gradient-to-b from-primary/60 to-transparent pointer-events-none"
        animate={{
          x: normalizedX,
          y: normalizedY - 8,
        }}
        transition={{
          type: 'tween',
          ease: 'easeOut',
          duration: 0.1,
        }}
      />
      <motion.div
        className="absolute w-6 h-0.5 bg-gradient-to-r from-primary/60 to-transparent pointer-events-none"
        animate={{
          x: normalizedX - 8,
          y: normalizedY,
        }}
        transition={{
          type: 'tween',
          ease: 'easeOut',
          duration: 0.1,
        }}
      />
    </>
  )
}

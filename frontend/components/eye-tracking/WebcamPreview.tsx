'use client'

import { forwardRef } from 'react'
import { VideoOff } from 'lucide-react'

interface WebcamPreviewProps {
  /** Whether the camera stream is live. */
  active: boolean
}

/**
 * Shows the live webcam feed. The video element is owned by the gaze-tracking
 * hook (which attaches the MediaStream); we just render it here, mirrored like
 * a selfie view so the player's movements feel natural.
 */
const WebcamPreview = forwardRef<HTMLVideoElement, WebcamPreviewProps>(
  function WebcamPreview({ active }, ref) {
    return (
      <div className="relative w-full h-40 bg-background overflow-hidden">
        <video
          ref={ref}
          autoPlay
          playsInline
          muted
          // Mirror horizontally for an intuitive selfie view.
          className="w-full h-full object-cover -scale-x-100"
        />

        {!active && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-background">
            <div className="text-center text-muted-foreground">
              <VideoOff className="w-6 h-6 mx-auto mb-1 opacity-60" />
              <p className="text-sm font-medium">Camera Off</p>
              <p className="text-xs mt-1">Enable camera to begin</p>
            </div>
          </div>
        )}
      </div>
    )
  },
)

export default WebcamPreview

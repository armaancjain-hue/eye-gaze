'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, FlipVertical2, AlertCircle } from 'lucide-react'
import Chessboard from '@/components/game/Chessboard'
import LeftSidebar from '@/components/layout/LeftSidebar'
import EyeTrackingPanel from '@/components/eye-tracking/EyeTrackingPanel'
import GazeCursor from '@/components/eye-tracking/GazeCursor'
import CalibrationOverlay from '@/components/eye-tracking/CalibrationOverlay'
import MoveHistoryPanel from '@/components/move-history/MoveHistoryPanel'
import TopNav from '@/components/layout/TopNav'
import AccessibilityMenu from '@/components/accessibility/AccessibilityMenu'
import { createInitialGameState } from '@/lib/chess/mock-data'
import { DEFAULT_ACCESSIBILITY_SETTINGS } from '@/lib/eye-tracking/mock-data'
import { GameState, BoardPosition, isGameOver } from '@/lib/chess/types'
import { AccessibilitySettings } from '@/lib/eye-tracking/types'
import { makeMove, getPieceAt } from '@/lib/chess/engine'
import { getBestMove } from '@/lib/chess/stockfish-api'
import { applyUciMove } from '@/lib/chess/apply-move'
import { useGazeTracking } from '@/lib/eye-tracking/useGazeTracking'
import { useGazeInteraction } from '@/lib/eye-tracking/useGazeInteraction'
import { toAlgebraic, getBoardGeometry, invalidateBoardGeometry } from '@/lib/eye-tracking/board-mapping'
import { DEFAULT_ORIENTATION, type BoardOrientation } from '@/lib/chess/orientation'

/**
 * Smallest square (CSS px) at which gaze selection is allowed. Gaze error is
 * roughly fixed in pixels, so below this the cursor deadband and landmark noise
 * start to span more than a square. Fullscreen on any normal display clears it
 * comfortably (~90-130px), which is exactly why gaze is gated to fullscreen.
 */
const MIN_GAZE_SQUARE_PX = 80

export default function GamePage() {
  const [gameState, setGameState] = useState<GameState>(createInitialGameState())
  const [timer, setTimer] = useState(600)
  const [difficulty, setDifficulty] = useState('Intermediate')
  const [engineThinking, setEngineThinking] = useState(false)
  const [accessibility, setAccessibility] = useState<AccessibilitySettings>(
    DEFAULT_ACCESSIBILITY_SETTINGS
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Collapsible side panels (lg and up); the board expands into the freed space.
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  /**
   * Eye control runs only in true fullscreen: it strips all chrome so the board
   * fills the screen (guaranteeing squares well above {@link MIN_GAZE_SQUARE_PX}),
   * and it is the deliberate "I'm playing with my eyes now" gesture. `focusMode`
   * tracks the fullscreen state so the existing chrome-hiding layout follows it.
   */
  const [isFullscreen, setIsFullscreen] = useState(false)
  const focusMode = isFullscreen
  const [showCalibration, setShowCalibration] = useState(false)
  /** Board square edge in px, polled while in gaze mode for the size gate. */
  const [squareSize, setSquareSize] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  /**
   * Which side is drawn at the top. Defaults to white — the player's own pieces
   * — because that is the half of the board they look at most to pick a piece,
   * and the upper half of the screen is where gaze tracking is most reliable.
   */
  const [orientation, setOrientation] = useState<BoardOrientation>(DEFAULT_ORIENTATION)

  // Human plays White; the backend Stockfish plays Black.
  const isHumanTurn =
    gameState.whiteToMove && !engineThinking && !isGameOver(gameState.status)

  // Real eye tracking — WebEyeTrack (webcam + BlazeGaze CNN in a worker).
  const gaze = useGazeTracking()

  const eyeTrackingState = {
    ...gaze.state,
    calibrationProgress: gaze.hasCalibration ? 100 : 0,
  }

  // --- Fullscreen eye-control lifecycle ---------------------------------------

  const enterEyeControl = useCallback(() => {
    const el = rootRef.current
    // requestFullscreen must run inside the user gesture, before any await.
    if (el && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {})
    }
    gaze.start()
    if (!gaze.hasCalibration) setShowCalibration(true)
  }, [gaze])

  const exitEyeControl = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])

  // Keep our flags in step with the browser's fullscreen state (Esc, F11, etc.).
  useEffect(() => {
    const onFs = () => {
      const fs = !!document.fullscreenElement && document.fullscreenElement === rootRef.current
      setIsFullscreen(fs)
      if (!fs) setShowCalibration(false)
      invalidateBoardGeometry()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Poll the board's square size while in gaze mode, for the size gate + nudge.
  useEffect(() => {
    if (!isFullscreen) {
      setSquareSize(0)
      return
    }
    const id = setInterval(() => {
      const g = getBoardGeometry()
      setSquareSize(g?.squareSize ?? 0)
    }, 300)
    return () => clearInterval(id)
  }, [isFullscreen])

  // F toggles fullscreen eye control, C recalibrates, V flips the board. Reaching
  // a button is exactly the interaction a gaze user finds hardest, so the view
  // controls stay keyboard-first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        if (document.fullscreenElement) exitEyeControl()
        else enterEyeControl()
      } else if (e.key === 'c' || e.key === 'C') {
        if (isFullscreen) {
          gaze.resetCalibration()
          setShowCalibration(true)
        }
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        setOrientation((o) => (o === 'white-top' ? 'white-bottom' : 'white-top'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enterEyeControl, exitEyeControl, isFullscreen, gaze])

  // Simulate timer countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Push the smoothing setting into the tracker whenever it changes.
  useEffect(() => {
    if (gaze.isReady) gaze.setSmoothing(accessibility.smoothing / 100)
  }, [gaze.isReady, accessibility.smoothing, gaze.setSmoothing])

  // When it becomes Black's turn, ask the backend Stockfish for its move.
  const requestedForMoveCount = useRef(-1)
  useEffect(() => {
    if (gameState.whiteToMove) return
    if (isGameOver(gameState.status)) return
    if (requestedForMoveCount.current === gameState.moves.length) return
    requestedForMoveCount.current = gameState.moves.length

    let cancelled = false
    setEngineThinking(true)

    getBestMove(gameState, difficulty)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setEngineThinking(false)
          return
        }
        setGameState((prev) => {
          if (!result.move) return prev
          return applyUciMove(prev, result.move) ?? prev
        })
        setEngineThinking(false)
      })
      .catch(() => {
        if (!cancelled) setEngineThinking(false)
      })

    return () => {
      cancelled = true
    }
  }, [gameState, difficulty])

  // Gaze dwell selects a piece; a deliberate blink confirms the move.
  const handleGazeDwell = (pos: BoardPosition) => {
    if (!isHumanTurn) return
    setGameState((prev) => {
      const piece = getPieceAt(prev.board, pos.row, pos.col)
      const myColor = prev.whiteToMove ? 'white' : 'black'

      if (prev.selectedSquare?.row === pos.row && prev.selectedSquare?.col === pos.col) {
        return { ...prev, selectedSquare: null }
      }
      if (piece && piece.color === myColor) {
        return { ...prev, selectedSquare: pos }
      }
      return prev
    })
  }

  const handleBlinkConfirm = (pos: BoardPosition | null) => {
    if (!pos || !isHumanTurn) return
    setGameState((prev) => {
      if (!prev.selectedSquare) return prev
      const next = makeMove(prev, prev.selectedSquare, pos)
      return next ?? prev
    })
  }

  // Gaze control requires: the tracker up, enough calibration collected, real
  // fullscreen, a board large enough for square-accurate gaze, and no calibration
  // overlay in progress. Any of these missing leaves the game mouse-only.
  const boardBigEnough = squareSize >= MIN_GAZE_SQUARE_PX
  const gazeControlReady =
    gaze.isReady && gaze.hasCalibration && isFullscreen && boardBigEnough && !showCalibration

  const { dwellSquare, dwellProgress, confidence: dwellConfidence } = useGazeInteraction({
    enabled: gazeControlReady && isHumanTurn,
    gazePoint: gaze.state.gazePoint,
    dwellTime: accessibility.dwellTime,
    calibrationScore: gaze.hasCalibration ? 0.85 : 0,
    registerBlink: gaze.onBlink,
    onDwell: handleGazeDwell,
    onBlinkConfirm: handleBlinkConfirm,
  })

  // Mouse fallback: click to select, click again to move. (Board clicks are also
  // look-aligned calibration for WebEyeTrack, so they keep refining the model.)
  const handleSquareClick = (row: number, col: number) => {
    if (!isHumanTurn) return
    setGameState((prev) => {
      const selectedSquare = prev.selectedSquare
      const clickedPiece = getPieceAt(prev.board, row, col)

      if (!selectedSquare) {
        if (clickedPiece && clickedPiece.color === (prev.whiteToMove ? 'white' : 'black')) {
          return { ...prev, selectedSquare: { row, col } }
        }
        return prev
      }

      if (selectedSquare.row === row && selectedSquare.col === col) {
        return { ...prev, selectedSquare: null }
      }

      if (clickedPiece && clickedPiece.color === (prev.whiteToMove ? 'white' : 'black')) {
        return { ...prev, selectedSquare: { row, col } }
      }

      const newGameState = makeMove(prev, selectedSquare, { row, col })
      if (newGameState) {
        return newGameState
      }

      return prev
    })
  }

  const handleNewGame = () => {
    setGameState(createInitialGameState())
    setTimer(600)
  }

  const handleRestartGame = () => {
    setGameState(createInitialGameState())
    setTimer(600)
  }

  const handleSettings = () => {
    setSettingsOpen(true)
  }

  return (
    <div
      ref={rootRef}
      className="min-h-screen lg:h-screen lg:overflow-hidden bg-background flex flex-col"
    >
      {/* Hidden webcam element WebEyeTrack drives by id. Always mounted while the
          page is (kept renderable, not display:none, so frame capture never
          breaks); shown as a small corner preview in gaze mode. */}
      <video
        ref={gaze.videoRef}
        id="webcam"
        autoPlay
        playsInline
        muted
        className={
          isFullscreen
            ? 'fixed bottom-3 left-3 z-[65] w-40 h-28 object-cover -scale-x-100 rounded-lg border border-border opacity-80 pointer-events-none'
            : 'fixed w-px h-px opacity-0 pointer-events-none -z-10'
        }
      />

      {/* Accessibility Settings Menu */}
      <AccessibilityMenu
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={accessibility}
        onSettingsChange={setAccessibility}
      />

      {/* Top Navigation — hidden in gaze/focus mode to hand its height to the board. */}
      {!focusMode && <TopNav />}

      {/* Full-screen gaze cursor. Only meaningful while gaze is actually driving,
          i.e. in fullscreen eye control. */}
      <GazeCursor
        gazePoint={gaze.state.gazePoint}
        active={isFullscreen && gaze.isReady && gaze.state.status === 'active'}
        dwellProgress={dwellProgress}
        dwelling={!!dwellSquare}
        largeCursor={accessibility.largeCursor}
        reducedMotion={accessibility.reducedMotion}
      />

      {/* Calibration overlay (only in gaze mode, until calibrated). */}
      {isFullscreen && showCalibration && (
        <CalibrationOverlay
          onNoteSample={gaze.noteCalibrationSample}
          onComplete={() => setShowCalibration(false)}
          onCancel={() => setShowCalibration(false)}
        />
      )}

      {/* "Board too small for gaze" nudge — rare, since fullscreen clears the bar. */}
      {isFullscreen && gaze.isReady && !showCalibration && !boardBigEnough && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[66] flex items-center gap-2 rounded-lg border border-yellow-400/40 bg-card/90 px-3 py-2 text-xs text-yellow-400 shadow-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Enlarge the window — squares must be ≥{MIN_GAZE_SQUARE_PX}px for eye control.</span>
        </div>
      )}

      {/* Board flip. */}
      <button
        onClick={() =>
          setOrientation((o) => (o === 'white-top' ? 'white-bottom' : 'white-top'))
        }
        title={
          orientation === 'white-top'
            ? 'Flip board — put white at the bottom (V)'
            : 'Flip board — put white at the top (V)'
        }
        aria-label="Flip board orientation"
        className="fixed bottom-3 right-14 z-50 p-2 rounded-lg border border-border bg-card/80 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
      >
        <FlipVertical2 className="w-4 h-4" />
      </button>

      {/* Eye-control / fullscreen toggle. */}
      <button
        onClick={() => (document.fullscreenElement ? exitEyeControl() : enterEyeControl())}
        title={
          isFullscreen ? 'Exit eye control (Esc)' : 'Eye control — fullscreen, gaze on (F)'
        }
        aria-label={isFullscreen ? 'Exit eye control' : 'Enter eye control'}
        aria-pressed={isFullscreen}
        className="fixed bottom-3 right-3 z-50 p-2 rounded-lg border border-border bg-card/80 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
      >
        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>

      {/* Main Game Area */}
      <div
        className={`flex-1 flex overflow-hidden lg:min-h-0 ${
          focusMode ? 'gap-0 p-0' : 'gap-3 p-3'
        }`}
      >
        {/* Left Sidebar - Controls (collapsible on lg+, hidden in focus mode) */}
        {focusMode ? null : leftOpen ? (
          <div className="w-56 hidden lg:flex flex-col shrink-0 lg:min-h-0 lg:overflow-y-auto custom-scrollbar">
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setLeftOpen(false)}
                title="Collapse panel"
                aria-label="Collapse controls panel"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1">
              <LeftSidebar
                difficulty={difficulty}
                timer={timer}
                onNewGame={handleNewGame}
                onRestartGame={handleRestartGame}
                onSettings={handleSettings}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setLeftOpen(true)}
            title="Show controls"
            aria-label="Show controls panel"
            className="hidden lg:flex items-center justify-center w-6 shrink-0 rounded-md border border-border bg-card/40 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Center - Chessboard. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="flex-1 min-w-0 min-h-0 flex items-stretch justify-center"
        >
          <Chessboard
            gameState={gameState}
            onSquareClick={handleSquareClick}
            dwellSquare={dwellSquare}
            dwellProgress={dwellProgress}
            dwellConfidence={dwellConfidence}
            isThinking={engineThinking}
            focusMode={focusMode}
            layoutKey={`${leftOpen}-${rightOpen}`}
            orientation={orientation}
          />
        </motion.div>

        {/* Right Sidebar - Eye Tracking & Move History (hidden in focus mode) */}
        {focusMode ? null : rightOpen ? (
          <div className="w-72 hidden lg:flex gap-4 flex-col shrink-0 lg:min-h-0 lg:overflow-y-auto custom-scrollbar">
            <div className="flex justify-start shrink-0">
              <button
                onClick={() => setRightOpen(false)}
                title="Collapse panel"
                aria-label="Collapse tracking panel"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="shrink-0">
              <EyeTrackingPanel
                eyeTrackingState={eyeTrackingState}
                onStartEyeControl={enterEyeControl}
                isReady={gaze.isReady}
                error={gaze.error}
                hasCalibration={gaze.hasCalibration}
                calibrationSampleCount={gaze.calibrationSampleCount}
                targetSquare={dwellSquare ? toAlgebraic(dwellSquare) : null}
                targetConfidence={dwellConfidence}
                cameraResolution={gaze.cameraResolution}
                fps={gaze.fps}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <MoveHistoryPanel moves={gameState.moves} />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setRightOpen(true)}
            title="Show tracking & history"
            aria-label="Show tracking and history panel"
            className="hidden lg:flex items-center justify-center w-6 shrink-0 rounded-md border border-border bg-card/40 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Mobile Layout - Stacked */}
      <div
        className={`px-4 py-4 space-y-4 border-t border-border ${
          focusMode ? 'hidden' : 'lg:hidden'
        }`}
      >
        <LeftSidebar
          difficulty={difficulty}
          timer={timer}
          onNewGame={handleNewGame}
          onRestartGame={handleRestartGame}
          onSettings={handleSettings}
        />
        <div className="grid grid-cols-2 gap-4">
          <EyeTrackingPanel
            eyeTrackingState={eyeTrackingState}
            onStartEyeControl={enterEyeControl}
            isReady={gaze.isReady}
            error={gaze.error}
            hasCalibration={gaze.hasCalibration}
            calibrationSampleCount={gaze.calibrationSampleCount}
            targetSquare={dwellSquare ? toAlgebraic(dwellSquare) : null}
            targetConfidence={dwellConfidence}
            cameraResolution={gaze.cameraResolution}
            fps={gaze.fps}
          />
          <MoveHistoryPanel moves={gameState.moves} />
        </div>
      </div>
    </div>
  )
}

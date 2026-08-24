'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Chessboard from '@/components/game/Chessboard'
import LeftSidebar from '@/components/layout/LeftSidebar'
import EyeTrackingPanel from '@/components/eye-tracking/EyeTrackingPanel'
import GazeCursor from '@/components/eye-tracking/GazeCursor'
import MoveHistoryPanel from '@/components/move-history/MoveHistoryPanel'
import TopNav from '@/components/layout/TopNav'
import AccessibilityMenu from '@/components/accessibility/AccessibilityMenu'
import { createInitialGameState } from '@/lib/chess/mock-data'
import { DEFAULT_ACCESSIBILITY_SETTINGS } from '@/lib/eye-tracking/mock-data'
import { GameState, BoardPosition } from '@/lib/chess/types'
import { AccessibilitySettings } from '@/lib/eye-tracking/types'
import { makeMove, getPieceAt } from '@/lib/chess/engine'
import { getBestMove } from '@/lib/chess/stockfish-api'
import { applyUciMove } from '@/lib/chess/apply-move'
import { useGazeTracking } from '@/lib/eye-tracking/useGazeTracking'
import { useGazeInteraction } from '@/lib/eye-tracking/useGazeInteraction'

export default function GamePage() {
  const router = useRouter()
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

  // Human plays White; the backend Stockfish plays Black.
  const isHumanTurn = gameState.whiteToMove && !engineThinking

  // Real eye tracking (webcam + MediaPipe face mesh).
  const gaze = useGazeTracking()

  const eyeTrackingState = {
    ...gaze.state,
    calibrationProgress: gaze.hasCalibration ? 100 : 0,
  }

  // Simulate timer countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Push the smoothing setting into the tracker whenever it changes (and once the
  // tracker is live). Higher setting = steadier, less jittery cursor.
  useEffect(() => {
    if (gaze.isReady) gaze.setSmoothing(accessibility.smoothing / 100)
  }, [gaze.isReady, accessibility.smoothing, gaze.setSmoothing])

  // When it becomes Black's turn, ask the backend Stockfish for its move.
  // Keyed on move count so each position is requested exactly once (also guards
  // against React's dev double-invoke).
  const requestedForMoveCount = useRef(-1)
  useEffect(() => {
    if (gameState.whiteToMove) return
    if (gameState.status === 'checkmate' || gameState.status === 'stalemate') return
    if (requestedForMoveCount.current === gameState.moves.length) return
    requestedForMoveCount.current = gameState.moves.length

    let cancelled = false
    setEngineThinking(true)

    getBestMove(gameState, difficulty)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          // Backend unreachable / error — hand the turn back to the player.
          setEngineThinking(false)
          return
        }
        setGameState((prev) => {
          if (!result.move) {
            // No move available: game is over.
            return { ...prev, status: result.status ?? 'checkmate' }
          }
          const next = applyUciMove(prev, result.move)
          if (!next) return prev
          return result.status ? { ...next, status: result.status } : next
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

      // Dwelling on the already-selected square deselects it.
      if (prev.selectedSquare?.row === pos.row && prev.selectedSquare?.col === pos.col) {
        return { ...prev, selectedSquare: null }
      }
      // Dwelling on one of your pieces selects it.
      if (piece && piece.color === myColor) {
        return { ...prev, selectedSquare: pos }
      }
      // Dwelling elsewhere with nothing selected does nothing.
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

  const { dwellSquare, dwellProgress } = useGazeInteraction({
    enabled: gaze.isReady && isHumanTurn,
    gazePoint: gaze.state.gazePoint,
    dwellTime: accessibility.dwellTime,
    registerBlink: gaze.onBlink,
    onDwell: handleGazeDwell,
    onBlinkConfirm: handleBlinkConfirm,
  })

  // Mouse fallback: click to select, click again to move.
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

  const handleCalibration = () => {
    router.push('/calibration')
  }

  const handleSettings = () => {
    setSettingsOpen(true)
  }

  return (
    // On desktop the game is locked to the viewport height (lg:h-screen +
    // overflow-hidden) so the board can claim the full height instead of being
    // pushed below the fold by a tall sidebar. Mobile keeps normal page scroll.
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-background flex flex-col">
      {/* Accessibility Settings Menu */}
      <AccessibilityMenu
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={accessibility}
        onSettingsChange={setAccessibility}
      />

      {/* Top Navigation */}
      <TopNav />

      {/* Full-screen gaze cursor so the player can see (and correct) where the
          tracker thinks they're looking, with a ring that fills as a dwell lands. */}
      <GazeCursor
        gazePoint={gaze.state.gazePoint}
        active={gaze.isReady && gaze.state.status === 'active'}
        dwellProgress={dwellProgress}
        dwelling={!!dwellSquare}
        largeCursor={accessibility.largeCursor}
        reducedMotion={accessibility.reducedMotion}
      />

      {/* Main Game Area */}
      <div className="flex-1 flex gap-3 p-3 overflow-hidden lg:min-h-0">
        {/* Left Sidebar - Controls (collapsible on lg+) */}
        {leftOpen ? (
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

        {/* Center - Chessboard. Opacity-only entrance so the board's rendered
            size never depends on a scale animation finishing. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="flex-1 min-w-0 flex items-center justify-center"
        >
          <Chessboard
            gameState={gameState}
            onSquareClick={handleSquareClick}
            dwellSquare={dwellSquare}
            dwellProgress={dwellProgress}
            isThinking={engineThinking}
          />
        </motion.div>

        {/* Right Sidebar - Eye Tracking & Move History (collapsible on lg+) */}
        {rightOpen ? (
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
            {/* Tracking panel keeps its natural height; move history takes the
                remaining space and scrolls internally so nothing stretches the
                row past the viewport. */}
            <div className="shrink-0">
              <EyeTrackingPanel
                eyeTrackingState={eyeTrackingState}
                onCalibrationClick={handleCalibration}
                videoRef={gaze.videoRef}
                isReady={gaze.isReady}
                error={gaze.error}
                onEnableCamera={gaze.start}
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
      <div className="lg:hidden px-4 py-4 space-y-4 border-t border-border">
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
            onCalibrationClick={handleCalibration}
            videoRef={gaze.videoRef}
            isReady={gaze.isReady}
            error={gaze.error}
            onEnableCamera={gaze.start}
          />
          <MoveHistoryPanel moves={gameState.moves} />
        </div>
      </div>
    </div>
  )
}

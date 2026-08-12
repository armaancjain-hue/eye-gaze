'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Chessboard from '@/components/game/Chessboard'
import LeftSidebar from '@/components/layout/LeftSidebar'
import EyeTrackingPanel from '@/components/eye-tracking/EyeTrackingPanel'
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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Accessibility Settings Menu */}
      <AccessibilityMenu
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={accessibility}
        onSettingsChange={setAccessibility}
      />

      {/* Top Navigation */}
      <TopNav />

      {/* Main Game Area */}
      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        {/* Left Sidebar - Controls */}
        <div className="w-64 hidden lg:flex">
          <LeftSidebar
            difficulty={difficulty}
            timer={timer}
            onNewGame={handleNewGame}
            onRestartGame={handleRestartGame}
            onSettings={handleSettings}
          />
        </div>

        {/* Center - Chessboard */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="flex-1 flex items-center justify-center"
        >
          <Chessboard
            gameState={gameState}
            onSquareClick={handleSquareClick}
            dwellSquare={dwellSquare}
            dwellProgress={dwellProgress}
            isThinking={engineThinking}
          />
        </motion.div>

        {/* Right Sidebar - Eye Tracking & Move History */}
        <div className="w-80 hidden lg:flex gap-6 flex-col">
          <div className="flex-1">
            <EyeTrackingPanel
              eyeTrackingState={eyeTrackingState}
              onCalibrationClick={handleCalibration}
              videoRef={gaze.videoRef}
              isReady={gaze.isReady}
              error={gaze.error}
              onEnableCamera={gaze.start}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            <MoveHistoryPanel moves={gameState.moves} />
          </div>
        </div>
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

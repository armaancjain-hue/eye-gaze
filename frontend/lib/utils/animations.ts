export const ANIMATION_SPRING = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 1,
}

export const ANIMATION_EASING = {
  ease: 'easeInOut',
  duration: 0.3,
}

export const PIECE_ANIMATION = {
  duration: 0.5,
  ease: [0.43, 0.13, 0.23, 0.96],
}

export const HOVER_SCALE = {
  scale: 1.05,
  transition: { duration: 0.2 },
}

export const GAZE_RING_ANIMATION = {
  type: 'tween',
  ease: 'easeOut',
  duration: 0.1,
}

export const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3 },
}

export const shouldReduceMotion = (reducedMotion: boolean) => {
  return reducedMotion ? { duration: 0 } : ANIMATION_SPRING
}

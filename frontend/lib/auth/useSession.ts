'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Client-side view of the session.
 *
 * The session cookie is httpOnly and therefore invisible to JavaScript, so the
 * only way to know who is signed in is to ask the server. The result is cached
 * in a module-level store so that several components mounting at once share one
 * request instead of each firing their own.
 */

export interface SessionUser {
  id: string
  email: string
  name: string
}

type Listener = (user: SessionUser | null) => void

let cachedUser: SessionUser | null = null
let hasLoaded = false
let inFlight: Promise<SessionUser | null> | null = null
const listeners = new Set<Listener>()

function publish(user: SessionUser | null): void {
  cachedUser = user
  hasLoaded = true
  listeners.forEach((l) => l(user))
}

async function fetchSession(): Promise<SessionUser | null> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      if (!res.ok) return null
      const data = (await res.json()) as { user: SessionUser | null }
      return data.user ?? null
    } catch {
      // Offline or a failed request means "we don't know", which for UI purposes
      // is the same as signed out — but it must not throw and break the page.
      return null
    } finally {
      inFlight = null
    }
  })()
  const user = await inFlight
  publish(user)
  return user
}

export interface UseSession {
  user: SessionUser | null
  /** True until the first /api/auth/me response lands. */
  loading: boolean
  /** Re-read the session from the server. */
  refresh: () => Promise<SessionUser | null>
  signOut: () => Promise<void>
}

export function useSession(): UseSession {
  const [user, setUser] = useState<SessionUser | null>(cachedUser)
  const [loading, setLoading] = useState(!hasLoaded)

  useEffect(() => {
    const listener: Listener = (next) => {
      setUser(next)
      setLoading(false)
    }
    listeners.add(listener)

    if (hasLoaded) setLoading(false)
    else fetchSession()

    return () => {
      listeners.delete(listener)
    }
  }, [])

  const refresh = useCallback(() => fetchSession(), [])

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } finally {
      // Clear locally even if the request failed: the alternative is a UI that
      // insists you are still signed in after you asked not to be.
      publish(null)
    }
  }, [])

  return { user, loading, refresh, signOut }
}

/** Drop the cached session — call after a sign-in so the next read is fresh. */
export function setSessionUser(user: SessionUser | null): void {
  publish(user)
}

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import AuthForm from '@/components/auth/AuthForm'
import { getSessionUser } from '@/lib/server/session'

export const metadata: Metadata = {
  title: 'Sign in · Eye Gaze Chess',
}

// Reads the session cookie, so it cannot be statically prerendered.
export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  // Already signed in — there is nothing to do on this page.
  if (await getSessionUser()) redirect('/game')

  // AuthForm reads `?next=`, which requires a Suspense boundary during prerender.
  return (
    <Suspense>
      <AuthForm mode="signin" />
    </Suspense>
  )
}

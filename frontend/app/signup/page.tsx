import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import AuthForm from '@/components/auth/AuthForm'
import { getSessionUser } from '@/lib/server/session'

export const metadata: Metadata = {
  title: 'Create an account · Eye Gaze Chess',
}

export const dynamic = 'force-dynamic'

export default async function SignUpPage() {
  if (await getSessionUser()) redirect('/game')

  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  )
}

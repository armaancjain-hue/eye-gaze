'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setSessionUser, type SessionUser } from '@/lib/auth/useSession'

/**
 * Shared markup for sign-in and sign-up. The two flows differ only in which
 * fields they show, which endpoint they post to, and their copy — so they share
 * one component rather than two near-identical files that drift apart.
 */

export type AuthMode = 'signin' | 'signup'

interface AuthFormProps {
  mode: AuthMode
}

const COPY = {
  signin: {
    title: 'Welcome back',
    subtitle: 'Sign in to pick up where you left off.',
    submit: 'Sign in',
    endpoint: '/api/auth/signin',
    switchPrompt: 'New here?',
    switchLabel: 'Create an account',
    switchHref: '/signup',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Save your games and calibration across devices.',
    submit: 'Create account',
    endpoint: '/api/auth/signup',
    switchPrompt: 'Already have an account?',
    switchLabel: 'Sign in',
    switchHref: '/signin',
  },
} as const

interface ApiError {
  msg?: string
  errors?: Record<string, string | undefined>
}

/** Only same-origin paths are honoured, so `?next=` can't become an open redirect. */
function safeRedirect(target: string | null): string {
  if (!target) return '/game'
  if (!target.startsWith('/') || target.startsWith('//')) return '/game'
  return target
}

export default function AuthForm({ mode }: AuthFormProps) {
  const copy = COPY[mode]
  const router = useRouter()
  const searchParams = useSearchParams()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setFormError(null)
    setFieldErrors({})

    try {
      const res = await fetch(copy.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'signup' ? { name, email, password } : { email, password },
        ),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError
        setFormError(data.msg ?? 'Something went wrong. Please try again.')
        setFieldErrors(data.errors ?? {})
        return
      }

      const data = (await res.json()) as { user: SessionUser }
      // Seed the shared session cache so the nav updates without a second
      // round-trip to /api/auth/me.
      setSessionUser(data.user)
      const destination = safeRedirect(searchParams.get('next'))
      router.push(destination)
      router.refresh()
    } catch {
      setFormError('Couldn’t reach the server. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md space-y-8"
      >
        <div className="text-center space-y-3">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-xl font-bold text-primary">
              ♟
            </span>
            <span className="font-bold text-lg text-foreground">Eye Gaze Chess</span>
          </Link>
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-foreground">{copy.title}</h1>
            <p className="text-muted-foreground">{copy.subtitle}</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl"
        >
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {mode === 'signup' && (
            <Field label="Name" htmlFor="name" error={fieldErrors.name}>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass(!!fieldErrors.name)}
                placeholder="Ada Lovelace"
              />
            </Field>
          )}

          <Field label="Email" htmlFor="email" error={fieldErrors.email}>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass(!!fieldErrors.email)}
              placeholder="you@example.com"
            />
          </Field>

          <Field label="Password" htmlFor="password" error={fieldErrors.password}>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                // Tells a password manager whether to offer a saved password or
                // to generate a new one.
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass(!!fieldErrors.password)} pr-11`}
                placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <Button
            type="submit"
            size="lg"
            disabled={submitting}
            className="w-full h-11 bg-primary hover:bg-accent text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {mode === 'signup' ? 'Creating account…' : 'Signing in…'}
              </>
            ) : (
              copy.submit
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {copy.switchPrompt}{' '}
          <Link href={copy.switchHref} className="text-primary font-medium hover:underline">
            {copy.switchLabel}
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/game" className="hover:text-foreground transition-colors">
            Continue without an account
          </Link>
        </p>
      </motion.div>
    </main>
  )
}

function inputClass(hasError: boolean): string {
  return [
    'w-full h-11 rounded-lg border bg-background px-3 text-sm text-foreground',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
    hasError ? 'border-destructive' : 'border-border',
  ].join(' ')
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

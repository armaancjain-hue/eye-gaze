'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, LogOut, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth/useSession'

const LINKS = [
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#features', label: 'Features' },
  { href: '#accessibility', label: 'Accessibility' },
  { href: '#about', label: 'About' },
]

export default function LandingNav() {
  const [open, setOpen] = useState(false)
  const { user, loading, signOut } = useSession()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    setOpen(false)
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0912]/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <motion.span
            whileHover={{ scale: 1.06 }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/40 bg-primary/15"
          >
            <Eye className="h-5 w-5 text-primary" />
          </motion.span>
          <span className="text-xl font-bold tracking-tight text-foreground">Eye Gaze Chess</span>
        </Link>

        <div className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Account controls stay in the bar — signing in is how calibration
              and finished games survive a reload. */}
          {!loading &&
            (user ? (
              <button
                onClick={handleSignOut}
                title={`Sign out (${user.email})`}
                className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground sm:flex"
              >
                <LogOut className="h-4 w-4" />
                <span className="max-w-[8rem] truncate">{user.name}</span>
              </button>
            ) : (
              <Link
                href="/signin"
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground sm:block"
              >
                Sign in
              </Link>
            ))}

          <Link href="/game" className="hidden sm:block">
            <Button className="rounded-xl bg-primary px-5 font-semibold hover:bg-accent">
              Try It Now
            </Button>
          </Link>

          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-1 border-t border-white/5 px-5 py-4 lg:hidden"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <div className="flex gap-2 pt-2">
            <Link href="/game" className="flex-1" onClick={() => setOpen(false)}>
              <Button className="w-full">Try It Now</Button>
            </Link>
            {!loading &&
              (user ? (
                <Button variant="outline" className="flex-1" onClick={handleSignOut}>
                  Sign out
                </Button>
              ) : (
                <Link href="/signin" className="flex-1" onClick={() => setOpen(false)}>
                  <Button variant="outline" className="w-full">
                    Sign in
                  </Button>
                </Link>
              ))}
          </div>
        </motion.div>
      )}
    </header>
  )
}

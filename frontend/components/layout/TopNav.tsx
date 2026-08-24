'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { LogOut, Menu, Settings, Moon, Sun, User } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth/useSession'

export default function TopNav() {
  const [isDark, setIsDark] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, loading, signOut } = useSession()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    setMenuOpen(false)
    router.push('/')
    router.refresh()
  }

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="border-b border-border bg-card/50 backdrop-blur"
    >
      <div className="px-6 py-2.5 flex items-center justify-between max-w-full">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3">
          <motion.div
            whileHover={{ rotate: 360 }}
            transition={{ duration: 0.5 }}
            className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"
          >
            <span className="text-lg font-bold text-primary">♟</span>
          </motion.div>
          <div className="hidden sm:block">
            <h1 className="font-bold text-lg text-foreground">Eye Gaze Chess</h1>
            <p className="text-xs text-muted-foreground">Accessibility First</p>
          </div>
        </Link>

        {/* Right Navigation */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Theme Toggle */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsDark(!isDark)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            {isDark ? (
              <Sun className="w-5 h-5 text-muted-foreground" />
            ) : (
              <Moon className="w-5 h-5 text-muted-foreground" />
            )}
          </motion.button>

          {/* Account. Renders nothing until the session has loaded, so the nav
              doesn't flash "Sign in" at someone who is already signed in. */}
          {!loading && (
            <div className="hidden sm:flex items-center gap-2">
              {user ? (
                <>
                  <span
                    className="flex items-center gap-2 px-2 py-1 rounded-lg text-sm text-muted-foreground max-w-[12rem]"
                    title={user.email}
                  >
                    <User className="w-4 h-4 shrink-0" />
                    <span className="truncate">{user.name}</span>
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSignOut}
                    title="Sign out"
                    aria-label="Sign out"
                    className="p-2 rounded-lg hover:bg-muted transition-colors"
                  >
                    <LogOut className="w-5 h-5 text-muted-foreground" />
                  </motion.button>
                </>
              ) : (
                <>
                  <Link href="/signin">
                    <Button variant="ghost" size="sm">
                      Sign in
                    </Button>
                  </Link>
                  <Link href="/signup">
                    <Button size="sm">Sign up</Button>
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Settings */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="p-2 rounded-lg hover:bg-muted transition-colors hidden sm:flex"
          >
            <Settings className="w-5 h-5 text-muted-foreground" />
          </motion.button>

          {/* Mobile Menu */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-lg hover:bg-muted transition-colors sm:hidden"
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </motion.button>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="border-t border-border px-6 py-4 space-y-2 sm:hidden"
        >
          <Link href="/">
            <Button variant="outline" className="w-full justify-start">
              Home
            </Button>
          </Link>
          {user ? (
            <>
              <p className="px-2 text-sm text-muted-foreground truncate">
                Signed in as {user.name}
              </p>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleSignOut}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/signin">
                <Button variant="outline" className="w-full justify-start">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button variant="outline" className="w-full justify-start">
                  Sign up
                </Button>
              </Link>
            </>
          )}
          <Button variant="outline" className="w-full justify-start">
            Settings
          </Button>
        </motion.div>
      )}
    </motion.header>
  )
}

'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Eye, Zap, Brain, Globe, Accessibility, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

const FEATURES = [
  {
    icon: Eye,
    title: 'Eye Tracking',
    description: 'Play chess by looking where you want to move, no mouse needed',
  },
  {
    icon: Zap,
    title: 'Blink Confirmation',
    description: 'Confirm your moves naturally with a blink',
  },
  {
    icon: Brain,
    title: 'Adaptive AI',
    description: 'Challenge yourself against intelligent opponents',
  },
  {
    icon: Globe,
    title: 'Works in Browser',
    description: 'No installation required, play from anywhere',
  },
  {
    icon: Accessibility,
    title: 'Accessibility First',
    description: 'Built for everyone, with comprehensive settings',
  },
  {
    icon: Sparkles,
    title: 'Customizable',
    description: 'Adjust settings to match your unique needs',
  },
]

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5 },
  },
}

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative px-4 py-20 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-screen">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-4xl text-center space-y-8"
        >
          <div className="space-y-6">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-balance text-foreground tracking-tight">
              Play Chess
              <span className="block bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                Using Only Your Eyes
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground text-balance mx-auto max-w-2xl leading-relaxed">
              An accessibility-first chess experience powered by eye tracking. Designed for everyone, controlled by you.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 justify-center pt-4"
          >
            <Link href="/game">
              <Button
                size="lg"
                className="text-base h-12 px-8 bg-primary hover:bg-accent text-primary-foreground transition-colors"
              >
                Start Playing
              </Button>
            </Link>
            <Link href="/calibration">
              <Button
                variant="outline"
                size="lg"
                className="text-base h-12 px-8 border-border hover:bg-card"
              >
                Calibrate Camera
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-20 sm:px-6 lg:px-8 bg-card border-t border-border">
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="max-w-7xl mx-auto"
        >
          <motion.div variants={item} className="text-center space-y-4 mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-foreground">
              Designed for Accessibility
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Experience chess like never before with powerful eye-tracking technology
            </p>
          </motion.div>

          <motion.div
            variants={container}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon
              return (
                <motion.div
                  key={index}
                  variants={item}
                  whileHover={{ y: -4, transition: { duration: 0.2 } }}
                  className="group relative p-6 rounded-xl bg-background border border-border hover:border-primary/50 transition-all duration-300 overflow-hidden"
                >
                  {/* Gradient background on hover */}
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <div className="relative z-10 space-y-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg text-foreground mb-2">
                        {feature.title}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        </motion.div>
      </section>

      {/* CTA Section */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto text-center space-y-6"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Ready to Play?
          </h2>
          <p className="text-lg text-muted-foreground">
            Get started in seconds. No setup required.
          </p>
          <Link href="/game">
            <Button size="lg" className="text-base h-12 px-8 bg-primary hover:bg-accent">
              Launch Game
            </Button>
          </Link>
        </motion.div>
      </section>
    </main>
  )
}

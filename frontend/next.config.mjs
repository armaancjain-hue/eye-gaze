/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this folder so Turbopack doesn't infer it from a
  // stray lockfile elsewhere (e.g. a package-lock.json in the home directory).
  turbopack: {
    root: import.meta.dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },

  // Both packages load native/WASM assets from their own directory at runtime.
  // Bundling them rewrites those paths and breaks the lookup, so they stay in
  // node_modules and are required normally.
  serverExternalPackages: ['stockfish', '@prisma/adapter-pg', 'pg'],

  // `stockfish` resolves its engine file at runtime from a string, which the
  // dependency tracer cannot follow — so the WASM has to be named explicitly or
  // it simply won't be deployed.
  outputFileTracingIncludes: {
    '/api/ai-move': [
      './node_modules/stockfish/bin/stockfish-18-lite-single.js',
      './node_modules/stockfish/bin/stockfish-18-lite-single.wasm',
    ],
  },

  // The package ships every engine flavour, including two ~113MB WASM builds.
  // Left in, they blow straight past Vercel's 250MB uncompressed function limit;
  // we only ever load "lite-single" (7MB), so the rest are excluded by name.
  outputFileTracingExcludes: {
    '/api/ai-move': [
      './node_modules/stockfish/bin/stockfish-18.js',
      './node_modules/stockfish/bin/stockfish-18.wasm',
      './node_modules/stockfish/bin/stockfish-18-single.js',
      './node_modules/stockfish/bin/stockfish-18-single.wasm',
      './node_modules/stockfish/bin/stockfish-18-lite.js',
      './node_modules/stockfish/bin/stockfish-18-lite.wasm',
      './node_modules/stockfish/bin/stockfish-18-asm.js',
      './node_modules/stockfish/bin/stockfish.js',
      './node_modules/stockfish/bin/stockfish.wasm',
    ],
  },
}

export default nextConfig

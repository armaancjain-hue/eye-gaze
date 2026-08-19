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
}

export default nextConfig

/** @type {import('next').NextConfig} */
const basePath = '/inference-provider-leaderboard'
const nextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
}

export default nextConfig

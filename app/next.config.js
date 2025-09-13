/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  // Cloudflare Pages configuration
  assetPrefix: process.env.NODE_ENV === 'production' ? 'https://qa.jobhackai.io' : '',
}

module.exports = nextConfig

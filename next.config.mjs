/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@starknet-io/get-starknet-discovery', 
    '@starknet-io/get-starknet-wallet-standard',
    'lucide-react'
  ],
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async redirects() {
    return [
      {
        source: '/app',
        destination: '/wallet',
        permanent: true,
      },
      {
        source: '/terminal',
        destination: '/extended',
        permanent: true,
      },
      {
        source: '/perps',
        destination: '/extended',
        permanent: true,
      },
    ];
  },
  webpack: (config, { dev }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;

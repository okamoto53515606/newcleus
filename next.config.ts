import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  staticPageGenerationTimeout: 30,
  // X-Powered-By ヘッダを抑止しフィンガープリントを減らす
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [],
  },
  async rewrites() {
    // why: ローカル開発中も TinyMCE へ挿入する画像 URL を同一オリジンに保ち、
    //      CloudFront 直参照時の CORP ブロックを回避する。
    if (process.env.NODE_ENV === 'development' && process.env.CLOUDFRONT_DOMAIN) {
      return [
        {
          source: '/media/:path*',
          destination: `https://${process.env.CLOUDFRONT_DOMAIN}/media/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;

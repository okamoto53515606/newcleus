import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  staticPageGenerationTimeout: 30,
  // X-Powered-By ヘッダを抑止しフィンガープリントを減らす
  poweredByHeader: false,
  typescript: {
    // why: 型エラーのあるコードを本番デプロイさせないため、ビルド時に型検証を必須化する。
    //      かつて ignoreBuildErrors: true だったため logger の import 漏れ(TS2304)が
    //      そのまま本番入りし、画像アップロード API が ReferenceError で壊れる事故が発生。
    //      型エラーは npm run typecheck と同様ここで確実に落とす。
    ignoreBuildErrors: false,
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

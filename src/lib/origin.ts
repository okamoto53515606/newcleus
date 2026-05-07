/**
 * 公開 origin（ビューワーが見る URL）を返す共通ヘルパー
 *
 * Why:
 *   CloudFront → Lambda Function URL 構成では originRequestPolicy に
 *   ALL_VIEWER_EXCEPT_HOST_HEADER を使っているため、Lambda が受け取る
 *   host ヘッダーは Lambda Function URL 自身のドメインになる。
 *   その結果 request.nextUrl.origin が CloudFront ドメインと異なり、
 *   - Google OAuth redirect_uri ミスマッチ
 *   - Cognito redirect_mismatch
 *   - 内部リダイレクト先が Lambda URL → ブラウザが直接アクセス → 403
 *   が発生する。
 *   CLOUDFRONT_DOMAIN env を優先することで確実に公開 URL を得る。
 *   ローカル開発時は CLOUDFRONT_DOMAIN 未設定のため request.nextUrl.origin に
 *   フォールバックし、従来通り動作する。
 */
import { NextRequest } from 'next/server';
import { isDevelopment } from '@/lib/env';

export function getPublicOrigin(request: NextRequest): string {
  // ローカル開発 (NODE_ENV!=='production') では CLOUDFRONT_DOMAIN を無視する。
  // 理由: .env に本番の CLOUDFRONT_DOMAIN が残っていると、localhost:9002 で
  //       起動しても Google OAuth redirect_uri が CloudFront ドメインになり、
  //       Google に登録された http://localhost:9002/... と不一致でログイン不可。
  //       本番 Lambda では NODE_ENV=production なので env を優先する。
  if (!isDevelopment()) {
    const cfDomain = process.env.CLOUDFRONT_DOMAIN;
    if (cfDomain) return `https://${cfDomain}`;
  }
  return request.nextUrl.origin;
}

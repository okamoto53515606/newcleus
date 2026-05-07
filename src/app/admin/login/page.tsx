/**
 * 管理者ログインページ
 * 
 * @description
 * Cognito Hosted UI へのリダイレクトボタンを表示。
 * 未認証の管理者がここに誘導される。
 */
import { ShieldCheck } from 'lucide-react';
import { getCognitoLoginUrl } from '@/lib/admin-auth';
import { headers } from 'next/headers';
import { isDevelopment } from '@/lib/env';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const headersList = await headers();
  // CLOUDFRONT_DOMAIN を優先して使用する。
  // 理由: CloudFront → Lambda の経路では originRequestPolicy=ALL_VIEWER_EXCEPT_HOST_HEADER
  //       により Lambda の host ヘッダーは Lambda Function URL ドメインになる。
  //       Cognito redirect_uri はビューワーが見る CloudFront ドメインと一致させる必要があるため
  //       env 経由で確定値を渡す。ただしローカル開発時は .env に本番の CLOUDFRONT_DOMAIN が
  //       残っていても無視し、host ヘッダー (localhost:9002) にフォールバックする。
  const cloudfrontDomain = isDevelopment() ? undefined : process.env.CLOUDFRONT_DOMAIN;
  let origin: string;
  if (cloudfrontDomain) {
    origin = `https://${cloudfrontDomain}`;
  } else {
    const host = headersList.get('host') || 'localhost:9002';
    const protocol = headersList.get('x-forwarded-proto') || 'http';
    origin = `${protocol}://${host}`;
  }

  const callbackUrl = `${origin}/api/admin/auth/callback`;
  const loginUrl = getCognitoLoginUrl(callbackUrl);

  const errorMessages: Record<string, string> = {
    cognito_error: 'Cognito 認証でエラーが発生しました。',
    no_code: '認証コードが取得できませんでした。',
    config_error: 'サーバー設定に問題があります。',
    token_exchange_failed: 'トークンの交換に失敗しました。',
    no_id_token: 'IDトークンが取得できませんでした。',
    server_error: 'サーバーエラーが発生しました。',
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      textAlign: 'center',
      padding: '2rem',
      backgroundColor: '#f8f9fa',
    }}>
      <ShieldCheck size={64} style={{ color: '#0d6efd', marginBottom: '1.5rem' }} />
      <h1 style={{
        fontSize: '2rem',
        fontWeight: 'bold',
        marginBottom: '0.5rem',
      }}>
        管理者ログイン
      </h1>
      <p style={{
        fontSize: '1rem',
        color: '#6c757d',
        marginBottom: '2rem',
        maxWidth: '400px',
      }}>
        管理画面にアクセスするには、Cognito アカウントでログインしてください。
      </p>

      {params.error && (
        <div style={{
          backgroundColor: '#f8d7da',
          color: '#842029',
          padding: '0.75rem 1.25rem',
          borderRadius: '0.375rem',
          marginBottom: '1.5rem',
          maxWidth: '400px',
          width: '100%',
        }}>
          {errorMessages[params.error] || 'エラーが発生しました。'}
        </div>
      )}

      <a
        href={loginUrl}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 2rem',
          fontSize: '1.1rem',
          fontWeight: '600',
          color: '#fff',
          backgroundColor: '#0d6efd',
          borderRadius: '0.5rem',
          textDecoration: 'none',
          transition: 'background-color 0.2s',
        }}
      >
        <ShieldCheck size={20} />
        ログイン
      </a>
    </div>
  );
}

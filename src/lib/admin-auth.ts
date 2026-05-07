/**
 * 管理者認証ユーティリティ（Cognito）
 * 
 * 利用者サイトの Google OAuth セッション（cookie: session）とは完全独立。
 * 管理者は Cognito Hosted UI でログインし、admin_session cookie で管理。
 * 
 * 【セッション比較】
 * | 項目           | 利用者（Google OAuth） | 管理者（Cognito）         |
 * |---------------|----------------------|--------------------------|
 * | Cookie 名      | session              | admin_session             |
 * | JWT 署名       | HS256（自前 JWT_SECRET）| RS256（Cognito JWKS）     |
 * | 検証方法       | jose jwtVerify        | jose jwtVerify + JWKS     |
 * | 認証プロバイダ  | Google               | Cognito（MFA 必須）       |
 */

import { cookies } from 'next/headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { logger } from './env';

const ADMIN_SESSION_COOKIE_NAME = 'admin_session';

export interface AdminUser {
  isAuthenticated: boolean;
  email?: string;
  sub?: string;
  /** Cognito カスタム属性: 'admin' | 'siteadmin' */
  role?: string;
  /** Cognito カスタム属性: アクセス許可サイト ID の JSON 文字列（siteadmin のみ） */
  siteIds?: string[];
}

/**
 * Cognito JWKS URL を構築
 */
function getCognitoJwksUrl(): URL {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    throw new Error('COGNITO_USER_POOL_ID environment variable is not set');
  }
  const region = userPoolId.split('_')[0]; // "ap-northeast-1_xxx" → "ap-northeast-1"
  return new URL(`https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`);
}

/**
 * Cognito issuer URL を構築
 */
function getCognitoIssuer(): string {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    throw new Error('COGNITO_USER_POOL_ID environment variable is not set');
  }
  const region = userPoolId.split('_')[0];
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

// JWKS はキャッシュされる（jose 内部でキャッシュ管理）
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(getCognitoJwksUrl());
  }
  return _jwks;
}

/**
 * 管理者セッションを検証
 * admin_session cookie の Cognito ID Token を JWKS で検証
 */
export async function getAdminUser(): Promise<AdminUser> {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;

  if (!adminCookie) {
    return { isAuthenticated: false };
  }

  try {
    const { payload } = await jwtVerify(adminCookie, getJwks(), {
      issuer: getCognitoIssuer(),
      audience: process.env.COGNITO_CLIENT_ID,
    });

    // DEBUG: ID トークンに含まれる全クレームをログ出力
    // why: custom:role が /api/admin/auth/me で返らない問題の調査用。
    //      原因が判明したらこの行は削除する。
    logger.info(`[AdminAuth DEBUG] JWT payload keys: ${Object.keys(payload).join(', ')}`);
    logger.info(`[AdminAuth DEBUG] custom:role = ${String(payload['custom:role'])}`);

    return {
      isAuthenticated: true,
      email: payload.email as string | undefined,
      sub: payload.sub as string | undefined,
      role: payload['custom:role'] as string | undefined,
      siteIds: (() => {
        const raw = payload['custom:siteIds'] as string | undefined;
        if (!raw) return undefined;
        try {
          return JSON.parse(raw) as string[];
        } catch {
          return undefined;
        }
      })(),
    };
  } catch (error: unknown) {
    const errorMessage = (error as { message?: string })?.message;
    if (errorMessage?.includes('expired')) {
      logger.info('[AdminAuth] Cognito JWT 期限切れ');
    } else {
      logger.error(`[AdminAuth] Cognito JWT 検証エラー: ${errorMessage}`);
    }
    return { isAuthenticated: false };
  }
}

/**
 * Cognito Hosted UI のログイン URL を構築
 */
export function getCognitoLoginUrl(callbackUrl: string): string {
  const domain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const region = process.env.COGNITO_USER_POOL_ID?.split('_')[0] || 'ap-northeast-1';

  if (!domain || !clientId) {
    throw new Error('COGNITO_DOMAIN or COGNITO_CLIENT_ID is not set');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: callbackUrl,
  });

  return `https://${domain}.auth.${region}.amazoncognito.com/login?${params.toString()}`;
}

/**
 * Cognito Hosted UI のログアウト URL を構築
 */
export function getCognitoLogoutUrl(logoutRedirectUrl: string): string {
  const domain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const region = process.env.COGNITO_USER_POOL_ID?.split('_')[0] || 'ap-northeast-1';

  if (!domain || !clientId) {
    throw new Error('COGNITO_DOMAIN or COGNITO_CLIENT_ID is not set');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: logoutRedirectUrl,
  });

  return `https://${domain}.auth.${region}.amazoncognito.com/logout?${params.toString()}`;
}

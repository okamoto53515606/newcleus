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
 *
 * 【custom:role / custom:siteIds の取得方式について】
 * Cognito の ID トークンに custom:* 属性が含まれない場合がある
 * （App Client の ReadAttributes 設定・CDK drift 等の影響）。
 * ID トークンから取得するとロール変更がトークン再発行まで反映されない問題もある。
 *
 * why: JWT の sub クレームは RS256 署名で改ざん不能。
 *      その sub に紐づく属性をサーバー側で Cognito AdminGetUser API で
 *      直接取得することで、常に最新の正しい値を使用できる。
 *      Lambda 実行ロールに cognito-idp:AdminGetUser を付与する必要がある。
 */

import { cookies } from 'next/headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
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

// Cognito AdminGetUser 結果のインメモリキャッシュ
// why: Lambda ウォームスタート間でモジュール変数は保持される。
//      リクエストごとに Cognito API を叩くと 100〜200ms のレイテンシーが発生するため
//      TTL のキャッシュを挟む。
// キャッシュキーは cognitoUsername（= Cognito の Username / メールアドレス）。
// why username: sub ではなく username をキーにすることで、
//   admin が siteIds を更新した直後に clearCognitoAttrCache(username) で
//   即時無効化できる（同 Lambda インスタンス内）。
// 複数 Lambda インスタンス間の一貫性は TTL（10 秒）で担保する。
interface CognitoAttrCache {
  role?: string;
  siteIds?: string[];
  expiresAt: number;
}
const _attrCache = new Map<string, CognitoAttrCache>(); // key: cognitoUsername

/**
 * 指定ユーザーのキャッシュを即時無効化する
 *
 * why: admin がテナントの siteIds を更新した直後に呼ぶことで、
 *      同一 Lambda インスタンスでは次リクエストから新しい属性が反映される。
 *      異なる Lambda インスタンスは TTL（10 秒）経過後に自動更新される。
 *
 * @param cognitoUsername - Cognito の Username（メールアドレス）
 */
export function clearCognitoAttrCache(cognitoUsername: string): void {
  _attrCache.delete(cognitoUsername);
}

/**
 * Cognito AdminGetUser API で sub に紐づく custom 属性を取得する
 *
 * why: ID トークンの custom:* クレームは App Client の ReadAttributes 設定や
 *      CDK drift の影響で欠落することがある。また JWT はステートフルでないため
 *      ロール変更がトークン再発行まで反映されない。
 *      sub は RS256 署名で改ざん不能であるため、sub を信頼の起点として
 *      サーバー側で最新の属性を取得する方式がより安全。
 *
 * @param cognitoUsername - JWT の cognito:username クレーム（メールアドレス）
 * @param sub - JWT の sub クレーム（キャッシュキーとして使用）
 */
async function lookupCognitoAttributes(
  cognitoUsername: string,
  sub: string
): Promise<{ role?: string; siteIds?: string[] }> {
  const now = Date.now();
  // キャッシュキーは cognitoUsername（sub ではなく）
  const cached = _attrCache.get(cognitoUsername);
  if (cached && cached.expiresAt > now) {
    return { role: cached.role, siteIds: cached.siteIds };
  }
  // sub は使用しないが引数シグネチャは維持（呼び出し元との互換性）
  void sub;

  const userPoolId = process.env.COGNITO_USER_POOL_ID!;
  const region = userPoolId.split('_')[0];

  const client = new CognitoIdentityProviderClient({ region });
  const resp = await client.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: cognitoUsername })
  );

  const attrMap = Object.fromEntries(
    (resp.UserAttributes ?? []).map((a) => [a.Name, a.Value])
  );

  const result: CognitoAttrCache = {
    role: attrMap['custom:role'],
    siteIds: (() => {
      const raw = attrMap['custom:siteIds'];
      if (!raw) return undefined;
      try { return JSON.parse(raw) as string[]; } catch { return undefined; }
    })(),
    expiresAt: now + 10_000, // 10 秒 TTL（複数 Lambda インスタンス間の最大遅延）
  };
  _attrCache.set(cognitoUsername, result);
  return { role: result.role, siteIds: result.siteIds };
}

/**
 * 管理者セッションを検証し AdminUser を返す
 *
 * 手順:
 *  1. admin_session cookie の Cognito ID Token を JWKS（RS256）で署名検証
 *  2. sub・cognito:username を JWT から取得（改ざん不能）
 *  3. AdminGetUser API で最新の custom:role / custom:siteIds を取得
 *     （ID トークンの claim には依存しない）
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

    const sub = payload.sub;
    const cognitoUsername = payload['cognito:username'] as string | undefined;

    if (!sub || !cognitoUsername) {
      logger.error('[AdminAuth] JWT に sub または cognito:username が含まれていません');
      return { isAuthenticated: false };
    }

    // Cognito API で最新の custom 属性を取得（JWTのclaimには依存しない）
    const { role, siteIds } = await lookupCognitoAttributes(cognitoUsername, sub);

    return {
      isAuthenticated: true,
      email: payload.email as string | undefined,
      sub,
      role,
      siteIds,
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

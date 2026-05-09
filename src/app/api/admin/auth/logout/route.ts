/**
 * 管理者ログアウト API
 *
 * admin_session cookie を削除し、Cognito Hosted UI のログアウト URL を JSON で返す。
 *
 * why: ネイティブ HTML フォームの POST は fetchWithSigning を経由しないため、
 *      CloudFront OAC の SigV4 ボディハッシュ検証で署名不一致になる。
 *      クライアントは fetchWithSigning で POST し、返却された logoutUrl に
 *      window.location.href で遷移することで署名エラーを回避する。
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getCognitoLogoutUrl } from '@/lib/admin-auth';
import { getPublicOrigin } from '@/lib/origin';

const ADMIN_SESSION_COOKIE_NAME = 'admin_session';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE_NAME);

  // getPublicOrigin: Cognito がブラウザをリダイレクトする先が Lambda URL になるのを防ぐ。
  const logoutRedirectUrl = `${getPublicOrigin(request)}/admin/login`;
  const cognitoLogoutUrl = getCognitoLogoutUrl(logoutRedirectUrl);

  // why: NextResponse.redirect ではなく JSON を返す。
  //      クライアントが window.location.href で遷移することで
  //      Cognito のセッションも正しくクリアされる。
  return NextResponse.json({ logoutUrl: cognitoLogoutUrl });
}

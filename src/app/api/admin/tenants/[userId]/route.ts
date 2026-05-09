/**
 * テナント管理 API — PUT 更新 / DELETE 削除
 *
 * userId は Cognito の Username（メールアドレス）を URL エンコードしたもの。
 * PUT: siteIds の紐づけ変更
 * DELETE: ユーザー削除（物理削除 AdminDeleteUser）
 *
 * 【DELETE の理由】
 * AdminDisableUser（無効化）にしない理由: 無効化だと課金対象ユーザー数が減らず、
 * また「削除」という管理者の意図を明確にするため物理削除とする。
 * 誤削除は再作成で対応可（パスワードリセット相当）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser, clearCognitoAttrCache } from '@/lib/admin-auth';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export const dynamic = 'force-dynamic';

function getCognitoClient() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) throw new Error('COGNITO_USER_POOL_ID is not set');
  const region = userPoolId.split('_')[0];
  return { client: new CognitoIdentityProviderClient({ region }), userPoolId };
}

/**
 * GET /api/admin/tenants/[userId]
 * 1ユーザーの情報を返す（編集フォームの初期値用）
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getAdminUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;
  const username = decodeURIComponent(userId);

  const { client, userPoolId } = getCognitoClient();

  try {
    const resp = await client.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    const attrs = Object.fromEntries(
      (resp.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
    );
    const rawSiteIds = attrs['custom:siteIds'];
    let siteIds: string[] = [];
    if (rawSiteIds) {
      try { siteIds = JSON.parse(rawSiteIds) as string[]; } catch { /* empty */ }
    }
    return NextResponse.json({
      tenant: {
        userId: username,
        email: attrs['email'] ?? username,
        status: resp.UserStatus ?? '',
        siteIds,
      },
    });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'UserNotFoundException') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    throw err;
  }
}

/**
 * PUT /api/admin/tenants/[userId]
 * siteIds を更新する
 *
 * Body: { siteIds: string[] }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getAdminUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;
  const username = decodeURIComponent(userId);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { siteIds } = body as Record<string, unknown>;
  if (!Array.isArray(siteIds)) {
    return NextResponse.json({ error: 'siteIds は配列で指定してください' }, { status: 400 });
  }

  const { client, userPoolId } = getCognitoClient();

  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: username,
      UserAttributes: [
        { Name: 'custom:siteIds', Value: JSON.stringify(siteIds) },
      ],
    }),
  );

  // why: siteIds 更新後に同一 Lambda インスタンス内のキャッシュを即時クリアする。
  //      異なる Lambda インスタンスの場合は TTL(10s) 経過後に自動反映される。
  clearCognitoAttrCache(username);

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/tenants/[userId]
 * ユーザーを物理削除する（CloudFront は DELETE body を転送しないためクエリパラメータ不要の path-only 方式）
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getAdminUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;
  const username = decodeURIComponent(userId);

  const { client, userPoolId } = getCognitoClient();

  try {
    await client.send(
      new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'UserNotFoundException') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

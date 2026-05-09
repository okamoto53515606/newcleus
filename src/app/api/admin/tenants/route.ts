/**
 * テナント管理 API — GET 一覧 / POST 作成
 *
 * 【設計方針】
 * - Cognito User Pool で role=siteadmin のユーザーを管理する
 * - サイト紐づけ（custom:siteIds）は JSON 文字列配列で Cognito 属性として保持
 * - admin ロールのユーザーのみアクセス可（siteadmin 不可）
 *
 * 【POST: ユーザー作成フロー】
 * AdminCreateUser → FORCE_CHANGE_PASSWORD 状態で作成（一時パスワードを管理者が設定）
 * MessageAction: SUPPRESS で Cognito の招待メールを抑制（管理者が直接パスワードを伝える）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';

export const dynamic = 'force-dynamic';

function getCognitoClient() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) throw new Error('COGNITO_USER_POOL_ID is not set');
  const region = userPoolId.split('_')[0];
  return { client: new CognitoIdentityProviderClient({ region }), userPoolId };
}

/**
 * GET /api/admin/tenants
 * siteadmin ユーザー一覧を返す
 */
export async function GET(_req: NextRequest) {
  const user = await getAdminUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { client, userPoolId } = getCognitoClient();

  // why: Cognito ListUsers の Filter は custom:* 属性に対応していないため、
  //      全ユーザーを取得してアプリ側で role=siteadmin のみに絞り込む。
  //      Limit=60 は admin ユーザーを含む総数を想定した上限。
  const resp = await client.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Limit: 60,
    }),
  );

  const users = (resp.Users ?? [])
    .filter((u) => {
      const role = (u.Attributes ?? []).find((a) => a.Name === 'custom:role')?.Value;
      return role === 'siteadmin';
    })
    .map((u) => {
    const attrs = Object.fromEntries(
      (u.Attributes ?? []).map((a) => [a.Name, a.Value]),
    );
    const rawSiteIds = attrs['custom:siteIds'];
    let siteIds: string[] = [];
    if (rawSiteIds) {
      try { siteIds = JSON.parse(rawSiteIds) as string[]; } catch { /* empty */ }
    }
    return {
      userId: u.Username ?? '',
      email: attrs['email'] ?? '',
      status: u.UserStatus ?? '',
      siteIds,
      createdAt: u.UserCreateDate?.toISOString() ?? '',
    };
  });

  return NextResponse.json({ users });
}

/**
 * POST /api/admin/tenants
 * siteadmin ユーザーを新規作成する
 *
 * Body: { email: string; temporaryPassword: string; siteIds: string[] }
 */
export async function POST(req: NextRequest) {
  const user = await getAdminUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, temporaryPassword, siteIds } = body as Record<string, unknown>;

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'email が無効です' }, { status: 400 });
  }
  if (!temporaryPassword || typeof temporaryPassword !== 'string' || temporaryPassword.length < 8) {
    return NextResponse.json({ error: '初期パスワードは8文字以上で入力してください' }, { status: 400 });
  }
  if (!Array.isArray(siteIds)) {
    return NextResponse.json({ error: 'siteIds は配列で指定してください' }, { status: 400 });
  }

  const { client, userPoolId } = getCognitoClient();

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        TemporaryPassword: temporaryPassword,
        // why: Cognito の招待メール（ウェルカムメール）を抑制する。
        //      管理者が直接ユーザーに初期パスワードを伝えるフローのため。
        MessageAction: MessageActionType.SUPPRESS,
        UserAttributes: [
          { Name: 'email', Value: email },
          // why: 管理者が作成するアカウントはメール確認済みとして扱う
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:role', Value: 'siteadmin' },
          { Name: 'custom:siteIds', Value: JSON.stringify(siteIds) },
        ],
      }),
    );
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'UsernameExistsException') {
      return NextResponse.json({ error: 'このメールアドレスはすでに登録されています' }, { status: 409 });
    }
    if (code === 'InvalidPasswordException') {
      return NextResponse.json({ error: '初期パスワードが Cognito のポリシーを満たしていません' }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

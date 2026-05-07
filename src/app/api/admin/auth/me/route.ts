import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/** GET /api/admin/auth/me — 現在ログイン中のユーザー情報を返す */
export async function GET(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    sub: user.sub,
    email: user.email,
    role: user.role,
    siteIds: user.siteIds,
  });
}

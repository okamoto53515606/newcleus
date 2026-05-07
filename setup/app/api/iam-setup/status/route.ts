/**
 * setup1c-iam: 現在の .env AWS キーが誰のものか返す API
 *
 * 目的 (why):
 *   UI で「まだ root キーが入っている / すでに newcleus-deployer に切り替え済み」を
 *   判定するために使う。STS:GetCallerIdentity は newcleus-deployer ポリシーにも
 *   含めているので、root / IAM ユーザーどちらでも呼べる。
 *
 *   ARN に :root が含まれていれば root キー、
 *   :user/newcleus-deployer が含まれていれば切り替え済みと判定する。
 */

import { NextResponse } from "next/server";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { readEnv } from "@/lib/env";
import { HOMEPAGE_DEPLOYER_USER_NAME } from "@/lib/newcleus-deployer-policy";

export async function GET() {
  const env = readEnv();
  const accessKeyId = env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = env.get("AWS_SECRET_ACCESS_KEY");
  const region = env.get("AWS_REGION") ?? "ap-northeast-1";

  // why: STS が失敗しても「.env にどのキー ID が入っているか」を UI に常に表示したい
  //      ので、先頭 4 文字だけのプレフィックスを返す（フル表示は秘密扱いで避ける）。
  const accessKeyIdPrefix = accessKeyId ? `${accessKeyId.slice(0, 4)}…` : undefined;

  if (!accessKeyId || !secretAccessKey) {
    return NextResponse.json({ configured: false, accessKeyIdPrefix });
  }

  try {
    const sts = new STSClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    const res = await sts.send(new GetCallerIdentityCommand({}));
    const arn = res.Arn ?? "";
    const isRoot = arn.endsWith(":root");
    const isDeployer = arn.endsWith(`:user/${HOMEPAGE_DEPLOYER_USER_NAME}`);
    return NextResponse.json({
      configured: true,
      accessKeyIdPrefix,
      arn,
      accountId: res.Account,
      isRoot,
      isDeployer,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { configured: true, accessKeyIdPrefix, error: message },
      { status: 200 },
    );
  }
}

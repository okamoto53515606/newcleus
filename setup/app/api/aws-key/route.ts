import { NextRequest, NextResponse } from "next/server";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { writeEnvValues } from "@/lib/env";
import { startPhase, completePhase, addPhaseError } from "@/lib/setup-state";

/** Step 0: AWS アクセスキーを .env に保存し、接続テストを行う */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { accessKeyId, secretAccessKey, region } = body;

  if (!accessKeyId || !secretAccessKey) {
    return NextResponse.json(
      { error: "アクセスキーとシークレットキーは必須です" },
      { status: 400 }
    );
  }

  const awsRegion = region || "ap-northeast-1";

  startPhase("setup0", "AWS root キー接続テスト中");

  // 接続テスト: STS GetCallerIdentity
  try {
    const sts = new STSClient({
      region: awsRegion,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    const identity = await sts.send(new GetCallerIdentityCommand({}));

    // .env に書き込み
    writeEnvValues({
      AWS_ACCESS_KEY_ID: accessKeyId,
      AWS_SECRET_ACCESS_KEY: secretAccessKey,
      AWS_REGION: awsRegion,
    });

    completePhase(
      "setup0",
      `AWS root key verified via STS GetCallerIdentity, account ${identity.Account}`
    );

    return NextResponse.json({
      success: true,
      account: identity.Account,
      arn: identity.Arn,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "AWS 接続に失敗しました";
    addPhaseError("setup0", "sts-get-caller-identity", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

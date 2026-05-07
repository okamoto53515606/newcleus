import { NextRequest, NextResponse } from "next/server";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { readEnv } from "@/lib/env";
import { completePhase, addPhaseError } from "@/lib/setup-state";

/** Step 1a: Cognito に管理者ユーザーを作成する */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: "メールアドレスとパスワードは必須です" },
      { status: 400 }
    );
  }

  // パスワード強度チェック
  if (password.length < 8) {
    return NextResponse.json(
      { error: "パスワードは8文字以上にしてください" },
      { status: 400 }
    );
  }

  const env = readEnv();
  const userPoolId = env.get("COGNITO_USER_POOL_ID");
  if (!userPoolId) {
    return NextResponse.json(
      { error: "Cognito User Pool が未作成です。Step 1a の CDK デプロイを先に完了してください" },
      { status: 400 }
    );
  }

  const region = env.get("AWS_REGION") || "ap-northeast-1";

  try {
    const cognito = new CognitoIdentityProviderClient({
      region,
      credentials: {
        accessKeyId: env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: env.get("AWS_SECRET_ACCESS_KEY")!,
      },
    });

    // ユーザー作成
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          // why: newcleus は custom:role で認可を判定する。
          //      setup で作成するユーザーは必ず最上位の admin にする。
          { Name: "custom:role", Value: "admin" },
        ],
        MessageAction: "SUPPRESS", // 招待メールを送らない
      })
    );

    // パスワードを設定（仮パスワードではなく永続パスワードに）
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      })
    );

    // 完了フラグ: setup-state.json に記録
    completePhase(
      "setup1a",
      `管理者ユーザー (${email}) を作成完了。Hosted UI で 2FA (TOTP) 設定が必要`
    );

    return NextResponse.json({
      success: true,
      message: `管理者ユーザー (${email}) を作成しました。Cognito Hosted UI で 2FA（TOTP）の設定を行ってください。`,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "ユーザー作成に失敗しました";
    addPhaseError("setup1a", "cognito-create-user", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

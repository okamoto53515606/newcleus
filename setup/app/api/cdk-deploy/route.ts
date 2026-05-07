import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { resolve } from "path";
import { readEnv, writeEnvValues } from "@/lib/env";
import { startPhase, completePhase, addPhaseError } from "@/lib/setup-state";

/** Step 1a: CDK デプロイを実行して Cognito + IAM リソースを作成 */
export async function POST() {
  const env = readEnv();

  if (!env.get("AWS_ACCESS_KEY_ID") || !env.get("AWS_SECRET_ACCESS_KEY")) {
    return NextResponse.json(
      { error: "AWS キーが設定されていません。Step 0 を完了してください" },
      { status: 400 }
    );
  }

  // cdk.json はプロジェクトルートにあるため、ルートから実行する
  const projectRoot = resolve(process.cwd(), "..");

  startPhase("setup1a", "CDK bootstrap + deploy 実行中");

  try {
    // CDK bootstrap（初回のみ必要）
    execSync("npx cdk bootstrap", {
      cwd: projectRoot,
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: env.get("AWS_ACCESS_KEY_ID")!,
        AWS_SECRET_ACCESS_KEY: env.get("AWS_SECRET_ACCESS_KEY")!,
        AWS_REGION: env.get("AWS_REGION") || "ap-northeast-1",
      },
      stdio: "pipe",
      timeout: 300000, // 5分
    });

    // CDK deploy（setup1a は Cognito スタックのみ。InfraStack は setup1b で別途デプロイ）
    const output = execSync(
      "npx cdk deploy NewcleusCognitoStack --require-approval never --outputs-file cdk-outputs.json",
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: env.get("AWS_ACCESS_KEY_ID")!,
          AWS_SECRET_ACCESS_KEY: env.get("AWS_SECRET_ACCESS_KEY")!,
          AWS_REGION: env.get("AWS_REGION") || "ap-northeast-1",
        },
        stdio: "pipe",
        timeout: 600000, // 10分
      }
    );

    // CDK outputs からリソース情報を取得して .env に書き込み
    const outputsPath = resolve(projectRoot, "cdk-outputs.json");
    const { readFileSync } = await import("fs");
    const outputs = JSON.parse(readFileSync(outputsPath, "utf-8"));

    const envUpdates: Record<string, string> = {};

    // 全スタックの Output を走査
    for (const stackOutputs of Object.values(outputs) as Record<string, string>[]) {
      for (const [key, value] of Object.entries(stackOutputs)) {
        if (key.includes("CognitoUserPoolId")) {
          envUpdates.COGNITO_USER_POOL_ID = value;
        }
        if (key.includes("CognitoClientId")) {
          envUpdates.COGNITO_CLIENT_ID = value;
        }
        if (key.includes("CognitoHostedUIDomain")) {
          envUpdates.COGNITO_DOMAIN = value;
        }
      }
    }

    if (Object.keys(envUpdates).length > 0) {
      writeEnvValues(envUpdates);
    }

    // CDK deploy は完了だが、Cognito ユーザー作成がまだなので in-progress のまま
    // comment だけ更新し、過去のエラーをクリア
    const { updatePhaseComment, clearPhaseErrors } = await import("@/lib/setup-state");
    clearPhaseErrors("setup1a");
    updatePhaseComment(
      "setup1a",
      `CDK deploy 完了。Cognito outputs: ${JSON.stringify(envUpdates)}。管理者ユーザー作成待ち`
    );

    return NextResponse.json({
      success: true,
      message: "CDK デプロイが完了しました",
      outputs: envUpdates,
      rawOutput: output.toString().slice(-1000),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "CDK デプロイに失敗しました";
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr: unknown }).stderr).slice(-2000)
        : "";
    addPhaseError("setup1a", "cdk-deploy", `${message} ${stderr}`.trim());
    return NextResponse.json(
      { error: message, details: stderr },
      { status: 500 }
    );
  }
}

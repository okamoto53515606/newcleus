import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { resolve } from "path";
import { readFileSync } from "fs";
import { readEnv, writeEnvValues } from "@/lib/env";
import {
  startPhase,
  completePhase,
  addPhaseError,
  clearPhaseErrors,
  updatePhaseComment,
} from "@/lib/setup-state";
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

/**
 * setup1b: NewcleusInfraStack デプロイ
 *
 * 処理の流れ:
 *   1. CDK bootstrap (ap-northeast-1)
 *   2. NewcleusInfraStack をデプロイ (DynamoDB, S3, Lambda, CloudFront)
 *   3. cdk-outputs.json からリソース情報を取得 → .env に書き込み
 *   4. Lambda 環境変数に CLOUDFRONT_DOMAIN を注入
 *      （循環依存回避のため CDK 内ではなくデプロイ後に SDK で注入）
 *   5. Cognito コールバック URL に CloudFront ドメインを追加
 *   6. setup-state.json を更新
 *
 * why (WAF 不要): blueprint §3 — newcleus では WAF は使わない。
 *
 * 注意: Docker ビルドを含むため 30〜60 分かかる場合があります。
 */
export async function POST(req: NextRequest) {
  // リクエストボディは不要になったが後方互換のため受け取る
  await req.json().catch(() => ({}));

  const env = readEnv();

  if (!env.get("AWS_ACCESS_KEY_ID") || !env.get("AWS_SECRET_ACCESS_KEY")) {
    return NextResponse.json(
      { error: "AWS キーが設定されていません。Step 0 を完了してください" },
      { status: 400 },
    );
  }

  const cognitoUserPoolId = env.get("COGNITO_USER_POOL_ID") ?? "";
  const cognitoClientId = env.get("COGNITO_CLIENT_ID") ?? "";
  const cognitoDomain = env.get("COGNITO_DOMAIN") ?? "";

  if (!cognitoUserPoolId || !cognitoClientId) {
    return NextResponse.json(
      { error: "Cognito 情報が見つかりません。Step 1a を完了してください" },
      { status: 400 },
    );
  }

  const projectRoot = resolve(process.cwd(), "..");
  const awsEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: env.get("AWS_ACCESS_KEY_ID")!,
    AWS_SECRET_ACCESS_KEY: env.get("AWS_SECRET_ACCESS_KEY")!,
    AWS_REGION: env.get("AWS_REGION") ?? "ap-northeast-1",
  };
  const execOpts = {
    cwd: projectRoot,
    env: awsEnv,
    stdio: "pipe" as const,
  };

  startPhase("setup1b", "InfraStack デプロイ開始");
  clearPhaseErrors("setup1b");

  try {
    // =========================================================
    // Step 1: CDK Bootstrap
    // =========================================================
    updatePhaseComment("setup1b", "CDK bootstrap を実行中...");
    execSync(
      `npx cdk bootstrap`,
      { ...execOpts, timeout: 300_000 },
    );

    // =========================================================
    // Step 2: NewcleusInfraStack デプロイ
    //
    // Docker ビルドを含むため 30〜60 分かかる場合があります。
    // =========================================================
    updatePhaseComment(
      "setup1b",
      "NewcleusInfraStack をデプロイ中（Docker ビルドを含むため時間がかかります）...",
    );

    const infraContextArgs = [
      `--context cognitoUserPoolId=${cognitoUserPoolId}`,
      `--context cognitoClientId=${cognitoClientId}`,
      `--context cognitoDomain=${cognitoDomain}`,
    ].join(" ");

    execSync(
      `npx cdk deploy NewcleusInfraStack --require-approval never --outputs-file cdk-outputs.json ${infraContextArgs}`,
      { ...execOpts, timeout: 3_600_000 }, // 60分（Docker ビルド込み）
    );

    // =========================================================
    // Step 3: .env にリソース情報を書き込む
    //
    // why: cdk-outputs.json はスタックが差分なしと判定された場合に
    //      書き換えられないことがある。フォールバックで CloudFormation
    //      DescribeStacks から直接取得して確実に値を取得する。
    // =========================================================
    let infraOutputs: Record<string, string> = {};
    try {
      const raw = JSON.parse(
        readFileSync(resolve(projectRoot, "cdk-outputs.json"), "utf-8"),
      );
      infraOutputs = raw?.NewcleusInfraStack ?? {};
    } catch {
      infraOutputs = {};
    }

    if (!infraOutputs["CloudFrontDomainName"]) {
      updatePhaseComment(
        "setup1b",
        "cdk-outputs.json から取得できなかったため CloudFormation から直接取得中...",
      );
      infraOutputs = await fetchInfraStackOutputs({
        region: awsEnv.AWS_REGION,
        accessKeyId: env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: env.get("AWS_SECRET_ACCESS_KEY")!,
      });
    }

    const envUpdates: Record<string, string> = {};

    const keyMap: Record<string, string> = {
      MediaBucketName: "S3_BUCKET_NAME",
      CloudFrontDomainName: "CLOUDFRONT_DOMAIN",
    };

    for (const [cdkKey, envKey] of Object.entries(keyMap)) {
      if (infraOutputs[cdkKey]) {
        envUpdates[envKey] = infraOutputs[cdkKey];
      }
    }

    // TABLE_PREFIX は固定値
    envUpdates["TABLE_PREFIX"] = "newcleus-";

    writeEnvValues(envUpdates);

    // =========================================================
    // Step 4: Lambda 環境変数に CLOUDFRONT_DOMAIN を注入
    //
    // why: CDK 内で distribution.distributionDomainName を Lambda env に直接入れると
    //      Lambda↔Distribution 間で CloudFormation 循環依存が発生するため、
    //      デプロイ完了後にここで SDK で後付け注入する。
    // =========================================================
    const lambdaFunctionName = "newcleus-app"; // cdk/lib/infra-stack.ts と同じ固定名
    const cfDomain = infraOutputs["CloudFrontDomainName"];
    if (cfDomain) {
      await upsertLambdaEnv({
        region: env.get("AWS_REGION") ?? "ap-northeast-1",
        accessKeyId: env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: env.get("AWS_SECRET_ACCESS_KEY")!,
        functionName: lambdaFunctionName,
        upsert: { CLOUDFRONT_DOMAIN: cfDomain },
      });
    }

    // =========================================================
    // Step 5: Cognito コールバック URL に CloudFront ドメインを追加
    // =========================================================
    const cloudfrontDomain = infraOutputs["CloudFrontDomainName"] ?? "";
    if (cloudfrontDomain) {
      await addCognitoCallbackUrl({
        region: env.get("AWS_REGION") ?? "ap-northeast-1",
        accessKeyId: env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: env.get("AWS_SECRET_ACCESS_KEY")!,
        userPoolId: cognitoUserPoolId,
        clientId: cognitoClientId,
        cloudfrontDomain,
      });
    }

    completePhase("setup1b", `InfraStack デプロイ完了。CloudFront: ${cloudfrontDomain}`);

    return NextResponse.json({
      success: true,
      message: "setup1b のデプロイが完了しました",
      cloudfrontDomain,
      envUpdates,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "CDK デプロイに失敗しました";
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr: unknown }).stderr).slice(-3000)
        : "";
    addPhaseError("setup1b", "cdk-deploy-1b", `${message}\n${stderr}`.trim());
    return NextResponse.json(
      { error: message, details: stderr },
      { status: 500 },
    );
  }
}

/**
 * why: cdk-outputs.json が無い / 古い場合でも正しい値を返すため、
 *      CloudFormation API から InfraStack の Outputs を直接取得する。
 */
async function fetchInfraStackOutputs(opts: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
  });
  const res = await cfn.send(
    new DescribeStacksCommand({ StackName: "NewcleusInfraStack" }),
  );
  const stack = res.Stacks?.[0];
  const result: Record<string, string> = {};
  for (const o of stack?.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue) result[o.OutputKey] = o.OutputValue;
  }
  return result;
}

/**
 * Cognito App Client のコールバック URL に CloudFront ドメインを追加する
 */
async function addCognitoCallbackUrl(opts: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  userPoolId: string;
  clientId: string;
  cloudfrontDomain: string;
}) {
  const client = new CognitoIdentityProviderClient({
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
  });

  // 既存の設定を取得
  const described = await client.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: opts.userPoolId,
      ClientId: opts.clientId,
    }),
  );

  const existingCallbacks = described.UserPoolClient?.CallbackURLs ?? [];
  const existingLogouts = described.UserPoolClient?.LogoutURLs ?? [];

  const newCallback = `https://${opts.cloudfrontDomain}/api/admin/auth/callback`;
  const newLogout = `https://${opts.cloudfrontDomain}/admin/login`;

  const updatedCallbacks = existingCallbacks.includes(newCallback)
    ? existingCallbacks
    : [...existingCallbacks, newCallback];

  const updatedLogouts = existingLogouts.includes(newLogout)
    ? existingLogouts
    : [...existingLogouts, newLogout];

  await client.send(
    new UpdateUserPoolClientCommand({
      UserPoolId: opts.userPoolId,
      ClientId: opts.clientId,
      CallbackURLs: updatedCallbacks,
      LogoutURLs: updatedLogouts,
      // 既存設定を維持（CallbackURLs / LogoutURLs 以外は変更しない）
      SupportedIdentityProviders:
        described.UserPoolClient?.SupportedIdentityProviders,
      AllowedOAuthFlows: described.UserPoolClient?.AllowedOAuthFlows,
      AllowedOAuthScopes: described.UserPoolClient?.AllowedOAuthScopes,
      AllowedOAuthFlowsUserPoolClient:
        described.UserPoolClient?.AllowedOAuthFlowsUserPoolClient,
    }),
  );
}

/**
 * Lambda 関数の環境変数に指定キーを upsert する（既存 env は保持）。
 *
 * 目的:
 *   CDK スタック内で distribution.distributionDomainName を Lambda env に直接
 *   入れると CloudFormation 循環依存が発生するため、デプロイ完了後にここで注入する。
 *   既存の env を取得してマージ更新することで、CDK が設定した他の env を壊さない。
 */
async function upsertLambdaEnv(opts: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  functionName: string;
  upsert: Record<string, string>;
}) {
  const client = new LambdaClient({
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
  });

  const current = await client.send(
    new GetFunctionConfigurationCommand({ FunctionName: opts.functionName }),
  );

  const merged = {
    ...(current.Environment?.Variables ?? {}),
    ...opts.upsert,
  };

  await client.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: opts.functionName,
      Environment: { Variables: merged },
    }),
  );
}

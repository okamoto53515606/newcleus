/**
 * 運用メニュー (/ops) と setup1b で共有する CDK 操作ヘルパー。
 *
 * why:
 *   1b は「初回セットアップ用」に動作確定済み。運用フェーズでアプリ再デプロイや
 *   WAF 変更を行う際に 1b を使い回すと、CDK Output の `AppDistributionDomain`
 *   (= default CloudFront ドメイン) で .env / Lambda env の CLOUDFRONT_DOMAIN
 *   を上書きしてしまい、独自ドメイン設定が巻き戻る。
 *   そのためここでは「独自ドメインに関わる値 (CLOUDFRONT_DOMAIN, Cognito
 *   Callback URL) には一切触れない」ことを保証する API を提供する。
 *   1b のロジックを巻き取らず、必要な小機能だけ独立した関数として切り出している。
 */

import { execSync, type ExecSyncOptions } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionCodeCommand,
} from "@aws-sdk/client-lambda";
import { WAFV2Client, ListWebACLsCommand } from "@aws-sdk/client-wafv2";
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from "@aws-sdk/client-cloudfront";
import {
  ECRClient,
  GetAuthorizationTokenCommand,
} from "@aws-sdk/client-ecr";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { readEnv, writeEnvValues } from "@/lib/env";
import { getAwsCreds, assertAwsCreds, type AwsCreds } from "@/lib/aws-creds";

/** 運用メニューが触ってよい .env キー（独自ドメイン関連は除外） */
const SAFE_ENV_KEYS = [
  "CLOUDFRONT_DEFAULT_DOMAIN",
  "S3_BUCKET_NAME",
  "STRIPE_WEBHOOK_PROXY_URL",
] as const;

/** Lambda 関数固定名（cdk/lib/infra-stack.ts と一致） */
export const LAMBDA_FUNCTIONS = [
  "newcleus-app",
  "newcleus-stripe-webhook-proxy",
] as const;

/** プロジェクトルート (newcleus/) を絶対パスで返す */
export function getProjectRoot(): string {
  return resolve(process.cwd(), "..");
}

/** AWS 認証情報を取り、未設定なら例外を投げる */
export function loadCreds(): AwsCreds {
  const creds = getAwsCreds();
  assertAwsCreds(creds);
  return creds;
}

/** child_process.execSync 共通オプション生成（region 上書き可） */
export function buildExecOpts(
  creds: AwsCreds,
  regionOverride?: string,
): ExecSyncOptions {
  return {
    cwd: getProjectRoot(),
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: creds.accessKeyId,
      AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
      AWS_REGION: regionOverride ?? creds.region,
    },
    stdio: "pipe",
  };
}

/**
 * NewcleusInfraStack の Outputs を CloudFormation API から取得する。
 * why: cdk-outputs.json は cdk deploy が差分なし時に更新されないことがあり信用できない。
 */
export async function fetchInfraStackOutputs(
  creds: AwsCreds,
): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
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
 * NewcleusWafStack の WebACL ARN を取得する（存在しなければ空文字）。
 *
 * why:
 *   InfraStack を再デプロイするとき context wafAclArn を空で渡すと CloudFront
 *   から WebACL の関連付けが外れてしまう。WAF を変更しない再デプロイでは
 *   現行の ARN をそのまま渡し直す必要がある。
 */
export async function resolveCurrentWafAclArn(
  creds: AwsCreds,
): Promise<string> {
  // まずスタックの Output を試す
  try {
    const cfn = new CloudFormationClient({
      region: "us-east-1",
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    });
    const res = await cfn.send(
      new DescribeStacksCommand({ StackName: "NewcleusWafStack" }),
    );
    const stack = res.Stacks?.[0];
    const out = stack?.Outputs?.find((o) => o.OutputKey === "WebAclArn");
    if (out?.OutputValue) return out.OutputValue;
  } catch {
    // スタックが存在しない場合は WAFv2 ListWebACLs にフォールバック
  }

  try {
    const waf = new WAFV2Client({
      region: "us-east-1",
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    });
    const listed = await waf.send(
      new ListWebACLsCommand({ Scope: "CLOUDFRONT", Limit: 100 }),
    );
    const matched = listed.WebACLs?.find((acl) => acl.Name === "newcleus-app-waf");
    if (matched?.ARN) return matched.ARN;
  } catch {
    // no-op
  }
  return "";
}

/**
 * Lambda 関数の env を upsert する（既存値は維持）。
 *
 * why:
 *   運用メニューでは独自ドメイン (CLOUDFRONT_DOMAIN) に絶対触らない。
 *   呼び出し側で SAFE_ENV_KEYS に該当する値だけ渡すよう徹底する。
 */
export async function upsertLambdaEnv(opts: {
  creds: AwsCreds;
  functionName: string;
  upsert: Record<string, string>;
}): Promise<void> {
  const client = new LambdaClient({
    region: opts.creds.region,
    credentials: {
      accessKeyId: opts.creds.accessKeyId,
      secretAccessKey: opts.creds.secretAccessKey,
    },
  });

  // why: ops メニューの「アプリコード更新」(UpdateFunctionCode) と並行で
  //      env 同期 (UpdateFunctionConfiguration) が走ると Lambda 側で
  //      `ResourceConflictException: concurrent update operation` が確定で出る。
  //      呼び出し側で順序保証するのは難しいので、ここで
  //      LastUpdateStatus=Successful になるのを待ってから更新し、
  //      競合が出たら指数バックオフで再試行する。
  const waitUntilIdle = async (): Promise<typeof current> => {
    let current = await client.send(
      new GetFunctionConfigurationCommand({ FunctionName: opts.functionName }),
    );
    const deadline = Date.now() + 180_000; // 最大3分
    while (current.LastUpdateStatus === "InProgress" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      current = await client.send(
        new GetFunctionConfigurationCommand({ FunctionName: opts.functionName }),
      );
    }
    return current;
  };

  let current = await waitUntilIdle();
  const merged = { ...(current.Environment?.Variables ?? {}), ...opts.upsert };

  // ConflictException がギリギリのレースで発生し得るため最大 5 回リトライ。
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await client.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: opts.functionName,
          Environment: { Variables: merged },
        }),
      );
      return;
    } catch (e) {
      lastErr = e;
      const name = (e as { name?: string })?.name ?? "";
      if (name !== "ResourceConflictException") throw e;
      // 競合：再度 idle まで待ってから次の試行へ
      await new Promise((r) => setTimeout(r, 4000 + attempt * 2000));
      await waitUntilIdle();
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? "upsertLambdaEnv: unknown error"));
}

/**
 * cdk-outputs.json から `NewcleusInfraStack` の OutputValue を取り、
 * SAFE_ENV_KEYS に対応する .env キーだけを書き戻す。
 * 独自ドメイン (CLOUDFRONT_DOMAIN) は触らない。
 */
export function syncSafeEnvFromOutputs(outputs: Record<string, string>): {
  written: Record<string, string>;
} {
  const keyMap: Record<string, (typeof SAFE_ENV_KEYS)[number]> = {
    AppDistributionDomain: "CLOUDFRONT_DEFAULT_DOMAIN",
    MediaBucketName: "S3_BUCKET_NAME",
    StripeWebhookProxyUrl: "STRIPE_WEBHOOK_PROXY_URL",
  };
  const written: Record<string, string> = {};
  for (const [cdkKey, envKey] of Object.entries(keyMap)) {
    if (outputs[cdkKey]) written[envKey] = outputs[cdkKey];
  }
  if (Object.keys(written).length > 0) writeEnvValues(written);
  return { written };
}

/**
 * 運用メニュー用：.env から「独自ドメインを含まない安全な値」のみ Lambda 両方に push。
 *
 * why:
 *   `CLOUDFRONT_DOMAIN` (独自ドメイン) は domain-rewrite-all 専管。
 *   ここでは distribution id 等 .env と Lambda env のドリフトを解消するだけにする。
 */
export async function syncSafeEnvToLambdas(
  creds: AwsCreds,
): Promise<{ functionName: string; pushed: Record<string, string> }[]> {
  const env = readEnv();
  const upsert: Record<string, string> = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = env.get(k);
    if (v) upsert[k] = v;
  }
  const results: { functionName: string; pushed: Record<string, string> }[] = [];
  for (const fn of LAMBDA_FUNCTIONS) {
    await upsertLambdaEnv({ creds, functionName: fn, upsert });
    results.push({ functionName: fn, pushed: upsert });
  }
  return results;
}

/**
 * `cdk deploy NewcleusInfraStack --exclusively` を実行するための
 * context 引数を組み立てる。
 *
 * why:
 *   InfraStack は context wafAclArn / cognito* / jwtSecret を必須で要求する。
 *   1b と異なり運用メニューは `.env` に保存済みの値からこれらを再構築する。
 */
export function buildInfraContextArgs(opts: {
  wafAclArn: string;
}): string {
  const env = readEnv();
  const cognitoUserPoolId = env.get("COGNITO_USER_POOL_ID") ?? "";
  const cognitoClientId = env.get("COGNITO_CLIENT_ID") ?? "";
  const cognitoDomain = env.get("COGNITO_DOMAIN") ?? "";
  const jwtSecret = env.get("JWT_SECRET") ?? "";
  if (!cognitoUserPoolId || !cognitoClientId || !cognitoDomain || !jwtSecret) {
    throw new Error(
      ".env に COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID / COGNITO_DOMAIN / JWT_SECRET が揃っていません",
    );
  }
  return [
    `--context wafAclArn=${opts.wafAclArn}`,
    `--context cognitoUserPoolId=${cognitoUserPoolId}`,
    `--context cognitoClientId=${cognitoClientId}`,
    `--context cognitoDomain=${cognitoDomain}`,
    `--context jwtSecret=${jwtSecret}`,
  ].join(" ");
}

/** cdk-outputs.json をパースして NewcleusInfraStack の出力を返す（失敗時は空） */
export function readCdkOutputsFile(): Record<string, string> {
  const path = resolve(getProjectRoot(), "cdk-outputs.json");
  if (!existsSync(path)) return {};
  try {
    const json = JSON.parse(readFileSync(path, "utf-8"));
    return json?.NewcleusInfraStack ?? {};
  } catch {
    return {};
  }
}

/**
 * `cdk deploy` を同期実行する薄いラッパ（タイムアウトとログ取り回し用）。
 * stderr を呼び出し側で扱いやすくするため stdio=pipe を強制。
 */
export function runCdk(
  args: string,
  opts: ExecSyncOptions,
  timeoutMs: number,
): void {
  execSync(`npx cdk ${args}`, { ...opts, timeout: timeoutMs });
}

// =====================================================================
// SDK ベースの運用ヘルパー（CDK を介さず直接 CloudFront / Lambda を叩く）
// =====================================================================
//
// why:
//   InfraStack を CDK で再 deploy すると、setup2b で SDK 直接書込みした
//   独自ドメイン (Aliases / ViewerCertificate) と WebACLId が CDK の
//   「期待状態（=空）」で上書きされてしまう。運用フェーズでは独自ドメインを
//   守るため、CDK を介さずピンポイントに Distribution / Lambda を更新する。
//   これにより:
//     - WAF 切替: WebACLId だけ書換 → alias / Lambda 不変
//     - アプリコード更新: ECR push + UpdateFunctionCode → CloudFront 不変
//
//   CDK のソース・オブ・トゥルースとの整合性については、次回 CDK deploy 時に
//   テンプレート差分があれば CDK 側で正しく上書き、無ければ何もしない（CFN は
//   ドリフトを自動矯正しない）ため、運用上の問題は出ない。

/** CloudFront Distribution の WebACLId をピンポイントで書き換える */
export async function setCloudFrontWebAcl(opts: {
  creds: AwsCreds;
  distributionId: string;
  webAclArn: string; // 空文字なら detach
}): Promise<{ previousWebAclId: string; newWebAclId: string }> {
  const cf = new CloudFrontClient({
    region: "us-east-1",
    credentials: {
      accessKeyId: opts.creds.accessKeyId,
      secretAccessKey: opts.creds.secretAccessKey,
    },
  });
  const cur = await cf.send(
    new GetDistributionConfigCommand({ Id: opts.distributionId }),
  );
  const config = cur.DistributionConfig;
  const ifMatch = cur.ETag;
  if (!config || !ifMatch) {
    throw new Error("CloudFront DistributionConfig 取得に失敗");
  }
  const previousWebAclId = config.WebACLId ?? "";
  config.WebACLId = opts.webAclArn;
  await cf.send(
    new UpdateDistributionCommand({
      Id: opts.distributionId,
      IfMatch: ifMatch,
      DistributionConfig: config,
    }),
  );
  return { previousWebAclId, newWebAclId: opts.webAclArn };
}

/** AWS Account ID を取得（ECR レジストリ URI 構築用） */
export async function fetchAccountId(creds: AwsCreds): Promise<string> {
  const sts = new STSClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
  const r = await sts.send(new GetCallerIdentityCommand({}));
  if (!r.Account) throw new Error("STS GetCallerIdentity に失敗");
  return r.Account;
}

/**
 * Docker イメージをビルドして ECR にプッシュし、imageUri を返す。
 *
 * why:
 *   CDK asset と同じ ECR (cdk-hnb659fds-container-assets-<acct>-<region>) を
 *   間借りする。これなら Lambda execution role に追加の ECR 権限を与える必要が
 *   なく、CDK が管理する Lifecycle にも干渉しない。タグは CDK が使う sha256
 *   と衝突しないよう "ops-<unix秒>" を採用する。
 */
export async function buildAndPushAppImage(
  creds: AwsCreds,
  log: (line: string) => void,
): Promise<{ imageUri: string; tag: string }> {
  const accountId = await fetchAccountId(creds);
  const region = creds.region;
  const repoName = `cdk-hnb659fds-container-assets-${accountId}-${region}`;
  const registry = `${accountId}.dkr.ecr.${region}.amazonaws.com`;
  const tag = `ops-${Math.floor(Date.now() / 1000)}`;
  const imageUri = `${registry}/${repoName}:${tag}`;

  // 1. ECR 認証トークン取得 → docker login
  const ecr = new ECRClient({
    region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
  const auth = await ecr.send(new GetAuthorizationTokenCommand({}));
  const authData = auth.authorizationData?.[0];
  if (!authData?.authorizationToken) {
    throw new Error("ECR 認証トークン取得に失敗");
  }
  const decoded = Buffer.from(authData.authorizationToken, "base64").toString(
    "utf-8",
  );
  const password = decoded.split(":")[1] ?? "";

  const projectRoot = getProjectRoot();
  const execOpts: ExecSyncOptions = {
    cwd: projectRoot,
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: creds.accessKeyId,
      AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
      AWS_REGION: region,
      // why: Lambda は Docker v2 schema 2 manifest しか受け付けない。
      //      BuildKit (DOCKER_BUILDKIT=1) は OCI manifest で push してしまい
      //      "image manifest ... is not supported" エラーになるため、レガシー
      //      ビルダーに固定する。
      DOCKER_BUILDKIT: "0",
    },
    stdio: "pipe",
  };

  log(`[ops] docker login to ${registry}`);
  execSync(
    `echo "${password}" | docker login --username AWS --password-stdin ${registry}`,
    { ...execOpts, timeout: 60_000 },
  );

  // 2. docker build (CDK が使うのと同じプロジェクトルートの Dockerfile)
  log(`[ops] docker build (linux/amd64) -> ${imageUri}`);
  execSync(
    `docker build --platform linux/amd64 -t ${imageUri} -f Dockerfile .`,
    { ...execOpts, timeout: 1_800_000 },
  );

  // 3. push
  log(`[ops] docker push ${imageUri}`);
  execSync(`docker push ${imageUri}`, {
    ...execOpts,
    timeout: 600_000,
  });

  return { imageUri, tag };
}

/**
 * Lambda の image を更新する。Function URL / 環境変数 / IAM は不変。
 */
export async function updateLambdaImage(opts: {
  creds: AwsCreds;
  functionName: string;
  imageUri: string;
}): Promise<void> {
  const client = new LambdaClient({
    region: opts.creds.region,
    credentials: {
      accessKeyId: opts.creds.accessKeyId,
      secretAccessKey: opts.creds.secretAccessKey,
    },
  });
  await client.send(
    new UpdateFunctionCodeCommand({
      FunctionName: opts.functionName,
      ImageUri: opts.imageUri,
      Publish: false,
    }),
  );
}

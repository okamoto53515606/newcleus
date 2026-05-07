/**
 * setup1c-iam: IAM ユーザー newcleus-deployer を作成し、.env の AWS キーを差し替える API
 *
 * 目的 (why):
 *   setup0 で投入した root アクセスキーは「AWS アカウント全権」を握るため、
 *   漏洩・事故時の被害が致命的。newcleus 関連リソースだけ操作できる専用 IAM ユーザーに
 *   切り替え、root キーは後続手順で無効化する。セットアップを終えたユーザーが
 *   「セキュリティ対応を忘れる」ことを防ぐため、ボタン1つで自動化する。
 *
 * ポリシー付与方式 (why カスタマー管理ポリシーを採用したか):
 *   IAM ユーザーのインラインポリシーは合計 2,048 バイト制限。newcleus は
 *   CloudFormation/S3/DynamoDB/Lambda/CloudFront/WAF/Cognito/Secrets/ECR/Logs/IAM/
 *   Route 53/ACM/STS と権限が広く 4KB 超になるため、6,144 文字制限の
 *   "カスタマー管理ポリシー" (CreatePolicy + AttachUserPolicy) に切り替えた。
 *   ポリシー本体を更新する場合は CreatePolicyVersion で新バージョンを作り
 *   既定バージョンに切り替える。バージョンは最大5件までなので古いものを掃除する。
 *
 * 動作:
 *   1. 現在の .env AWS キーで IAM/STS クライアントを作成し AccountId を取得
 *   2. newcleus-deployer ユーザーが既にあれば再利用、無ければ CreateUser
 *   3. カスタマー管理ポリシー (newcleus-deployer-policy) を作成 or 新バージョン作成
 *   4. AttachUserPolicy で割り当て (idempotent)
 *   5. 既存インラインポリシーが残っていれば DeleteUserPolicy で除去 (旧仕様の掃除)
 *   6. 既存アクセスキーを全削除 → CreateAccessKey で新規発行
 *   7. .env に書き戻し → STS GetCallerIdentity でリトライしながら検証
 *
 * 注意:
 *   - .env 書き換え後は setup プロセス再起動不要。readEnv() は毎回ファイルを読むため。
 *   - このエンドポイントは root キー or 既存 deployer キーで叩ける。
 */

import { NextResponse } from "next/server";
import {
  IAMClient,
  CreateUserCommand,
  GetUserCommand,
  CreatePolicyCommand,
  CreatePolicyVersionCommand,
  GetPolicyCommand,
  ListPolicyVersionsCommand,
  DeletePolicyVersionCommand,
  AttachUserPolicyCommand,
  ListAttachedUserPoliciesCommand,
  ListUserPoliciesCommand,
  DeleteUserPolicyCommand,
  ListAccessKeysCommand,
  DeleteAccessKeyCommand,
  CreateAccessKeyCommand,
} from "@aws-sdk/client-iam";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { readEnv, writeEnvValues } from "@/lib/env";
import {
  HOMEPAGE_DEPLOYER_POLICY_DOCUMENT,
  HOMEPAGE_DEPLOYER_POLICY_NAME,
  HOMEPAGE_DEPLOYER_USER_NAME,
} from "@/lib/newcleus-deployer-policy";
import { startPhase, addPhaseError, updatePhaseComment } from "@/lib/setup-state";

export async function POST() {
  const env = readEnv();
  const accessKeyId = env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = env.get("AWS_SECRET_ACCESS_KEY");
  const region = env.get("AWS_REGION") ?? "ap-northeast-1";

  if (!accessKeyId || !secretAccessKey) {
    return NextResponse.json(
      { error: "AWS キーが設定されていません (.env 要確認)" },
      { status: 400 },
    );
  }

  startPhase("setup1c-iam", "IAM ユーザー newcleus-deployer を作成中...");

  const credentials = { accessKeyId, secretAccessKey };
  const iam = new IAMClient({ region, credentials });
  const sts = new STSClient({ region, credentials });

  try {
    // ---------------------------------------------------------------
    // 0. AccountId を取得 (ポリシー ARN 構築に必要)
    // ---------------------------------------------------------------
    const callerIdentity = await sts.send(new GetCallerIdentityCommand({}));
    const accountId = callerIdentity.Account;
    if (!accountId) throw new Error("AWS AccountId を取得できませんでした");
    const policyArn = `arn:aws:iam::${accountId}:policy/${HOMEPAGE_DEPLOYER_POLICY_NAME}`;

    // ---------------------------------------------------------------
    // 1. ユーザーの存在確認 / 作成
    //    why: CreateUser は既存だと EntityAlreadyExists を投げるので GetUser で先に見る。
    // ---------------------------------------------------------------
    let userCreated = false;
    try {
      await iam.send(new GetUserCommand({ UserName: HOMEPAGE_DEPLOYER_USER_NAME }));
      updatePhaseComment(
        "setup1c-iam",
        `既存の IAM ユーザー ${HOMEPAGE_DEPLOYER_USER_NAME} を使用します`,
      );
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === "NoSuchEntityException" || name === "NoSuchEntity") {
        await iam.send(
          new CreateUserCommand({ UserName: HOMEPAGE_DEPLOYER_USER_NAME }),
        );
        userCreated = true;
        updatePhaseComment(
          "setup1c-iam",
          `IAM ユーザー ${HOMEPAGE_DEPLOYER_USER_NAME} を作成しました`,
        );
      } else {
        throw err;
      }
    }

    // ---------------------------------------------------------------
    // 2. カスタマー管理ポリシー newcleus-deployer-policy を準備
    //    既存なら CreatePolicyVersion で新バージョンを既定にする。
    //    バージョンは最大 5 件なので、超えたら一番古い非既定バージョンを削除。
    // ---------------------------------------------------------------
    const policyDocumentJson = JSON.stringify(HOMEPAGE_DEPLOYER_POLICY_DOCUMENT);
    let policyExists = true;
    try {
      await iam.send(new GetPolicyCommand({ PolicyArn: policyArn }));
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === "NoSuchEntityException" || name === "NoSuchEntity") {
        policyExists = false;
      } else {
        throw err;
      }
    }

    if (!policyExists) {
      await iam.send(
        new CreatePolicyCommand({
          PolicyName: HOMEPAGE_DEPLOYER_POLICY_NAME,
          PolicyDocument: policyDocumentJson,
          Description: "newcleus-deployer 用 (newcleus 名前空間限定の権限)",
        }),
      );
      updatePhaseComment("setup1c-iam", "カスタマー管理ポリシーを作成しました");
    } else {
      // 既存のポリシー: バージョンが 5 に達していたら一番古い非既定を消す
      const versions = await iam.send(
        new ListPolicyVersionsCommand({ PolicyArn: policyArn }),
      );
      const list = versions.Versions ?? [];
      if (list.length >= 5) {
        const nonDefault = list
          .filter((v) => !v.IsDefaultVersion && v.VersionId)
          .sort(
            (a, b) =>
              (a.CreateDate?.getTime() ?? 0) - (b.CreateDate?.getTime() ?? 0),
          );
        if (nonDefault[0]?.VersionId) {
          await iam.send(
            new DeletePolicyVersionCommand({
              PolicyArn: policyArn,
              VersionId: nonDefault[0].VersionId,
            }),
          );
        }
      }
      await iam.send(
        new CreatePolicyVersionCommand({
          PolicyArn: policyArn,
          PolicyDocument: policyDocumentJson,
          SetAsDefault: true,
        }),
      );
      updatePhaseComment("setup1c-iam", "ポリシーを最新バージョンに更新しました");
    }

    // ---------------------------------------------------------------
    // 3. ユーザーへポリシーをアタッチ (既にアタッチ済みでもエラーにはならないが
    //    ListAttachedUserPolicies で確認してログを明確にする)
    // ---------------------------------------------------------------
    const attached = await iam.send(
      new ListAttachedUserPoliciesCommand({
        UserName: HOMEPAGE_DEPLOYER_USER_NAME,
      }),
    );
    const alreadyAttached = (attached.AttachedPolicies ?? []).some(
      (p) => p.PolicyArn === policyArn,
    );
    if (!alreadyAttached) {
      await iam.send(
        new AttachUserPolicyCommand({
          UserName: HOMEPAGE_DEPLOYER_USER_NAME,
          PolicyArn: policyArn,
        }),
      );
    }

    // ---------------------------------------------------------------
    // 4. 旧仕様 (インラインポリシー) のクリーンアップ
    //    why: 以前の実装で PutUserPolicy 用に作った同名インラインが
    //         サイズ超過で残骸として残っているケースがあるため。
    // ---------------------------------------------------------------
    const inlineList = await iam.send(
      new ListUserPoliciesCommand({ UserName: HOMEPAGE_DEPLOYER_USER_NAME }),
    );
    for (const inlineName of inlineList.PolicyNames ?? []) {
      if (inlineName === HOMEPAGE_DEPLOYER_POLICY_NAME) {
        await iam.send(
          new DeleteUserPolicyCommand({
            UserName: HOMEPAGE_DEPLOYER_USER_NAME,
            PolicyName: inlineName,
          }),
        );
      }
    }

    // ---------------------------------------------------------------
    // 5. 既存アクセスキーを全削除 (IAM は 1 ユーザー最大 2 キー)
    // ---------------------------------------------------------------
    const listed = await iam.send(
      new ListAccessKeysCommand({ UserName: HOMEPAGE_DEPLOYER_USER_NAME }),
    );
    for (const key of listed.AccessKeyMetadata ?? []) {
      if (!key.AccessKeyId) continue;
      await iam.send(
        new DeleteAccessKeyCommand({
          UserName: HOMEPAGE_DEPLOYER_USER_NAME,
          AccessKeyId: key.AccessKeyId,
        }),
      );
    }

    // ---------------------------------------------------------------
    // 6. 新規アクセスキー発行
    // ---------------------------------------------------------------
    const created = await iam.send(
      new CreateAccessKeyCommand({ UserName: HOMEPAGE_DEPLOYER_USER_NAME }),
    );
    const newAccessKeyId = created.AccessKey?.AccessKeyId;
    const newSecretAccessKey = created.AccessKey?.SecretAccessKey;
    if (!newAccessKeyId || !newSecretAccessKey) {
      throw new Error("アクセスキーの発行に失敗しました");
    }

    // ---------------------------------------------------------------
    // 7. .env を差し替え
    // ---------------------------------------------------------------
    writeEnvValues({
      AWS_ACCESS_KEY_ID: newAccessKeyId,
      AWS_SECRET_ACCESS_KEY: newSecretAccessKey,
    });

    // ---------------------------------------------------------------
    // 8. STS で動作確認 (IAM の反映に数秒のラグがあるためリトライ)
    // ---------------------------------------------------------------
    let identityArn: string | undefined;
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const stsCheck = new STSClient({
          region,
          credentials: {
            accessKeyId: newAccessKeyId,
            secretAccessKey: newSecretAccessKey,
          },
        });
        const res = await stsCheck.send(new GetCallerIdentityCommand({}));
        identityArn = res.Arn;
        break;
      } catch {
        // IAM のキーは eventual consistency。2 秒待って再試行。
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!identityArn) {
      throw new Error(
        "新しい IAM アクセスキーでの認証確認に失敗しました（最大20秒待機）。AWS コンソールで newcleus-deployer を確認してください。",
      );
    }

    updatePhaseComment(
      "setup1c-iam",
      `切り替え完了: ${identityArn}。次は root アクセスキーを無効化してください。`,
    );

    return NextResponse.json({
      success: true,
      userCreated,
      userName: HOMEPAGE_DEPLOYER_USER_NAME,
      newAccessKeyId,
      identityArn,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    addPhaseError("setup1c-iam", "create-iam-user", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

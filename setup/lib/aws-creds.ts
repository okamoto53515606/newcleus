import { readEnv } from "./env";

/**
 * setup API ルートで AWS 認証情報を取り出す共通ヘルパー。
 *
 * why:
 *   セットアップ画面の各 API は親ディレクトリの .env から AWS_ACCESS_KEY_ID /
 *   AWS_SECRET_ACCESS_KEY / AWS_REGION を都度読み出している。コピペ実装が散らばると
 *   キー名のタイポ・region のフォールバック先のズレが事故に直結するため、
 *   1 箇所に集約する。Route 53 Domains は us-east-1 固定など、サービスごとに
 *   region を上書きしたいケースもあるため、override 引数も持たせる。
 */
export interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export function getAwsCreds(regionOverride?: string): AwsCreds {
  const env = readEnv();
  const accessKeyId = env.get("AWS_ACCESS_KEY_ID") ?? "";
  const secretAccessKey = env.get("AWS_SECRET_ACCESS_KEY") ?? "";
  const region = regionOverride ?? env.get("AWS_REGION") ?? "ap-northeast-1";
  return { accessKeyId, secretAccessKey, region };
}

export function assertAwsCreds(creds: AwsCreds): void {
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error(
      "AWS 認証情報が .env に設定されていません。setup0 を完了してください。",
    );
  }
}

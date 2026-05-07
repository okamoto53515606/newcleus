import { NextResponse } from "next/server";
import { getEnvValue } from "@/lib/env";

/**
 * setup UI 用: CloudFront ドメインを返す。
 *
 * why: setup1b で書き込まれる CLOUDFRONT_DOMAIN は親ディレクトリの .env ファイル
 *      に保存される。setup アプリ自身の process.env には自動反映されないため、
 *      readEnv() 経由で .env を直接読みに行く必要がある。process.env から取得して
 *      しまうと初回起動時は常に空となり、setup1c のリンクが
 *      "xxx.cloudfront.net" のままになる。
 */
export async function GET() {
  return NextResponse.json({
    domain: getEnvValue("CLOUDFRONT_DOMAIN") || "",
  });
}

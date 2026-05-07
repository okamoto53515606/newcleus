import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";

/** Cognito の設定情報を返す（Hosted UI URL 構築用） */
export async function GET() {
  const env = readEnv();

  return NextResponse.json({
    userPoolId: env.get("COGNITO_USER_POOL_ID") || null,
    clientId: env.get("COGNITO_CLIENT_ID") || null,
    domain: env.get("COGNITO_DOMAIN") || null,
    region: env.get("AWS_REGION") || "ap-northeast-1",
  });
}

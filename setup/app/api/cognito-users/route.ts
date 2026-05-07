import { NextResponse } from "next/server";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { readEnv } from "@/lib/env";

/** Cognito User Pool のユーザー一覧を返す */
export async function GET() {
  const env = readEnv();
  const userPoolId = env.get("COGNITO_USER_POOL_ID");

  if (!userPoolId) {
    return NextResponse.json({ users: [] });
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

    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: 60,
      })
    );

    const users = (result.Users || []).map((u) => {
      const emailAttr = u.Attributes?.find((a) => a.Name === "email");
      return {
        username: u.Username,
        email: emailAttr?.Value || u.Username,
        status: u.UserStatus,
        enabled: u.Enabled,
        createdAt: u.UserCreateDate?.toISOString(),
        mfaEnabled: u.MFAOptions && u.MFAOptions.length > 0,
      };
    });

    return NextResponse.json({ users });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "ユーザー一覧の取得に失敗しました";
    return NextResponse.json({ users: [], error: message }, { status: 500 });
  }
}

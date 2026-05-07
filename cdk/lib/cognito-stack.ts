import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * Cognito スタック（newcleus 管理者認証用）
 *
 * - User Pool: 管理者・サイト管理者のみ（セルフサインアップ不可）
 * - カスタム属性: custom:role（admin | siteadmin）、custom:siteIds（JSON 文字列）
 * - Hosted UI: カスタムドメインは使用しない（xxx.cloudfront.net を使うため）
 * - MFA: 無効（blueprint §3 — Cognito の 2FA は不要）
 */
export class CognitoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================
    // 1. Cognito User Pool
    // =========================================================
    const userPool = new cognito.UserPool(this, 'AdminUserPool', {
      userPoolName: 'newcleus-admin-pool',
      selfSignUpEnabled: false, // 管理者のみ（Admin API で作成）
      signInAliases: { email: true },
      autoVerify: { email: true },
      // MFA 無効（blueprint §3 — Cognito の 2FA は不要）
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // カスタム属性: ロール・サイト ID
      // why: Cognito は "String" 型しか対応しないため JSON 文字列で siteIds を管理する
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
        siteIds: new cognito.StringAttribute({
          minLen: 2,
          maxLen: 2048, // JSON 文字列の最大長（サイト ID 配列を格納する）
          mutable: true,
        }),
      },
    });

    // =========================================================
    // 2. Cognito App Client（Hosted UI 用）
    // =========================================================
    const userPoolClient = userPool.addClient('AdminAppClient', {
      userPoolClientName: 'newcleus-admin-client',
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
        ],
        callbackUrls: [
          'http://localhost:3000/api/admin/auth/callback',  // setup アプリ（ローカル）
          'http://localhost:9002/api/admin/auth/callback',  // 本番アプリ（ローカル開発）
          // why: Lambda は Function URL ではなく CloudFront 経由で公開するため、
          //      本番の callback URL は CloudFront ドメインにする必要がある。
          'https://d1sax4j5hw821p.cloudfront.net/api/admin/auth/callback',
        ],
        logoutUrls: [
          'http://localhost:3000/admin/login',
          'http://localhost:9002/admin/login',
          'https://d1sax4j5hw821p.cloudfront.net/admin/login',
        ],
      },
      // ID トークンに custom:role, custom:siteIds を含める
      readAttributes: new cognito.ClientAttributes().withCustomAttributes('role', 'siteIds'),
      writeAttributes: new cognito.ClientAttributes().withCustomAttributes('role', 'siteIds'),
    });

    // =========================================================
    // 3. Cognito Hosted UI ドメイン
    // =========================================================
    const domain = userPool.addDomain('AdminHostedUIDomain', {
      cognitoDomain: {
        domainPrefix: `newcleus-admin-${this.account}`,
      },
    });

    // =========================================================
    // Outputs
    // =========================================================
    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID（.env の COGNITO_USER_POOL_ID に設定）',
    });

    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID（.env の COGNITO_CLIENT_ID に設定）',
    });

    new cdk.CfnOutput(this, 'CognitoHostedUIDomain', {
      value: domain.domainName,
      description: 'Cognito Hosted UI ドメインプレフィックス（.env の COGNITO_DOMAIN に設定）',
    });

    new cdk.CfnOutput(this, 'CognitoHostedUIUrl', {
      value: `https://${domain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI ベース URL',
    });
  }
}

#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { InfraStack } from '../lib/infra-stack';
import { CognitoStack } from '../lib/cognito-stack';

// why: Cognito の値は .env が正（setup 画面からのデプロイも .env を読む）。
//      CLI から素で `cdk deploy` すると --context を渡し忘れて空文字になり、
//      Lambda の COGNITO_DOMAIN / COGNITO_CLIENT_ID が欠落してログインが 500 になる。
//      その再発防止として、--context 未指定なら .env の値で補完する。
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

// why: WAF は newcleus では不要（blueprint §3 参照）。独自ドメインも不要。
const app = new cdk.App();

/** --context 指定が無い場合のみ .env の値で補完する（明示指定を優先）。 */
function fillContext(key: string, envKey: string): void {
  if (app.node.tryGetContext(key)) return;
  const value = process.env[envKey];
  if (value) app.node.setContext(key, value);
}

fillContext('cognitoUserPoolId', 'COGNITO_USER_POOL_ID');
fillContext('cognitoClientId', 'COGNITO_CLIENT_ID');
fillContext('cognitoDomain', 'COGNITO_DOMAIN');
fillContext('cloudfrontDomain', 'CLOUDFRONT_DOMAIN');

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-northeast-1',
};

/**
 * setup1a: Cognito User Pool（管理者認証）
 *
 * スタック名: NewcleusCognitoStack
 * リソース名プレフィックス: newcleus-
 */
new CognitoStack(app, 'NewcleusCognitoStack', { env });

/**
 * setup1b: メインインフラ（DynamoDB, S3, Lambda, CloudFront）
 *
 * スタック名: NewcleusInfraStack
 * リソース名プレフィックス: newcleus-
 *
 * CDK コンテキスト:
 *   --context cognitoUserPoolId=...
 *   --context cognitoClientId=...
 *   --context cognitoDomain=...
 */
new InfraStack(app, 'NewcleusInfraStack', { env });

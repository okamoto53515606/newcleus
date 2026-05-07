#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack';
import { CognitoStack } from '../lib/cognito-stack';

// why: WAF は newcleus では不要（blueprint §3 参照）。独自ドメインも不要。
const app = new cdk.App();

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

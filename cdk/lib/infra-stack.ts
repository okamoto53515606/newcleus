import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import { Construct } from 'constructs';

/**
 * newcleus InfraStack
 *
 * setup1b でデプロイするメインインフラスタック。
 *
 * リソース:
 *   - DynamoDB テーブル群（5 テーブル: sites / content-types / templates / items / users）
 *   - S3 メディアバケット
 *   - Lambda（Next.js + Lambda Web Adapter、Docker イメージ）
 *   - CloudFront ディストリビューション（Lambda origin + S3 /media/* behavior）
 *
 * CDK コンテキスト:
 *   - cognitoUserPoolId: Cognito User Pool ID (.env の COGNITO_USER_POOL_ID)
 *   - cognitoClientId:   Cognito Client ID (.env の COGNITO_CLIENT_ID)
 *   - cognitoDomain:     Cognito Hosted UI ドメインプレフィックス (.env の COGNITO_DOMAIN)
 *
 * why (WAF・独自ドメイン・2FA 不要): blueprint §3 参照。
 *   CDN キャッシュも無効（/media/* のみ 1 時間キャッシュ）。
 *
 * テーブル設計: docs/database-schema.md
 *
 * 全テーブル共通:
 *   - プレフィックス: newcleus-
 *   - 容量モード: PAY_PER_REQUEST
 *   - PITR: 有効
 *   - 削除ポリシー: RETAIN
 */
export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CDK context 値（setup1b の cdk-deploy-1b API から --context で渡される）
    const cognitoUserPoolId = (this.node.tryGetContext('cognitoUserPoolId') as string) ?? '';
    const cognitoClientId   = (this.node.tryGetContext('cognitoClientId') as string) ?? '';
    const cognitoDomain     = (this.node.tryGetContext('cognitoDomain') as string) ?? '';

    const prefix = 'newcleus-';

    // =========================================================
    // 1. sites テーブル
    //    PK: siteId
    // =========================================================
    const sitesTable = new dynamodb.Table(this, 'SitesTable', {
      tableName: `${prefix}sites`,
      partitionKey: { name: 'siteId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================
    // 2. content-types テーブル
    //    PK: siteId, SK: ctId
    // =========================================================
    const contentTypesTable = new dynamodb.Table(this, 'ContentTypesTable', {
      tableName: `${prefix}content-types`,
      partitionKey: { name: 'siteId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ctId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================
    // 3. templates テーブル
    //    PK: ctId, SK: templateId
    // =========================================================
    const templatesTable = new dynamodb.Table(this, 'TemplatesTable', {
      tableName: `${prefix}templates`,
      partitionKey: { name: 'ctId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================
    // 4. items テーブル
    //    PK: siteId, SK: itemId
    //    GSI1: siteContentTypeKey（= siteId#ctId）+ createdAt — CT フィルタ付き一覧
    //    GSI2: siteId + status — ステータス別一覧
    // =========================================================
    const itemsTable = new dynamodb.Table(this, 'ItemsTable', {
      tableName: `${prefix}items`,
      partitionKey: { name: 'siteId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'itemId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1: コンテンツタイプ絞り込み + 作成日ソート
    itemsTable.addGlobalSecondaryIndex({
      indexName: 'items-by-site-content-type',
      partitionKey: { name: 'siteContentTypeKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: サイト内ステータス別一覧
    itemsTable.addGlobalSecondaryIndex({
      indexName: 'items-by-status',
      partitionKey: { name: 'siteId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // =========================================================
    // 5. S3 メディアバケット
    // =========================================================
    const mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: `${prefix}media-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================
    // 7. Lambda（Next.js + Lambda Web Adapter）
    //
    // プロジェクトルートの Dockerfile からビルド。
    // CDK deploy 時に Docker ビルド + ECR プッシュを自動実行。
    // =========================================================
    const appLambda = new lambda.DockerImageFunction(this, 'AppLambda', {
      functionName: 'newcleus-app',
      code: lambda.DockerImageCode.fromImageAsset(
        path.join(__dirname, '../..'),
        {
          platform: ecr_assets.Platform.LINUX_AMD64,
        },
      ),
      memorySize: 1024,
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(60),
      environment: {
        NODE_ENV: 'production',
        TABLE_PREFIX: prefix,
        S3_BUCKET_NAME: mediaBucket.bucketName,
        COGNITO_USER_POOL_ID: cognitoUserPoolId,
        COGNITO_CLIENT_ID: cognitoClientId,
        COGNITO_DOMAIN: cognitoDomain,
        // CLOUDFRONT_DOMAIN / CLOUDFRONT_DISTRIBUTION_ID は distribution 作成後
        // に setup API 経由で Lambda UpdateFunctionConfiguration で後付け注入す る。
        // why: Lambda → Distribution → LambdaFunctionUrl → Lambda の循環依存を避けるため。
      },
    });

    // DynamoDB 権限
    for (const table of [sitesTable, contentTypesTable, templatesTable, itemsTable]) {
      table.grantReadWriteData(appLambda);
    }

    // S3 権限（メディア読み書き）
    mediaBucket.grantReadWrite(appLambda);

    // CloudFront Invalidation 権限
    appLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [
        `arn:aws:cloudfront::${this.account}:distribution/*`,
      ],
    }));

    // Cognito 権限
    // why: admin-auth.ts は AdminGetUser で認証（全ロール共通）。
    //      テナント管理画面は ListUsers / AdminCreateUser / AdminUpdateUserAttributes /
    //      AdminDeleteUser を使用する。Lambda 実行ロールにまとめて付与する。
    appLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminDeleteUser',
      ],
      resources: [
        `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`,
      ],
    }));

    // Lambda Function URL（AWS_IAM 認証 → CloudFront OAC が署名）
    const appFunctionUrl = appLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // =========================================================
    // 8. CloudFront メディア用キャッシュポリシー（1 時間）
    //
    // why: blueprint §3 — CDN キャッシュはしない（/media/* のみ 1 時間キャッシュ）。
    //      /media/* 以外は CACHING_DISABLED を使うため独自キャッシュポリシーは不要。
    // =========================================================
    const mediaCachePolicy = new cloudfront.CachePolicy(this, 'MediaCachePolicy', {
      cachePolicyName: 'newcleus-media-cache',
      defaultTtl: cdk.Duration.hours(1),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.hours(1),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // =========================================================
    // 9. セキュリティレスポンスヘッダポリシー
    // =========================================================
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: 'newcleus-security-headers',
      comment: 'HSTS / nosniff / Referrer-Policy / Permissions-Policy / CORP',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          preload: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: false,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cross-Origin-Resource-Policy', value: 'same-site', override: false },
          { header: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups', override: false },
          {
            header: 'Permissions-Policy',
            value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
            override: false,
          },
          // why: S3 の `Server: AmazonS3` ヘッダをマスクしてバージョン情報漏洩を防ぐ
          { header: 'Server', value: 'CloudFront', override: true },
        ],
      },
    });

    // =========================================================
    // 10b. メディア専用レスポンスヘッダポリシー
    //
    // why: /media/* の画像は外部サイトへの embed.js 埋め込みや
    //      ローカル開発（localhost）からも fetch される。
    //      アプリ本体と同じ securityHeadersPolicy（CORP: same-site）を
    //      そのまま使うと、異なるオリジンからの画像読み込みが
    //      Cross-Origin-Resource-Policy ヘッダでブロックされる。
    //      メディアは公開アセットなので CORP: cross-origin が適切。
    // =========================================================
    const mediaSecurityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'MediaSecurityHeadersPolicy', {
      responseHeadersPolicyName: 'newcleus-media-security-headers',
      comment: 'CORP: cross-origin — 公開メディアを外部サイト・ローカルから読み込み可にする',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          preload: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          // why: cross-origin にすることで外部オリジン（embed.js 埋め込み先、localhost 開発環境）
          //      からの画像読み込みを許可する。same-site だとブロックされる。
          { header: 'Cross-Origin-Resource-Policy', value: 'cross-origin', override: true },
          { header: 'Server', value: 'CloudFront', override: true },
        ],
      },
      corsBehavior: {
        // why: TinyMCE 等のエディタが drawImage() で画像を扱う際に CORS が必要。
        //      allow-all-origins にすることで外部埋め込みサイトからも Access-Control を通す。
        accessControlAllowOrigins: ['*'],
        accessControlAllowMethods: ['GET', 'HEAD'],
        accessControlAllowHeaders: ['*'],
        accessControlMaxAge: cdk.Duration.seconds(600),
        originOverride: false,
      },
    });

    // =========================================================
    // 11. CloudFront ディストリビューション
    // =========================================================

    const lambdaOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(appFunctionUrl);
    const s3Origin     = origins.S3BucketOrigin.withOriginAccessControl(mediaBucket);

    const distribution = new cloudfront.Distribution(this, 'AppDistribution', {
      comment: 'newcleus app distribution',
      defaultBehavior: {
        // why: blueprint §3 — CDN キャッシュはしない（/media/* 以外はすべてキャッシュ無効）
        origin: lambdaOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: securityHeadersPolicy,
      },
      additionalBehaviors: {
        // /media/*: S3 OAC、1 時間キャッシュ（blueprint §3 の唯一のキャッシュ例外）
        // why: responseHeadersPolicy はメディア専用ポリシー（CORP: cross-origin）を使用。
        '/media/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: mediaCachePolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          responseHeadersPolicy: mediaSecurityHeadersPolicy,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      // why: IPv4 限定。WAF の IPSet を将来使う場合に備え IPv4 のみで統一。
      enableIpv6: false,
    });

    // CloudFront OAC → Lambda Function URL の権限付与
    // why: 2025/10 以降は InvokeFunctionUrl と InvokeFunction の両方が必要
    appLambda.addPermission('AllowCloudFrontInvokeFunctionUrl', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunctionUrl',
      sourceArn: distribution.distributionArn,
      functionUrlAuthType: lambda.FunctionUrlAuthType.AWS_IAM,
    });
    appLambda.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: distribution.distributionArn,
      invokedViaFunctionUrl: true,
    });

    // =========================================================
    // Outputs
    // =========================================================
    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: appLambda.functionName,
      description: 'Lambda 関数名（setup が CloudFront ドメインを後付け注入するために使用）',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionUrl', {
      value: appFunctionUrl.url,
      description: 'Lambda Function URL（CloudFront のオリジン）',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.distributionDomainName,
      description: 'CloudFront ドメイン（.env の CLOUDFRONT_DOMAIN に設定）',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID（.env の CLOUDFRONT_DISTRIBUTION_ID に設定）',
    });

    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: mediaBucket.bucketName,
      description: 'S3 メディアバケット名（.env の S3_BUCKET_NAME に設定）',
    });
  }
}

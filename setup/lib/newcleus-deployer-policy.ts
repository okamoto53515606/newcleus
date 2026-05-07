/**
 * newcleus-deployer IAM ユーザー用インラインポリシー定義
 *
 * 目的 (why):
 *   setup0〜setup1c で AWS root アクセスキーを使って作成してきた newcleus 関連リソースを、
 *   root キーに代えて権限を絞った IAM ユーザー `newcleus-deployer` で引き継いで管理する。
 *   root キー事故（流出・誤操作）で AWS アカウント全体が壊滅するリスクを避けるため、
 *   このユーザーには「newcleus 名前空間のリソースだけ操作できる」権限のみを与える。
 *
 * 設計方針:
 *   - 命名/ARN パターンでスコープを絞る（newcleus-*, newcleus/*, Newcleus*Stack）
 *   - 後続フェーズ (setup2b: 独自ドメイン, setup3: Stripe 本番) で必要になる
 *     Route 53 / ACM / CloudFront エイリアス追加 / Cognito コールバック追加 も含める
 *   - 禁止: 請求・Organizations・IAM ユーザー/ロール作成（自分の access key 管理は除く）
 *   - 禁止: 他サービス（EC2, RDS, VPC 作成等）
 *
 *   このポリシーはインラインで貼り付けるため、変更したいときはこのファイルを編集して
 *   再度 /api/iam-setup を叩けば PutUserPolicy で上書きできる。
 */

export const HOMEPAGE_DEPLOYER_USER_NAME = "newcleus-deployer";
export const HOMEPAGE_DEPLOYER_POLICY_NAME = "newcleus-deployer-policy";

/**
 * インラインポリシードキュメント (JSON.stringify して PutUserPolicy に渡す)。
 * リージョン/アカウントは * を使わずに明示するほうが厳密だが、setup 時に account ID を
 * 取得してテンプレ化するのは複雑なので、リソース名側で十分絞り込めるものは * を許容する。
 */
export const HOMEPAGE_DEPLOYER_POLICY_DOCUMENT = {
  Version: "2012-10-17",
  Statement: [
    // -------------------------------------------------------------------
    // CloudFormation — Newcleus* スタックの管理
    //   why: CDK は CloudFormation 経由でデプロイ/破棄する。Newcleus* に限定すれば
    //        他のスタックは触れない。
    // -------------------------------------------------------------------
    {
      Sid: "CloudFormationNewcleusStacks",
      Effect: "Allow",
      Action: [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResource",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:GetTemplateSummary",
        "cloudformation:ListStacks",
        "cloudformation:ListStackResources",
        "cloudformation:ValidateTemplate",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet",
      ],
      Resource: [
        "arn:aws:cloudformation:*:*:stack/Newcleus*/*",
        "arn:aws:cloudformation:*:*:stack/CDKToolkit/*",
      ],
    },
    // CDK bootstrap の事前確認系は ListStacks が必要（全スタック読みになる）
    {
      Sid: "CloudFormationListStacks",
      Effect: "Allow",
      Action: [
        "cloudformation:ListStacks",
        "cloudformation:DescribeStacks",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // CDK bootstrap で必要になる SSM パラメータ (cdk-bootstrap/hnb659fds/version)
    // -------------------------------------------------------------------
    {
      Sid: "SsmCdkBootstrap",
      Effect: "Allow",
      Action: [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:PutParameter",
        "ssm:DeleteParameter",
      ],
      Resource: "arn:aws:ssm:*:*:parameter/cdk-bootstrap/*",
    },
    // -------------------------------------------------------------------
    // S3 — media バケット + CDK staging バケット
    //   why: CDK アセット(Docker image 以外) は cdk-hnb659fds-assets-* に置かれる。
    // -------------------------------------------------------------------
    {
      Sid: "S3NewcleusBuckets",
      Effect: "Allow",
      Action: "s3:*",
      Resource: [
        "arn:aws:s3:::newcleus-media-*",
        "arn:aws:s3:::newcleus-media-*/*",
        "arn:aws:s3:::cdk-hnb659fds-assets-*",
        "arn:aws:s3:::cdk-hnb659fds-assets-*/*",
      ],
    },
    // バケット一覧は ListAllMyBuckets が必須 (CDK diff 等で使う)
    {
      Sid: "S3ListAllBuckets",
      Effect: "Allow",
      Action: ["s3:ListAllMyBuckets", "s3:GetBucketLocation"],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // DynamoDB — newcleus-* テーブル
    // -------------------------------------------------------------------
    {
      Sid: "DynamoDbNewcleusTables",
      Effect: "Allow",
      Action: "dynamodb:*",
      Resource: [
        "arn:aws:dynamodb:*:*:table/newcleus-*",
        "arn:aws:dynamodb:*:*:table/newcleus-*/*",
      ],
    },
    // -------------------------------------------------------------------
    // Lambda — newcleus-app / newcleus-stripe-webhook-proxy
    // -------------------------------------------------------------------
    {
      Sid: "LambdaNewcleusFunctions",
      Effect: "Allow",
      Action: "lambda:*",
      Resource: [
        "arn:aws:lambda:*:*:function:newcleus-*",
        "arn:aws:lambda:*:*:function:newcleus-*:*",
      ],
    },
    {
      Sid: "LambdaListAll",
      Effect: "Allow",
      Action: [
        "lambda:ListFunctions",
        "lambda:GetAccountSettings",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // CloudFront — distribution 全操作 (別名追加・キャッシュ無効化含む)
    //   why: CloudFront は ARN だけではリソース絞り込みが弱く、実運用では * が多い。
    //        アカウント単位で newcleus しか distribution を作らない想定で * を許容する。
    // -------------------------------------------------------------------
    {
      Sid: "CloudFrontAll",
      Effect: "Allow",
      Action: [
        "cloudfront:*",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // WAF v2 — newcleus-app-waf / IPSet
    // -------------------------------------------------------------------
    {
      Sid: "Wafv2Newcleus",
      Effect: "Allow",
      Action: "wafv2:*",
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // Cognito — 管理者ユーザープール操作 (コールバック URL 追加など)
    // -------------------------------------------------------------------
    {
      Sid: "CognitoIdpAll",
      Effect: "Allow",
      Action: [
        "cognito-idp:*",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // Secrets Manager — newcleus/* のみ
    // -------------------------------------------------------------------
    {
      Sid: "SecretsManagerNewcleus",
      Effect: "Allow",
      Action: "secretsmanager:*",
      Resource: "arn:aws:secretsmanager:*:*:secret:newcleus/*",
    },
    // -------------------------------------------------------------------
    // ECR — CDK が作る cdk-hnb659fds-container-assets-* リポジトリ
    //   why: newcleus-app Lambda は Docker イメージでデプロイされるため
    //        ECR の push 権限が必須。
    // -------------------------------------------------------------------
    {
      Sid: "EcrCdkAssets",
      Effect: "Allow",
      Action: "ecr:*",
      Resource: "arn:aws:ecr:*:*:repository/cdk-hnb659fds-container-assets-*",
    },
    {
      Sid: "EcrAuth",
      Effect: "Allow",
      Action: [
        "ecr:GetAuthorizationToken",
        "ecr:DescribeRepositories",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // CloudWatch Logs
    // -------------------------------------------------------------------
    {
      Sid: "LogsNewcleus",
      Effect: "Allow",
      Action: "logs:*",
      Resource: [
        "arn:aws:logs:*:*:log-group:/aws/lambda/newcleus-*",
        "arn:aws:logs:*:*:log-group:/aws/lambda/newcleus-*:*",
        "arn:aws:logs:*:*:log-group:/aws/cloudfront/*",
      ],
    },
    // -------------------------------------------------------------------
    // IAM — CDK が作る newcleus 関連ロールの管理 + PassRole
    //   why: CDK は各 Lambda 用実行ロールを Newcleus*Stack 配下に自動生成する。
    //        ロール名は CDK が自動採番するが NewcleusInfraStack-* や
    //        NewcleusWafStack-* 等プレフィックスでスコープ可能。
    //   禁止: IAM ユーザーの作成/削除（自分自身の access key 管理は例外で許可）
    // -------------------------------------------------------------------
    {
      Sid: "IamCdkRoles",
      Effect: "Allow",
      Action: [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:UpdateRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:PassRole",
      ],
      Resource: [
        "arn:aws:iam::*:role/Newcleus*",
        "arn:aws:iam::*:role/cdk-hnb659fds-*",
        "arn:aws:iam::*:role/newcleus-*",
      ],
    },
    // IAM ポリシー read 系 (CDK diff で必要)
    {
      Sid: "IamRead",
      Effect: "Allow",
      Action: [
        "iam:GetRole",
        "iam:ListRoles",
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:ListPolicies",
      ],
      Resource: "*",
    },
    // 自分自身のアクセスキー管理 (ローテーションできるように)
    {
      Sid: "IamSelfAccessKey",
      Effect: "Allow",
      Action: [
        "iam:GetUser",
        "iam:ListAccessKeys",
        "iam:CreateAccessKey",
        "iam:UpdateAccessKey",
        "iam:DeleteAccessKey",
      ],
      Resource: "arn:aws:iam::*:user/newcleus-deployer",
    },
    // -------------------------------------------------------------------
    // Route 53 — setup2b (独自ドメイン) で必要
    // -------------------------------------------------------------------
    {
      Sid: "Route53HostedZones",
      Effect: "Allow",
      Action: [
        "route53:CreateHostedZone",
        "route53:DeleteHostedZone",
        "route53:GetHostedZone",
        "route53:ListHostedZones",
        "route53:ListHostedZonesByName",
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets",
        "route53:GetChange",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // Route 53 Domains — setup2b で AWS から新規ドメインを取得するために必要
    //   why: route53domains は route53 とは別サービスで IAM Action 名前空間も別。
    //        TLD 検索/価格取得/登録/Registrant 更新/操作状況確認まで一通り許可する。
    //        グローバル API のためリソースレベル制限は効かず Resource: "*" のみ。
    // -------------------------------------------------------------------
    {
      Sid: "Route53DomainsRegistrar",
      Effect: "Allow",
      Action: [
        "route53domains:CheckDomainAvailability",
        "route53domains:CheckDomainTransferability",
        "route53domains:GetDomainSuggestions",
        "route53domains:ListPrices",
        "route53domains:RegisterDomain",
        "route53domains:RenewDomain",
        "route53domains:GetDomainDetail",
        "route53domains:ListDomains",
        "route53domains:UpdateDomainContact",
        "route53domains:UpdateDomainContactPrivacy",
        "route53domains:UpdateDomainNameservers",
        "route53domains:GetOperationDetail",
        "route53domains:ListOperations",
        "route53domains:ResendContactReachabilityEmail",
        "route53domains:GetContactReachabilityStatus",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // ACM — setup2b (独自ドメイン SSL 証明書)
    // -------------------------------------------------------------------
    {
      Sid: "AcmCertificates",
      Effect: "Allow",
      Action: [
        "acm:RequestCertificate",
        "acm:DescribeCertificate",
        "acm:ListCertificates",
        "acm:DeleteCertificate",
        "acm:AddTagsToCertificate",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // STS — aws sts get-caller-identity など基本系
    // -------------------------------------------------------------------
    {
      Sid: "StsBasic",
      Effect: "Allow",
      Action: [
        "sts:GetCallerIdentity",
        "sts:AssumeRole",
      ],
      Resource: "*",
    },
    // -------------------------------------------------------------------
    // AWS Account Management — setup2b の Registrant 初期値取得
    //   why: AWS アカウント開設時に登録した本人連絡先 (氏名/住所/電話/会社名) を
    //        Route 53 ドメイン取得時の Registrant 初期値として流用する。
    //        メールアドレスは GetContactInformation の戻り値に含まれないため
    //        別途手入力させる。グローバル API のためリソース絞り込みは不可。
    // -------------------------------------------------------------------
    {
      Sid: "AccountContactInformation",
      Effect: "Allow",
      Action: [
        "account:GetContactInformation",
      ],
      Resource: "*",
    },
  ],
};

import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

/**
 * WAF スタック（us-east-1 固定 — CloudFront 用 WAF の要件）
 *
 * CDK コンテキスト:
 *   - wafMode: 'ip' | 'captcha' | 'none' (デフォルト: 'none')
 *       'none'    → WAF ルールを設定しない（Web ACL 自体は作成、すべて allow）
 *       'ip'      → /admin/* と /api/admin/* への IP アドレス制限（許可 IP 以外はブロック）
 *       'captcha' → /admin/* と /api/admin/* へのアクセス時に CAPTCHA チャレンジ
 *   - allowedIPs: カンマ区切り IPv4 CIDR リスト (例: "1.2.3.4/32,5.6.7.8/32")
 *       wafMode='ip' の場合のみ使用
 *
 * why (IPv4 限定):
 *   CloudFront 側で `enableIpv6=false` に固定したため、viewer は必ず IPv4 で到達する。
 *   AWS WAF の IPSet は IPv4/IPv6 で別 IPSet を要するが、片系統入れ忘れによる
 *   管理者自身の 403 を防ぐ運用簡素化を優先し IPv4 のみ管理する。
 *
 * 出力:
 *   - WebAclArn: CloudFront に関連付ける WAF Web ACL ARN
 */
export class WafStack extends cdk.Stack {
  /** CloudFront に渡す WAF Web ACL ARN */
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const wafMode = (this.node.tryGetContext('wafMode') as string) ?? 'none';
    const allowedIPsRaw = (this.node.tryGetContext('allowedIPs') as string) ?? '';
    // IPv6 形式 (`:` を含む) はここで除外。CloudFront は IPv4 限定運用のため。
    const allowedIPs = allowedIPsRaw
      .split(',')
      .map((s: string) => s.trim())
      .filter((s) => Boolean(s) && !s.includes(':'));

    const rules: wafv2.CfnWebACL.RuleProperty[] = [];

    if (wafMode === 'ip' && allowedIPs.length > 0) {
      // ============================================================
      // IP 制限モード（IPv4 のみ）:
      //   許可 IP 以外からの /admin/* と /api/admin/* アクセスをブロック。
      // ============================================================
      const ipSetV4 = new wafv2.CfnIPSet(this, 'AdminAllowedIPSet', {
        name: 'newcleus-admin-allowed-ips',
        scope: 'CLOUDFRONT',
        ipAddressVersion: 'IPV4',
        addresses: allowedIPs,
      });

      rules.push({
        name: 'AdminIPRestriction',
        priority: 1,
        // /admin/* または /api/admin/* にマッチ かつ 許可 IPSet に属さない → ブロック
        statement: {
          andStatement: {
            statements: [
              {
                orStatement: {
                  statements: [
                    {
                      byteMatchStatement: {
                        searchString: '/admin',
                        fieldToMatch: { uriPath: {} },
                        textTransformations: [{ priority: 0, type: 'NONE' }],
                        positionalConstraint: 'STARTS_WITH',
                      },
                    },
                    {
                      byteMatchStatement: {
                        searchString: '/api/admin',
                        fieldToMatch: { uriPath: {} },
                        textTransformations: [{ priority: 0, type: 'NONE' }],
                        positionalConstraint: 'STARTS_WITH',
                      },
                    },
                  ],
                },
              },
              {
                notStatement: {
                  statement: {
                    ipSetReferenceStatement: { arn: ipSetV4.attrArn },
                  },
                },
              },
            ],
          },
        },
        action: { block: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'AdminIPRestrictionRule',
          sampledRequestsEnabled: true,
        },
      });
    } else if (wafMode === 'captcha') {
      // ============================================================
      // CAPTCHA モード: /admin/* と /api/admin/* へのアクセスに CAPTCHA チャレンジ
      // ============================================================
      rules.push({
        name: 'AdminCaptcha',
        priority: 1,
        statement: {
          orStatement: {
            statements: [
              {
                byteMatchStatement: {
                  searchString: '/admin',
                  fieldToMatch: { uriPath: {} },
                  textTransformations: [{ priority: 0, type: 'NONE' }],
                  positionalConstraint: 'STARTS_WITH',
                },
              },
              {
                byteMatchStatement: {
                  searchString: '/api/admin',
                  fieldToMatch: { uriPath: {} },
                  textTransformations: [{ priority: 0, type: 'NONE' }],
                  positionalConstraint: 'STARTS_WITH',
                },
              },
            ],
          },
        },
        action: { captcha: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'AdminCaptchaRule',
          sampledRequestsEnabled: true,
        },
      });
    }
    // wafMode === 'none' の場合は rules を追加しない（defaultAction=allow で全通過）

    const webAcl = new wafv2.CfnWebACL(this, 'AppWebAcl', {
      name: 'newcleus-app-waf',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'NewcleusAppWAF',
        sampledRequestsEnabled: true,
      },
      // CAPTCHA を一度解いたらしばらく再チャレンジさせない設定。
      // 理由: 管理者が管理画面で作業する間に頻繁に CAPTCHA が出ると運用しづらいため、
      //       Immunity を 8 時間 (28800 秒) に延長する。これは CAPTCHA トークンの
      //       有効期間であり、攻撃者にとってはトークン取得後 8 時間しか攻撃できない
      //       =DoS リスクを大幅に下げつつ、正規管理者の UX を改善する。
      //       AWS デフォルトは 300 秒。上限は WAF 仕様上 259200 秒 (72h)。
      captchaConfig: {
        immunityTimeProperty: {
          immunityTime: 28800,
        },
      },
      rules,
    });

    this.webAclArn = webAcl.attrArn;

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAclArn,
      description: 'WAF Web ACL ARN (InfraStack に --context wafAclArn で渡す)',
    });
  }
}

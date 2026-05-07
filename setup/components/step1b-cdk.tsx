"use client";

import { useEffect, useState } from "react";

interface DeployResult {
  cloudfrontDomain: string;
  envUpdates: Record<string, string>;
}

interface Props {
  completed?: boolean;
}

export function Step1bCdk({ completed }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<DeployResult | null>(null);

  // why: 「過去にデプロイ済み (completed=true) だが今回の表示では result
  //      が未セット」のときも /admin/settings への絶対リンクを出したいため、
  //      .env に保存済みの CLOUDFRONT_DOMAIN を API 経由で取得する。
  const [cloudFrontDomain, setCloudFrontDomain] = useState<string>("");
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/cloudfront-domain", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { domain?: string };
        if (data.domain) setCloudFrontDomain(data.domain);
      } catch {
        // フォールバックは result?.cloudfrontDomain または空文字。
      }
    })();
  }, []);
  const adminSettingsHost = result?.cloudfrontDomain || cloudFrontDomain;
  const adminSettingsUrl = adminSettingsHost
    ? `https://${adminSettingsHost}/admin/settings`
    : "";

  const handleDeploy = async () => {
    setLoading(true);
    setError("");
    setDetails("");

    try {
      const res = await fetch("/api/cdk-deploy-1b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "デプロイに失敗しました");
        if (data.details) setDetails(data.details);
        return;
      }

      setResult(data);
    } catch {
      setError("リクエストに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">
          Step 1b — サイト公開（CDK デプロイ）
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          AWS リソースを作成し、サイトを CloudFront ドメインで公開します。
          Docker ビルドを含むため 30〜60 分かかる場合があります。
        </p>
      </div>

      {completed && !result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800 text-sm">
          ✓ setup1b デプロイ済み
        </div>
      )}

      {/* 作成されるリソース */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
        <p className="font-medium text-gray-700">作成されるリソース:</p>
        <ul className="mt-2 list-disc list-inside space-y-1 text-gray-600">
          <li>DynamoDB テーブル群（sites, content-types, templates, items, users）</li>
          <li>S3 バケット（メディアファイル用）</li>
          <li>Lambda（Next.js アプリ、Docker コンテナ）</li>
          <li>CloudFront ディストリビューション（サイト公開 + S3 メディア配信）</li>
            </ul>
        <p className="mt-2 text-xs text-gray-500">
          ⚠️ Docker が起動していることを確認してください（Lambda イメージのビルドに必要）
        </p>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          <p className="font-medium">{error}</p>
          {details && (
            <pre className="mt-2 text-xs whitespace-pre-wrap overflow-auto max-h-64 bg-red-100 p-2 rounded">
              {details}
            </pre>
          )}
        </div>
      )}

      {/* 成功表示 */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800 space-y-3">
          <p className="font-medium">✓ デプロイ完了！</p>
          <div>
            <p className="font-medium">サイト URL（CloudFront）:</p>
            <a
              href={`https://${result.cloudfrontDomain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline break-all"
            >
              https://{result.cloudfrontDomain}
            </a>
          </div>
          <div>
            <p className="font-medium">.env に書き込まれた値:</p>
            <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs font-mono">
              {Object.entries(result.envUpdates).map(([key, value]) => (
                <li key={key}>
                  {key}={" "}
                  <span className="bg-green-100 px-1 rounded">
                    {value.length > 60 ? `${value.slice(0, 60)}...` : value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-green-100 rounded p-2 text-xs">
            <p className="font-medium">次のステップ:</p>
            <p>
              Cognito コールバック URL に CloudFront ドメインが自動追加されました。
              次は Step 1c で IAM ユーザーを設定します。
            </p>
          </div>
        </div>
      )}

      {/* デプロイボタン */}
      {!result && (
        <button
          onClick={handleDeploy}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading
            ? "CDK デプロイ実行中（Docker ビルドを含むため長時間かかります）..."
            : "CDK デプロイを実行（サイト公開）"}
        </button>
      )}

      {loading && (
        <div className="text-xs text-gray-500 text-center space-y-1">
          <p>⏳ Docker イメージのビルド + AWS リソース作成中...</p>
          <p>ブラウザのタブを閉じずにお待ちください。</p>
        </div>
      )}

      {/* why: デプロイ済みサイトの管理画面 (/admin) を別タブで開きたいケースが多いため、
              CloudFront ドメイン未取得の場合（.env 未保存等）はボタンを非活性にして誤動作を避ける。 */}
      {(result || completed) && (
        <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-4 space-y-2 text-sm">
          <p className="font-medium text-indigo-900">管理画面を開く</p>
          <p className="text-xs text-indigo-800">
            サイト管理・コンテンツタイプ管理などはデプロイ済みサイトの
            <code> /admin</code> で行います。別タブで開きます。
          </p>
          {adminSettingsHost ? (
            <a
              href={`https://${adminSettingsHost}/admin`}
              target="_blank"
              rel="noreferrer"
              className="inline-block bg-indigo-600 text-white py-1.5 px-3 rounded text-xs font-medium hover:bg-indigo-700"
            >
              管理画面を開く（/admin）
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="bg-indigo-600 text-white py-1.5 px-3 rounded text-xs font-medium opacity-50 cursor-not-allowed"
            >
              CloudFront ドメイン取得中...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

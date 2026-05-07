"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function Step0AwsKey({ completed }: { completed?: boolean }) {
  const router = useRouter();
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState("ap-northeast-1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    account: string;
    arn: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/aws-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKeyId, secretAccessKey, region }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setResult(data);
      router.push("/setup1a");
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
          Step 0 — AWS アクセスキーの入力
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          AWS root ユーザーのアクセスキーを入力してください。
          このキーは CDK デプロイ後に IAM ユーザーキーに差し替え、root キーは無効化します。
        </p>
      </div>

      {completed && !result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800 text-sm">
          ✓ AWS キーは設定済みです
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Access Key ID
          </label>
          <input
            type="text"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            placeholder="AKIA..."
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Secret Access Key
          </label>
          <input
            type="password"
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            リージョン
          </label>
          {/*
            why: 現時点では東京リージョンのみで動作確認済み（cdk/bin/app.ts の
            NewcleusCognitoStack / NewcleusInfraStack も ap-northeast-1 固定）。
            他リージョンを開く場合は CDK 側の env.region を環境変数化してから解禁する。
          */}
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-100 text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="ap-northeast-1">ap-northeast-1（東京）</option>
          </select>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
            <p className="font-medium">✓ AWS 接続成功</p>
            <p className="mt-1">アカウント: {result.account}</p>
            <p>ARN: {result.arn}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "接続テスト中..." : "保存して接続テスト"}
        </button>
      </form>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
        <p className="font-medium">⚠ セキュリティに関する注意</p>
        <ul className="mt-1 list-disc list-inside space-y-1">
          <li>root キーは有効期限付きで発行してください</li>
          <li>Step 1a 完了後に IAM ユーザーキーに自動切り替えします</li>
          <li>その後、AWS コンソールで root キーを無効化してください</li>
        </ul>
      </div>
    </div>
  );
}

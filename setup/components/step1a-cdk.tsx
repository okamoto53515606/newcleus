"use client";

import { useState } from "react";

interface Props {
  completed?: boolean;
  onComplete: () => void;
}

export function Step1aCdk({ completed, onComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<{
    message: string;
    outputs: Record<string, string>;
  } | null>(null);

  const handleDeploy = async () => {
    setLoading(true);
    setError("");
    setDetails("");

    try {
      const res = await fetch("/api/cdk-deploy", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        if (data.details) setDetails(data.details);
        return;
      }

      setResult(data);
      onComplete();
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
          Step 1a — CDK インフラ構築
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          CDK を実行して AWS リソース（Cognito User Pool、IAM ユーザー等）を作成します。
          数分かかる場合があります。
        </p>
      </div>

      {completed && !result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800 text-sm">
          ✓ CDK デプロイ済み
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
        <p className="font-medium text-gray-700">作成されるリソース:</p>
        <ul className="mt-2 list-disc list-inside space-y-1 text-gray-600">
          <li>Cognito User Pool（管理画面認証用）</li>
          <li>Cognito App Client（Hosted UI 用）</li>
          <li>Cognito Hosted UI ドメイン</li>
        </ul>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          <p className="font-medium">{error}</p>
          {details && (
            <pre className="mt-2 text-xs whitespace-pre-wrap overflow-auto max-h-48">
              {details}
            </pre>
          )}
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
          <p className="font-medium">✓ {result.message}</p>
          {Object.entries(result.outputs).length > 0 && (
            <div className="mt-2">
              <p className="font-medium">.env に書き込まれた値:</p>
              <ul className="mt-1 list-disc list-inside">
                {Object.entries(result.outputs).map(([key, value]) => (
                  <li key={key}>
                    {key}: <code className="bg-green-100 px-1 rounded">{value}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleDeploy}
        disabled={loading}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "CDK デプロイ実行中（数分かかります）..." : "CDK デプロイを実行"}
      </button>
    </div>
  );
}

"use client";

/**
 * setup1c+: IAM ユーザー newcleus-deployer を作成し、root アクセスキーと入れ替える。
 *
 * 目的 (why - 初心者向け):
 *   ここまで使ってきた AWS アクセスキーは "root" という最強の権限を持つ鍵で、
 *   うっかり漏らすと AWS アカウントごと壊される危険がある。
 *   これから作るのは「newcleus のリソースだけ触れる」専用の鍵 (IAM ユーザー) で、
 *   以降のセットアップも newcleus 運用もこれで十分。
 *   ボタン1つで自動的に鍵を作り替え、最後に root アクセスキーの無効化手順を案内する。
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface StatusResponse {
  configured: boolean;
  accessKeyIdPrefix?: string;
  arn?: string;
  accountId?: string;
  isRoot?: boolean;
  isDeployer?: boolean;
  error?: string;
}

interface SetupResponse {
  success?: boolean;
  userCreated?: boolean;
  userName?: string;
  newAccessKeyId?: string;
  identityArn?: string;
  error?: string;
}

export default function Setup1cIamPage() {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [result, setResult] = useState<SetupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rootDisabled, setRootDisabled] = useState(false);

  async function refreshStatus() {
    try {
      const res = await fetch("/api/iam-setup/status", { cache: "no-store" });
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
    } catch {
      // 表示できなくても処理は続行可能
    }
  }

  // why: チェック状態を setup-state.json に保存しておきリロード後も復元する
  async function loadPersistedChecks() {
    try {
      const res = await fetch("/api/phase-check?phaseId=setup1c-iam", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { checks?: Record<string, boolean> };
      if (data.checks?.rootDisabled) setRootDisabled(true);
    } catch {
      // 失敗しても初期値のままで継続
    }
  }

  async function persistRootDisabled(value: boolean) {
    setRootDisabled(value);
    try {
      await fetch("/api/phase-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phaseId: "setup1c-iam",
          key: "rootDisabled",
          value,
        }),
      });
    } catch {
      // 永続化失敗は致命的でないので握りつぶす
    }
  }

  useEffect(() => {
    void refreshStatus();
    void loadPersistedChecks();
  }, []);

  async function handleCreateIamUser() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/iam-setup", { method: "POST" });
      const data = (await res.json()) as SetupResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "IAM ユーザー作成に失敗しました");
      }
      setResult(data);
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleComplete() {
    if (!rootDisabled) return;
    setCompleting(true);
    setError(null);
    try {
      const res = await fetch("/api/complete-phase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId: "setup1c-iam" }),
      });
      if (!res.ok) throw new Error("完了処理に失敗しました");
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setCompleting(false);
    }
  }

  const alreadyDeployer = status?.isDeployer === true;
  const canComplete = rootDisabled && (result?.success === true || alreadyDeployer);

  return (
    <div className="space-y-6">
      {/* ── タイトル・目的説明 ────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800">
          1c+. AWS アクセスキーを専用ユーザーに切り替え
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          いままで使っていた &quot;root アクセスキー&quot; は AWS アカウントの全権限を持つ鍵で、
          漏洩・誤操作時の影響が大きいです。
          <br />
          newcleus 運用に必要な権限だけを持った専用ユーザー（IAM ユーザー）を作って、鍵を差し替えましょう。
        </p>
      </div>

      {/* ── 用語解説 ───────────────────────────────── */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-4 py-2">
          <p className="font-semibold text-gray-800 text-sm">
            用語の確認（はじめての方向け）
          </p>
        </div>
        <div className="p-4 text-sm text-gray-700 space-y-2">
          <p>
            <strong>IAM</strong> … AWS で「誰が何をしていいか」を決める仕組み。
          </p>
          <p>
            <strong>IAM ユーザー</strong> … AWS アカウントの中に作る「作業員アカウント」。
            root と違って、許された操作しかできないので安全。
          </p>
          <p>
            <strong>アクセスキー</strong> … プログラム（ここでは setup アプリ）が AWS を操作するときに使う鍵。
            ID とシークレットの 2 つで 1 セット。
          </p>
          <p>
            <strong>ポリシー</strong> … 「このユーザーは S3 のこのバケットだけ書き込み OK」
            のように権限を細かく書いたルール。
          </p>
        </div>
      </div>

      {/* ── このステップで何が起きるか ─────────────── */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-4 py-2">
          <p className="font-semibold text-gray-800 text-sm">
            このステップで自動的に行うこと
          </p>
        </div>
        <ul className="p-4 text-sm text-gray-700 list-disc list-inside space-y-1">
          <li>
            IAM ユーザー{" "}
            <code className="bg-gray-100 px-1 rounded">newcleus-deployer</code>{" "}
            を作成
          </li>
          <li>
            newcleus 関連のリソース（Cognito / DynamoDB / S3 / Lambda /
            CloudFront / WAF / Secrets Manager / Route53 / ACM 等）だけを操作できるポリシーを付与
          </li>
          <li>
            アクセスキーを新規発行して{" "}
            <code className="bg-gray-100 px-1 rounded">.env</code>{" "}
            に上書き保存（以降の setup / デプロイはこの鍵で動きます）
          </li>
          <li>新しい鍵で AWS に接続できることを自動確認</li>
        </ul>
        <div className="bg-blue-50 border-t border-blue-200 px-4 py-3 text-xs text-blue-800">
          <p className="font-medium">このユーザーで出来ない操作（安全のため）:</p>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            <li>
              請求情報の閲覧・変更、AWS Organizations 操作、IAM ユーザー/ロールの新規作成
            </li>
            <li>
              newcleus 以外のリソース（他サービスの EC2 / RDS / VPC 等）の操作
            </li>
          </ul>
          <p className="mt-2">
            以降の手順で必要になる Route 53 / ACM / CloudFront 独自ドメイン設定 /
            Cognito コールバック追加 は含まれています。
          </p>
        </div>
      </div>

      {/* ── 現在の状態 ───────────────────────────── */}
      <div className="border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
        <p className="font-medium">現在 .env に入っている AWS アクセスキー:</p>
        {status ? (
          <div className="mt-2 space-y-1">
            {status.accessKeyIdPrefix ? (
              <p>
                .env のアクセスキー ID:{" "}
                <code className="bg-gray-100 px-1 rounded">
                  {status.accessKeyIdPrefix}
                </code>
              </p>
            ) : (
              <p className="text-red-700">
                .env に AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY が見つかりません。setup1c に戻って root アクセスキーを設定してください。
              </p>
            )}
            {status.isRoot && (
              <p className="text-amber-700">
                ⚠ root アクセスキー（{status.arn}）が使われています。切り替えを推奨します。
              </p>
            )}
            {status.isDeployer && (
              <p className="text-green-700">
                ✓ 既に newcleus-deployer ユーザーに切り替え済みです（{status.arn}）。
              </p>
            )}
            {!status.isRoot && !status.isDeployer && status.arn && (
              <p>現在のユーザー: {status.arn}</p>
            )}
            {status.error && (
              <p className="text-red-600">エラー: {status.error}</p>
            )}
            {status.configured && !status.arn && !status.error && (
              <p className="text-gray-500">AWS への接続確認中...</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-gray-500">読み込み中...</p>
        )}
      </div>

      {/* ── 実行ボタン ───────────────────────────── */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <button
          onClick={handleCreateIamUser}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition"
        >
          {loading
            ? "作成中..."
            : alreadyDeployer
              ? "アクセスキーを再発行する"
              : "newcleus-deployer ユーザーを作成してキーを切り替える"}
        </button>

        {result?.success && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800 space-y-1">
            <p className="font-medium">
              ✓ 切り替え完了: {result.identityArn}
            </p>
            <p>
              新しいアクセスキー ID:{" "}
              <code className="bg-green-100 px-1 rounded">
                {result.newAccessKeyId}
              </code>
            </p>
            <p className="text-xs">
              シークレットアクセスキーは .env に保存されました。以降の setup 手順は新しいキーで動作します。
            </p>
          </div>
        )}
      </div>

      {/* ── root キー無効化の案内 ───────────────────── */}
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-900 space-y-3">
        <p className="font-semibold">
          最後に: root アクセスキーを無効化してください
        </p>
        <p>
          root アクセスキーはこの後使いません。残したままだと漏洩リスクになるので
          AWS コンソールから無効化（または削除）しましょう。
        </p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            <a
              href="https://console.aws.amazon.com/iam/home#/security_credentials"
              target="_blank"
              rel="noreferrer"
              className="text-amber-800 underline"
            >
              IAM &gt; 自分のセキュリティ認証情報
            </a>
            （root ユーザーでログインし直してください）を開く
          </li>
          <li>「アクセスキー」セクションを展開</li>
          <li>
            表示されている root アクセスキー（今まで使っていたキー ID のもの）を「無効化」または「削除」
          </li>
        </ol>

        <label className="flex items-start gap-3 cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={rootDisabled}
            onChange={(e) => void persistRootDisabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 cursor-pointer"
          />
          <span className="text-sm text-amber-900 font-medium">
            root アクセスキーを無効化（または削除）しました
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-800">
          🎉 おつかれさまでした！これで AWS アカウントを安全に運用できる状態になりました（万一キーが漏えいしても被害範囲を最小化できます）。
        </div>

        <button
          onClick={handleComplete}
          disabled={!canComplete || completing}
          className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition"
        >
          {completing ? "処理中..." : "このフェーズを完了して次へ"}
        </button>
      </div>
    </div>
  );
}

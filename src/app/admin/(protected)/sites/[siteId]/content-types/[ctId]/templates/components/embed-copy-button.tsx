'use client';

/**
 * embed タグをクリップボードにコピーするボタン
 *
 * why: テンプレート一覧はサーバーコンポーネントのため、
 *      navigator.clipboard（ブラウザ API）を使うクライアント処理を
 *      独立した Client Component に切り出す。
 */

import { useState } from 'react';

interface EmbedCopyButtonProps {
  siteId: string;
  ctId: string;
  shortname: string;
  /** CloudFront ドメイン（本番）または localhost URL（開発） */
  origin: string;
}

export default function EmbedCopyButton({ siteId, ctId, shortname, origin }: EmbedCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const embedTag = `<div id="cms-content"></div>
<script
  src="${origin}/api/v1/sites/${siteId}/embed.js"
  data-content-type="${ctId}"
  data-template="${shortname}"
  data-target="cms-content"
  data-limit="10"
></script>`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(embedTag);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック: テキスト選択
      const el = document.createElement('textarea');
      el.value = embedTag;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`admin-btn text-xs ${copied ? 'text-green-700' : ''}`}
      title={embedTag}
    >
      {copied ? 'コピー済み ✓' : 'embedタグをコピー'}
    </button>
  );
}

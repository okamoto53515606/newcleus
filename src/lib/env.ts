/**
 * 環境ユーティリティ
 * 
 * 本番環境判定、ロギング、IPアドレス取得などの共通機能を提供します。
 */

import { headers } from 'next/headers';

/**
 * 開発環境かどうかを判定
 * @returns true: 開発環境, false: 本番環境
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * 本番環境では出力しないログ関数
 * 開発環境のみでデバッグログを出力します。
 */
export const logger = {
  debug: (...args: unknown[]) => {
    if (isDevelopment()) {
      console.log(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (isDevelopment()) {
      console.log(...args);
    }
  },
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};

/**
 * クライアントのIPアドレスを取得（サーバーサイド専用）
 * 
 * CloudFront-Viewer-Address ヘッダーからIPアドレスを取得する。
 * 取得できない場合は '0.0.0.0' を返す（フォールバックなし）。
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const viewerAddress = headersList.get('cloudfront-viewer-address');
  if (viewerAddress) {
    // CloudFront-Viewer-Address は "ip:port" 形式
    // IPv4: "1.2.3.4:12345"
    // IPv6: "[2001:db8::1]:12345"
    if (viewerAddress.startsWith('[')) {
      // IPv6: ブラケット内を抽出
      const closeBracket = viewerAddress.indexOf(']');
      if (closeBracket !== -1) return viewerAddress.slice(1, closeBracket);
    } else {
      // IPv4: 末尾の :port を除去
      const lastColon = viewerAddress.lastIndexOf(':');
      if (lastColon !== -1) return viewerAddress.slice(0, lastColon);
      return viewerAddress;
    }
  }
  return '0.0.0.0';
}

/**
 * リクエスト情報（IP + UserAgent）を取得（サーバーサイド専用）
 */
export async function getRequestInfo(): Promise<{ ip: string; userAgent: string }> {
  const ip = await getClientIp();
  const headersList = await headers();
  const userAgent = headersList.get('user-agent') || 'N/A';
  return { ip, userAgent };
}

/**
 * セッション有効期間を取得（時間単位）
 * 
 * 環境変数 SESSION_DURATION_HOURS から取得します。
 * 未設定の場合は120時間（5日間）をデフォルトとします。
 */
export function getSessionDurationHours(): number {
  const envValue = process.env.SESSION_DURATION_HOURS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    logger.warn(`[env] SESSION_DURATION_HOURS の値が不正です: ${envValue}`);
  }
  return 120;
}

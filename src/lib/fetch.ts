/**
 * 署名付きfetchユーティリティ
 * 
 * CloudFront OAC（Origin Access Control）では、POST/PUTリクエスト時に
 * リクエストボディのSHA256ハッシュを x-amz-content-sha256 ヘッダーに含める必要がある。
 * このユーティリティはすべてのmutationリクエストで使用する。
 */

/**
 * SHA256ハッシュを計算する
 */
async function computeSha256(data: BufferSource): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * x-amz-content-sha256 ヘッダー付きのfetchを実行する
 * 
 * @param url - リクエストURL
 * @param init - fetch オプション（method, body, headers 等）
 * @returns Response
 */
export async function fetchWithSigning(url: string, init: RequestInit = {}): Promise<Response> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;

  // SHA256 ハッシュ計算
  let hashHex: string;
  if (typeof init.body === 'string') {
    hashHex = await computeSha256(new TextEncoder().encode(init.body));
  } else if (init.body instanceof ArrayBuffer) {
    hashHex = await computeSha256(init.body);
  } else if (isFormData) {
    // FormData はブラウザがシリアライズするため UNSIGNED-PAYLOAD を使用
    hashHex = 'UNSIGNED-PAYLOAD';
  } else {
    hashHex = await computeSha256(new ArrayBuffer(0));
  }

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers as Record<string, string>),
    'x-amz-content-sha256': hashHex,
  };

  return fetch(url, {
    ...init,
    headers,
  });
}

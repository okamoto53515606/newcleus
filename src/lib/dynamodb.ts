/**
 * DynamoDB クライアント
 *
 * シングルトンの DynamoDB Document Client を提供する。
 * newcleus 用テーブル名定数もここで管理する。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

const TABLE_PREFIX = process.env.TABLE_PREFIX || 'newcleus-';

/** テーブル名 */
export const Tables = {
  sites: `${TABLE_PREFIX}sites`,
  contentTypes: `${TABLE_PREFIX}content-types`,
  templates: `${TABLE_PREFIX}templates`,
  items: `${TABLE_PREFIX}items`,
} as const;

/** GSI 名 */
export const Indexes = {
  /** items: siteContentTypeKey + createdAt でソート（CT フィルタ付き記事一覧） */
  itemsBySiteContentType: 'items-by-site-content-type',
  /** items: siteId + status でフィルタ（サイト内ステータス別一覧） */
  itemsByStatus: 'items-by-status',
} as const;

let docClient: DynamoDBDocumentClient | undefined;

/**
 * DynamoDB Document Client を取得する（シングルトン）
 */
export function getDocClient(): DynamoDBDocumentClient {
  if (docClient) return docClient;

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'ap-northeast-1',
  });

  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });

  return docClient;
}

/**
 * Query を最後まで（LastEvaluatedKey が尽きるまで）実行して全件を返す。
 *
 * why: DynamoDB の Query は 1 回の呼び出しで最大 1MB しか返さない。超過分は
 *      LastEvaluatedKey で続きを読まないと**エラーにならず静かに欠落**する。
 *      「全件を取得してから並べ替える」タイプの一覧（管理画面の記事一覧など）で
 *      ページングを忘れると、件数が 1MB を超えた時点から新しい記事が一覧に
 *      出てこなくなる（バーキルン移行時に実際に発生した不具合）。
 */
export async function queryAll<T = Record<string, unknown>>(
  params: QueryCommandInput,
): Promise<T[]> {
  const db = getDocClient();
  const items: T[] = [];
  let lastKey = params.ExclusiveStartKey;

  do {
    const input: QueryCommandInput = lastKey
      ? { ...params, ExclusiveStartKey: lastKey }
      : params;
    const result = await db.send(new QueryCommand(input));
    items.push(...((result.Items ?? []) as T[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

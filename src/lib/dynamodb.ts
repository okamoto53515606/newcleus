/**
 * DynamoDB クライアント
 *
 * シングルトンの DynamoDB Document Client を提供する。
 * newcleus 用テーブル名定数もここで管理する。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

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

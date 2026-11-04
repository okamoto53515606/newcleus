#!/usr/bin/env node
/**
 * ZAP の JSON レポートを「公開してよいサマリ」に変換する。
 *
 * why:
 *   DAST の生レポートにはエンドポイントパス・攻撃ペイロード・レスポンス断片が
 *   含まれる。これを公開リポジトリ（docs/security/reports/）にそのまま置くと
 *   「未修正の脆弱性の叩き方」を公開するのと同じになる。
 *   そこで、公開用には **重要度別件数・ルール名・対応状況だけ** を残し、
 *   URL / パラメータ / evidence は一切出力しない。
 *
 * 使い方:
 *   node scripts/dast/summarize.mjs zap-reports/baseline-report.json > out.md
 *   node scripts/dast/summarize.mjs zap-reports/baseline-report.json --with-uris  # 内部確認用
 */

import { readFileSync } from 'node:fs';

const file = process.argv[2];
const withUris = process.argv.includes('--with-uris');

if (!file) {
  console.error('usage: summarize.mjs <zap-report.json> [--with-uris]');
  process.exit(1);
}

const report = JSON.parse(readFileSync(file, 'utf8'));

// zap.conf で IGNORE 指定したルールは集計から除外する。
// why: ZAP の JSON には IGNORE 指定した検出も残るため、設定とレポートの件数が
//      食い違うと「IGNORE したのに毎回 135 件出る」状態になり、サマリが読まれなくなる。
const confPath = new URL('./zap.conf', import.meta.url);
const ignoredIds = new Set(
  readFileSync(confPath, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 2 && c[1]?.trim().toUpperCase() === 'IGNORE')
    .map((c) => c[0].trim()),
);

// ZAP の JSON は site[].alerts[] の形。site 名 (= ホスト) は公開しない。
const alerts = (report.site ?? [])
  .flatMap((s) => s.alerts ?? [])
  .filter((a) => !ignoredIds.has(String(a.pluginid)));

const RISK = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Informational' };

const counts = { High: 0, Medium: 0, Low: 0, Informational: 0 };
for (const a of alerts) {
  const label = RISK[String(a.riskcode)] ?? 'Informational';
  counts[label] += a.instances?.length ?? 1;
}

const rows = alerts
  .map((a) => ({
    risk: RISK[String(a.riskcode)] ?? 'Informational',
    name: a.alert,
    pluginId: a.pluginid,
    instances: a.instances?.length ?? 1,
    // 公開サマリでは URI を出さない（--with-uris のときだけ）
    uris: withUris ? [...new Set((a.instances ?? []).map((i) => i.uri))] : [],
  }))
  .sort((x, y) => order(y.risk) - order(x.risk) || y.instances - x.instances);

function order(r) {
  return ['High', 'Medium', 'Low', 'Informational'].indexOf(r);
}

console.log('| 重要度 | 検出項目 | 件数 |');
console.log('|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.risk} | ${r.name} | ${r.instances} |`);
}
console.log('');
console.log(
  `合計: High ${counts.High} / Medium ${counts.Medium} / Low ${counts.Low} / Informational ${counts.Informational}`,
);

if (withUris) {
  console.log('');
  console.log('> ⚠️ --with-uris 出力。公開リポジトリにコミットしないこと。');
  for (const r of rows) {
    if (r.uris.length) console.log(`- ${r.name}: ${r.uris.join(', ')}`);
  }
}

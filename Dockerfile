# ===========================================================
# Stage 1: 依存関係インストール
#
# why: Node.js 20 は 2026-04-30 に EOL。CVE-2026-111497（Brotli decoder の
#      out-of-bounds write、Node 22/24/26 が対象）は 24.22.1 で修正済み。
#      24-alpine は 24 系の最新パッチを追従するため、今後のセキュリティ修正も
#      再ビルドで取り込める。CVE-2026-111497 の修正下限は 24.22.1。
# ===========================================================
FROM public.ecr.aws/docker/library/node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
# production 依存関係のみインストール
RUN npm ci --omit=dev

# ===========================================================
# Stage 2: Next.js ビルド
# ===========================================================
FROM public.ecr.aws/docker/library/node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
# ビルドには全依存関係が必要
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# next.config.ts の output: 'standalone' により .next/standalone が生成される
RUN npm run build

# ===========================================================
# Stage 3: ランタイム（Lambda Web Adapter）
#
# why: public.ecr.aws/lambda/nodejs:24 を使わない理由:
#      Lambda Node.js base image の /lambda-entrypoint.sh は CMD[0] が
#      "module.handler" 形式でないと "entrypoint requires the handler name
#      to be the first argument" で即終了する。
#      通常の node:alpine を使い Lambda Web Adapter を /opt/extensions/ に
#      配置することで、adapter が Lambda Extension として自動起動し
#      CMD (node server.js) を HTTP サーバーとして扱う。
# ===========================================================
FROM public.ecr.aws/docker/library/node:24-alpine AS runner

WORKDIR /var/task

# Lambda Web Adapter をコピー
# AWS が提供する公式 Extension イメージからコピーする方式
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Lambda Web Adapter がリッスンするポート
ENV PORT=3000
ENV AWS_LWA_PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone ビルドをコピー
# why: --chown で root 所有を回避し、後続の USER node でも書込/読込可能に
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# why: 非 root 実行で defense-in-depth。Lambda の microVM 隔離に加え
# コンテナ内の権限昇格リスクを排除し、Semgrep の dockerfile.security.missing-user
# ルールも満たす。node:alpine に既存の node ユーザー (uid 1000) を利用。
USER node

# server.js: Next.js standalone の HTTP サーバーエントリポイント
CMD ["node", "server.js"]

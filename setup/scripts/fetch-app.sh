#!/usr/bin/env bash
# =============================================================
# fetch-app.sh — 配布 WSL イメージの「初回取得」と「更新」を 1 本にまとめる
#
# why:
#   docs/wsl.md（配布側のイメージ作成）と docs/update.md（利用者の更新）は
#   「tar を取ってくる → 利用者に不要なファイルを削る → .env を用意する」
#   という同じ手順を共有している。別々に保守すると片方だけ直して取り残されるため、
#   差分（.env を新規作成するか引き継ぐか）だけをモードで表し、実装をここに集約する。
#
#   事故防止の要点:
#   - `rm -rf ~/newcleus` をしない。旧ツリーは `<dir>.old-<timestamp>` へ退避してから
#     差し替えるため、切り戻しはディレクトリ名を戻すだけで済む
#   - update モードでは .env と setup/setup-state.json を必ず引き継ぐ
#     （.env を失うと AWS 認証・Cognito・CloudFront ドメインが消え、
#      setup-state.json を失うとセットアップの Step が未完了に巻き戻る）
#   - 展開先でレイアウトを検証してから差し替えるため、途中で落ちても既存環境は無傷
#
# 使い方:
#   bash setup/scripts/fetch-app.sh                    # 自動判定（.env があれば update）
#   bash setup/scripts/fetch-app.sh --update --build    # 既存環境の更新 + セットアップ再ビルド
#   bash setup/scripts/fetch-app.sh --fresh --dist      # 配布イメージ作成用（ビルド + prune）
#   bash setup/scripts/fetch-app.sh --ref v1.0.8 --yes  # タグ指定（既定は main）
#
# オプション:
#   --fresh        新規扱い。.env は env_template.txt から作る
#   --update       更新扱い。既存の .env / setup/setup-state.json を引き継ぐ
#   --build        ルートと setup の npm install + setup の next build まで実行する
#   --dist         --build に加えて setup の node_modules を npm prune --production する
#   --ref <name>   取得するブランチ / タグ（既定 main。v で始まるものはタグ扱い）
#   --dir <path>   対象ディレクトリ（既定: このスクリプトの 2 階層上 = リポジトリルート）
#   --yes, -y      確認プロンプトを省略する（スクリプト運用向け）
# =============================================================
set -euo pipefail

REPO="okamoto53515606/newcleus"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$(cd "${SCRIPT_DIR}/../.." && pwd)"

REF="main"
MODE=""
DO_BUILD=0
DIST=0
ASSUME_YES=0
BACKUP=""

usage() {
  # why: ヘルプ本文を先頭コメントから生成する（二重管理を避ける）。
  #      コメントブロックは空行も `#` だけの行で書いてあるため、
  #      最初の非コメント行（set -euo pipefail）で終端を判定できる。
  #      末尾の区切り線（# =====）はヘルプに含めない。
  awk '/^# 使い方:/{p=1} p && (!/^#/ || /^# =====/){exit} p{sub(/^# ?/,""); print}' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh)   MODE="fresh"; shift ;;
    --update)  MODE="update"; shift ;;
    --build)   DO_BUILD=1; shift ;;
    --dist)    DIST=1; DO_BUILD=1; shift ;;
    --ref)     REF="${2:?--ref にはブランチ名かタグ名を指定してください}"; shift 2 ;;
    --dir)     TARGET="${2:?--dir にはパスを指定してください}"; shift 2 ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "不明な引数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "${TARGET}" in
  /*) ;;
  *) echo "--dir は絶対パスで指定してください: ${TARGET}" >&2; exit 2 ;;
esac
[[ "${TARGET}" == "/" ]] && { echo "--dir に / は指定できません" >&2; exit 2; }
[[ "${TARGET}" == "${HOME}" ]] && { echo "--dir にホームディレクトリは指定できません" >&2; exit 2; }

# モード自動判定: .env があるなら「設定済みの環境」なので更新扱いにする。
# why: 既存環境で誤って fresh を選ぶと .env がテンプレートで上書きされ、
#      AWS 認証と CloudFront / Cognito の設定が消える。明示指定が無い場合は
#      安全側（update）に倒す。
if [[ -z "${MODE}" ]]; then
  if [[ -f "${TARGET}/.env" ]]; then MODE="update"; else MODE="fresh"; fi
fi

if [[ "${MODE}" == "update" ]]; then
  if [[ ! -f "${TARGET}/.env" ]]; then
    echo "[エラー] ${TARGET}/.env がありません。新規作成する場合は --fresh を指定してください" >&2
    exit 1
  fi
  if [[ ! -f "${TARGET}/package.json" ]]; then
    echo "[エラー] ${TARGET} は newcleus のツリーに見えません（package.json なし）" >&2
    exit 1
  fi
  # why: 別プロジェクトのディレクトリを --dir で指定したまま実行すると、
  #      その .env を引き継いで newcleus のファイルで上書きしてしまう。
  #      差し替え前に名前で弾く。
  if ! grep -q '"name": *"newcleus"' "${TARGET}/package.json"; then
    echo "[エラー] ${TARGET}/package.json の name が newcleus ではありません。--dir を確認してください" >&2
    exit 1
  fi
fi

PARENT="$(dirname "${TARGET}")"
mkdir -p "${PARENT}"

# why: 作業ディレクトリは対象と同じ親に作る。別ファイルシステム（/tmp が tmpfs 等）だと
#      mv が「コピー + 削除」になり、数 GB のディレクトリ移動で時間と空き容量を食う。
TMP="$(mktemp -d "${PARENT}/.fetch-app-XXXXXX")"

cleanup() {
  rm -rf "${TMP}"
}
on_error() {
  echo "" >&2
  echo "!! 途中で失敗しました。" >&2
  if [[ -n "${BACKUP}" && -d "${BACKUP}" ]]; then
    echo "   既存のツリーは退避してあります。切り戻すには:" >&2
    echo "     rm -rf '${TARGET}' && mv '${BACKUP}' '${TARGET}'" >&2
  else
    echo "   既存のツリーには手を付けていません（展開先の検証で停止）。" >&2
  fi
}
trap cleanup EXIT
trap on_error ERR

if [[ "${REF}" =~ ^v[0-9] ]]; then
  URL="${APP_TARBALL_URL:-https://github.com/${REPO}/archive/refs/tags/${REF}.tar.gz}"
else
  URL="${APP_TARBALL_URL:-https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz}"
fi

echo "取得元 : ${URL}"
echo "対象   : ${TARGET}"
if [[ "${MODE}" == "update" ]]; then
  echo "モード : update（.env と setup/setup-state.json を引き継ぐ）"
else
  echo "モード : fresh（env_template.txt から .env を作る）"
fi

if [[ "${ASSUME_YES}" -eq 0 ]]; then
  read -r -p "続行しますか? [y/N] " answer
  [[ "${answer}" =~ ^[Yy]$ ]] || { echo "中止しました"; exit 1; }
fi

echo "[1/5] ダウンロード"
curl -fsSL --retry 3 "${URL}" -o "${TMP}/app.tar.gz"

echo "[2/5] 展開"
mkdir -p "${TMP}/new"
tar -xzf "${TMP}/app.tar.gz" -C "${TMP}/new" --strip-components=1

# why: 展開結果を先に検証する。ここで落ちれば既存ツリーには一切触れていない。
if [[ ! -f "${TMP}/new/package.json" || ! -d "${TMP}/new/setup" ]]; then
  echo "[エラー] 取得したアーカイブが想定レイアウトではありません（package.json / setup が見つからない）" >&2
  exit 1
fi

# why: fresh は新しい .env をテンプレートから作るため、テンプレートが無いまま
#      差し替えると「.env が存在しないツリー」ができてしまう。差し替え前に弾く。
if [[ "${MODE}" == "fresh" && ! -f "${TMP}/new/env_template.txt" ]]; then
  echo "[エラー] env_template.txt がアーカイブにありません（.env を作れないため中止）" >&2
  exit 1
fi

# why: 配布イメージサイズ削減のため、利用者が触る必要のないファイルを除く。
#      - docs/ は「更新方法」「WSL + VSCode での開発方法」を配布物内で読めるようにするため残す
#      - scripts/ は package.json の npm scripts（seed 等）が参照しているため残す
rm -rf "${TMP}/new/prompt_history"
if [[ -d "${TMP}/new/test" ]]; then
  rm -rf "${TMP}/new/test"
fi

if [[ "${MODE}" == "update" ]]; then
  echo "[3/5] 引き継ぐファイルを退避"
  mkdir -p "${TMP}/keep"
  cp "${TARGET}/.env" "${TMP}/keep/.env"
  if [[ -f "${TARGET}/setup/setup-state.json" ]]; then
    cp "${TARGET}/setup/setup-state.json" "${TMP}/keep/setup-state.json"
  fi
else
  echo "[3/5] .env は展開後にテンプレートから作成"
fi

echo "[4/5] 差し替え"
if [[ -e "${TARGET}" ]]; then
  BACKUP="${TARGET}.old-$(date +%Y%m%d-%H%M%S)"
  mv "${TARGET}" "${BACKUP}"
fi
mv "${TMP}/new" "${TARGET}"

if [[ "${MODE}" == "update" ]]; then
  cp "${TMP}/keep/.env" "${TARGET}/.env"
  if [[ -f "${TMP}/keep/setup-state.json" ]]; then
    cp "${TMP}/keep/setup-state.json" "${TARGET}/setup/setup-state.json"
  fi
else
  cp "${TARGET}/env_template.txt" "${TARGET}/.env"
fi

# why: zip/tar 経由や Windows 側コピーで実行ビットが落ちていることがあるため付け直す。
#      ファイルが無い場合にここで異常終了させると、差し替え済みなのに失敗扱いになるため
#      存在チェックを挟む。
if [[ -f "${TARGET}/setup/start.sh" ]]; then
  chmod +x "${TARGET}/setup/start.sh"
fi
if compgen -G "${TARGET}/setup/scripts/*.sh" > /dev/null; then
  chmod +x "${TARGET}"/setup/scripts/*.sh
fi

if [[ "${DO_BUILD}" -eq 1 ]]; then
  echo "[5/5] 依存インストールとビルド"
  # why: 非対話シェルでは nvm が未ロードで npm が無いことがある
  if ! command -v npm > /dev/null 2>&1; then
    # shellcheck disable=SC1090
    source "${HOME}/.bashrc" > /dev/null 2>&1 || true
  fi
  if ! command -v npm > /dev/null 2>&1; then
    echo "[エラー] npm が見つかりません。Node.js 24 系を入れて再実行してください（nvm use 24）" >&2
    exit 1
  fi
  NODE_VER="$(node -p 'process.versions.node' 2>/dev/null || echo 0)"
  NODE_MAJOR="${NODE_VER%%.*}"
  if [[ "${NODE_MAJOR}" -lt 24 ]]; then
    echo "[警告] Node.js ${NODE_VER} が使われています。24 系を推奨します（nvm use 24）" >&2
  elif [[ "$(printf '%s\n%s\n' "${NODE_VER}" "24.22.3" | sort -V | head -1)" != "24.22.3" ]]; then
    # why: 2026-11-11 のセキュリティ更新（v24.22.3）には high 7 件が含まれる。
    #      バージョンは固定せず「これより古い場合だけ」警告する（次回の更新で
    #      この行を直さなくても、新しい Node では黙って通るようにするため）。
    echo "[警告] Node.js ${NODE_VER} は 2026-11-11 のセキュリティ修正（24.22.3 以降）より古い可能性があります。nvm install 24 で更新してください" >&2
  fi

  # why: setup は `next start` で配信するため、.next を作り直さないと画面が古いまま。
  #      ルートは CDK（npx cdk）用の依存だけが必要で、本体の Next.js ビルドは
  #      Lambda コンテナビルド（Dockerfile）側で行うため不要。
  ( cd "${TARGET}" && npm install )
  ( cd "${TARGET}/setup" && npm install && npm run build )

  # why: ビルドが実際に完了したかを確認する。ここが無いと「ビルドしたつもり」で
  #      古い .next のまま起動してしまう。
  if [[ ! -f "${TARGET}/setup/.next/BUILD_ID" ]]; then
    echo "[エラー] setup/.next/BUILD_ID がありません（setup のビルドに失敗しています）" >&2
    exit 1
  fi

  if [[ "${DIST}" -eq 1 ]]; then
    # why: ビルド後は devDependencies 不要。配布イメージのサイズを削る。
    ( cd "${TARGET}/setup" && npm prune --production )
  fi
else
  echo "[5/5] ビルドはスキップ（--build で実行）"
fi

APP_VERSION="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "${TARGET}/package.json" | head -1)"
echo ""
echo "完了しました。アプリ本体のバージョン: ${APP_VERSION:-不明}"
if [[ -n "${BACKUP}" ]]; then
  echo "  旧ツリー: ${BACKUP}"
  echo "  ※動作確認後に削除してください: rm -rf '${BACKUP}'"
  echo "  ※切り戻す場合        : rm -rf '${TARGET}' && mv '${BACKUP}' '${TARGET}'"
fi
if [[ "${DO_BUILD}" -eq 0 ]]; then
  echo "  次の手順: cd '${TARGET}/setup' && npm install && npm run build"
  echo "            （.next を作り直さないとセットアップ画面が古いままになります）"
fi

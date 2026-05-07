import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

/** セットアップ状態ファイルのパス（setup/ 直下） */
const STATE_PATH = resolve(process.cwd(), "setup-state.json");

/** フェーズID */
export type PhaseId =
  | "setup0"
  | "setup1a"
  | "setup1b"
  | "setup1c-iam";

/** フェーズの状態 */
export type PhaseStatus = "not-started" | "in-progress" | "completed";

/** エラー履歴エントリ */
export interface PhaseError {
  at: string;
  action: string;
  message: string;
  resolved: boolean;
}

/** 各フェーズの状態 */
export interface PhaseState {
  status: PhaseStatus;
  startedAt?: string;
  completedAt?: string;
  comment?: string;
  cdkOutputs?: Record<string, string>;
  errors?: PhaseError[];
  /**
   * 手動チェックボックスの状態を永続化するための入れ物。
   * why: setup1c / 1c+ / 2a などの「○○を実施しました」チェックは
   *      ページ再読込で消えるとセットアップ進捗が分からなくなるため
   *      setup-state.json に保存する。キーはページ側が任意に決める
   *      （例: rootDisabled, googleOAuthSaved, stripeWebhookRegistered）。
   */
  // why: チェックボックス状態 (boolean) だけでなく、設定画面で複数ステップを
  //      またがる作業値（例: 選択中のドメイン名、モード名）も同じ checks マップで
  //      永続化したいため string も許容する。
  checks?: Record<string, boolean | string>;
}

/** 全体の状態ファイル構造 */
export interface SetupState {
  currentPhase: PhaseId;
  phases: Record<PhaseId, PhaseState>;
}

/** フェーズの順序（依存関係チェック用） */
export const PHASE_ORDER: PhaseId[] = [
  "setup0",
  "setup1a",
  "setup1b",
  "setup1c-iam",
];

/** フェーズのメタ情報（表示用） */
export const PHASE_META: Record<
  PhaseId,
  { label: string; description: string; tool: "setup" | "newcleus-admin" }
> = {
  setup0: {
    label: "0. AWS 接続",
    description: "AWS root アクセスキーの入力と接続テスト",
    tool: "setup",
  },
  setup1a: {
    label: "1a. 管理者作成",
    description: "Cognito User Pool 構築 + 管理者ユーザー作成",
    tool: "setup",
  },
  setup1b: {
    label: "1b. インフラ構築",
    description: "CloudFront + Lambda + DynamoDB でインフラを構築",
    tool: "setup",
  },
  "setup1c-iam": {
    label: "1c. IAM ユーザー",
    description: "IAM ユーザー作成 + root キー無効化案内",
    tool: "setup",
  },
};

/** 初期状態を生成 */
function createInitialState(): SetupState {
  const phases: Record<string, PhaseState> = {};
  for (const id of PHASE_ORDER) {
    phases[id] = { status: "not-started" };
  }
  return {
    currentPhase: "setup0",
    phases: phases as Record<PhaseId, PhaseState>,
  };
}

/** 状態ファイルを読み込む。存在しなければ初期状態を作成して返す */
export function readState(): SetupState {
  if (!existsSync(STATE_PATH)) {
    const initial = createInitialState();
    writeState(initial);
    return initial;
  }
  const content = readFileSync(STATE_PATH, "utf-8");
  return JSON.parse(content) as SetupState;
}

/** 状態ファイルを書き込む */
export function writeState(state: SetupState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** フェーズを開始状態にする */
export function startPhase(phaseId: PhaseId, comment?: string): SetupState {
  const state = readState();
  state.currentPhase = phaseId;
  state.phases[phaseId] = {
    ...state.phases[phaseId],
    status: "in-progress",
    startedAt: new Date().toISOString(),
    comment: comment || state.phases[phaseId].comment,
  };
  writeState(state);
  return state;
}

/** フェーズを完了状態にする（過去のエラーもクリア） */
export function completePhase(
  phaseId: PhaseId,
  comment?: string,
  cdkOutputs?: Record<string, string>
): SetupState {
  const state = readState();
  state.phases[phaseId] = {
    ...state.phases[phaseId],
    status: "completed",
    completedAt: new Date().toISOString(),
    comment: comment || state.phases[phaseId].comment,
    cdkOutputs: cdkOutputs || state.phases[phaseId].cdkOutputs,
    errors: [],
  };
  // currentPhase を次の未完了フェーズに進める
  const nextPhase = PHASE_ORDER.find(
    (id) => state.phases[id].status !== "completed"
  );
  if (nextPhase) {
    state.currentPhase = nextPhase;
  }
  writeState(state);
  return state;
}

/** フェーズにエラーを記録する */
export function addPhaseError(
  phaseId: PhaseId,
  action: string,
  message: string
): SetupState {
  const state = readState();
  const phase = state.phases[phaseId];
  if (!phase.errors) phase.errors = [];
  phase.errors.push({
    at: new Date().toISOString(),
    action,
    message,
    resolved: false,
  });
  phase.comment = `エラー発生: ${action} — ${message}`;
  writeState(state);
  return state;
}

/** フェーズのコメントを更新する */
export function updatePhaseComment(
  phaseId: PhaseId,
  comment: string
): SetupState {
  const state = readState();
  state.phases[phaseId].comment = comment;
  writeState(state);
  return state;
}

/** フェーズのエラー履歴をクリアする */
export function clearPhaseErrors(phaseId: PhaseId): SetupState {
  const state = readState();
  state.phases[phaseId].errors = [];
  writeState(state);
  return state;
}

/** 指定フェーズがアンロック済みか（前のフェーズが全て完了済み）を判定 */
export function isPhaseUnlocked(phaseId: PhaseId): boolean {
  const state = readState();
  const idx = PHASE_ORDER.indexOf(phaseId);
  if (idx === 0) return true;
  for (let i = 0; i < idx; i++) {
    if (state.phases[PHASE_ORDER[i]].status !== "completed") return false;
  }
  return true;
}

/**
 * フェーズ内の手動チェックボックス状態を保存する。
 * why: ユーザーが「root キーを無効化しました」等のチェックを入れた状態を
 *      ブラウザリロード後も維持し、再来訪時にも続きから進められるようにする。
 */
export function setPhaseCheck(
  phaseId: PhaseId,
  key: string,
  value: boolean | string,
): SetupState {
  const state = readState();
  const phase = state.phases[phaseId];
  if (!phase.checks) phase.checks = {};
  phase.checks[key] = value;
  writeState(state);
  return state;
}

/** フェーズ内の手動チェックボックス・作業値を取得する */
export function getPhaseChecks(
  phaseId: PhaseId,
): Record<string, boolean | string> {
  const state = readState();
  return state.phases[phaseId].checks ?? {};
}

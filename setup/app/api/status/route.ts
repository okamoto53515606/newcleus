import { NextResponse } from "next/server";
import {
  readState,
  PHASE_ORDER,
  PHASE_META,
  isPhaseUnlocked,
} from "@/lib/setup-state";

// why: Next.js 16 は cookies/headers を使わない Route Handler を build 時に
//      静的化（プリレンダ）してしまう。setup-state.json を読むこの API が
//      静的化されると、build 時点（= 全フェーズ not-started）のレスポンスが
//      Lambda/Node に焼き付き、setup1b 完了後もサイドバーが setup1c を
//      アンロックしないまま固まる（症状: 配布 WSL で next start 起動時のみ発生）。
export const dynamic = "force-dynamic";

/** 現在のセットアップ進捗を setup-state.json から読み取って返す */
export async function GET() {
  const state = readState();

  const phases = PHASE_ORDER.map((id) => ({
    id,
    label: PHASE_META[id].label,
    description: PHASE_META[id].description,
    tool: PHASE_META[id].tool,
    status: state.phases[id].status,
    isCurrent: state.currentPhase === id,
    isUnlocked: isPhaseUnlocked(id),
    comment: state.phases[id].comment || null,
    errors: state.phases[id].errors || [],
  }));

  return NextResponse.json({
    currentPhase: state.currentPhase,
    phases,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { completePhase, PHASE_ORDER } from "@/lib/setup-state";
import type { PhaseId } from "@/lib/setup-state";

/** 手動フェーズを完了状態にする */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { phaseId } = body as { phaseId: string };

  if (!phaseId || !PHASE_ORDER.includes(phaseId as PhaseId)) {
    return NextResponse.json({ error: "Invalid phaseId" }, { status: 400 });
  }

  const state = completePhase(phaseId as PhaseId, "手動で完了マーク");
  return NextResponse.json({ ok: true, currentPhase: state.currentPhase });
}

/**
 * フェーズ内の手動チェックボックス状態を取得・保存する API。
 *
 * why: setup1c / setup1c-iam / setup2a などの「○○を実施しました」チェックは
 *      ブラウザの useState だけだとリロードで消える。setup-state.json に
 *      永続化することで、ユーザーが翌日再訪しても続きから作業できる。
 *
 * GET  /api/phase-check?phaseId=xxx          → { checks: { key: bool, ... } }
 * POST /api/phase-check  body: {phaseId,key,value:boolean}
 */

import { NextRequest, NextResponse } from "next/server";
import {
  PHASE_ORDER,
  getPhaseChecks,
  setPhaseCheck,
  type PhaseId,
} from "@/lib/setup-state";

function isValidPhaseId(v: unknown): v is PhaseId {
  return typeof v === "string" && (PHASE_ORDER as string[]).includes(v);
}

export async function GET(req: NextRequest) {
  const phaseId = req.nextUrl.searchParams.get("phaseId");
  if (!isValidPhaseId(phaseId)) {
    return NextResponse.json({ error: "Invalid phaseId" }, { status: 400 });
  }
  return NextResponse.json({ checks: getPhaseChecks(phaseId) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    phaseId?: string;
    key?: string;
    value?: boolean | string;
  };
  if (!isValidPhaseId(body.phaseId)) {
    return NextResponse.json({ error: "Invalid phaseId" }, { status: 400 });
  }
  if (typeof body.key !== "string" || body.key.length === 0) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  if (typeof body.value !== "boolean" && typeof body.value !== "string") {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }
  const state = setPhaseCheck(body.phaseId, body.key, body.value);
  return NextResponse.json({
    ok: true,
    checks: state.phases[body.phaseId].checks ?? {},
  });
}

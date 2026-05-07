"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { PhaseId, PhaseStatus } from "@/lib/setup-state";

interface PhaseInfo {
  id: PhaseId;
  label: string;
  description: string;
  status: PhaseStatus;
  tool: "setup" | "newcleus-admin";
  isCurrent: boolean;
  isUnlocked: boolean;
}

const STATUS_ICONS: Record<PhaseStatus, string> = {
  completed: "✓",
  "in-progress": "●",
  "not-started": "",
};

export function Sidebar() {
  const pathname = usePathname();
  const [phases, setPhases] = useState<PhaseInfo[]>([]);

  useEffect(() => {
    // why: ブラウザ/Next の HTTP キャッシュに乗ると、フェーズ完了直後に
            // 直前の "not-started" レスポンスが返り続けてサイドバーが
            // アンロックされない事故が起きる。進捗 API は常に最新を取得する。
    fetch("/api/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { phases: PhaseInfo[] }) => {
        setPhases(data.phases);
      })
      .catch(() => {});
  }, [pathname]);

  return (
    <nav className="w-64 shrink-0 bg-white border-r min-h-[calc(100vh-57px)] p-4">
      <ul className="space-y-1">
        {phases.map((phase) => {
          const href = `/${phase.id}`;
          const isActive = pathname === href || pathname === `/${phase.id}/`;
          const isNewcleusAdmin = phase.tool === "newcleus-admin";

          return (
            <li key={phase.id}>
              {phase.isUnlocked ? (
                <Link
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : phase.status === "completed"
                      ? "text-green-700 hover:bg-green-50"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span
                    className={`w-5 h-5 flex items-center justify-center rounded-full text-xs shrink-0 ${
                      phase.status === "completed"
                        ? "bg-green-100 text-green-700"
                        : phase.status === "in-progress"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {STATUS_ICONS[phase.status] ||
                      String(
                        ["setup0", "setup1a", "setup1b", "setup1c-iam"].indexOf(phase.id) + 1
                      )}
                  </span>
                  <span className="leading-tight">
                    {phase.label}
                    {isNewcleusAdmin && (
                      <span className="block text-xs text-gray-400 mt-0.5">
                        管理画面で設定
                      </span>
                    )}
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 cursor-not-allowed">
                  <span className="w-5 h-5 flex items-center justify-center rounded-full text-xs bg-gray-50 shrink-0">
                    {String(
                      ["setup0", "setup1a", "setup1b", "setup1c-iam"].indexOf(phase.id) + 1
                    )}
                  </span>
                  <span className="leading-tight">
                    {phase.label}
                    {isNewcleusAdmin && (
                      <span className="block text-xs text-gray-200 mt-0.5">
                        管理画面で設定
                      </span>
                    )}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>


    </nav>
  );
}

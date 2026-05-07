"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** ルートページ: 現在のフェーズにリダイレクトする */
export default function SetupPage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((data) => {
        router.replace(`/${data.currentPhase}`);
      })
      .catch(() => {
        router.replace("/setup0");
      });
  }, [router]);

  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-gray-500 text-sm">読み込み中...</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Step0AwsKey } from "@/components/step0-aws-key";

export default function Setup0Page() {
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((data) => {
        const phase = data.phases?.find(
          (p: { id: string }) => p.id === "setup0"
        );
        if (phase?.status === "completed") setCompleted(true);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <Step0AwsKey completed={completed} />
      {/* why: 完了済みでブラウザを再読込した場合に手動で次へ進めるためのリンクボタン */}
      {completed && (
        <Link
          href="/setup1a"
          className="block w-full py-2 px-4 rounded-lg text-sm font-medium text-center bg-blue-600 text-white hover:bg-blue-700"
        >
          次のステップへ進む（Step 1a）→
        </Link>
      )}
    </div>
  );
}

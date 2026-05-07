/**
 * [クライアントコンポーネント] ページネーションコントロール
 *
 * @description
 * 「前へ」「次へ」ボタンを提供し、URLのクエリパラメータを更新してページ遷移をトリガーします。
 */
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';

interface PaginationControlsProps {
  currentPage: number;
  hasMore?: boolean;
  basePath: string;
}

export default function PaginationControls({
  currentPage,
  hasMore,
  basePath,
}: PaginationControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handlePrev = () => {
    if (currentPage > 1) {
      const params = new URLSearchParams(searchParams);
      params.set('page', (currentPage - 1).toString());
      router.push(`${basePath}?${params.toString()}`);
    }
  };

  const handleNext = () => {
    if (hasMore) {
      const params = new URLSearchParams(searchParams);
      params.set('page', (currentPage + 1).toString());
      router.push(`${basePath}?${params.toString()}`);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '1.5rem',
        paddingTop: '1.5rem',
        borderTop: '1px solid #dee2e6',
      }}
    >
      <button
        onClick={handlePrev}
        disabled={currentPage <= 1}
        className="admin-btn"
      >
        <ArrowLeft size={16} />
        <span>前へ</span>
      </button>
      <span>ページ {currentPage}</span>
      <button
        onClick={handleNext}
        disabled={!hasMore}
        className="admin-btn"
      >
        <span>次へ</span>
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

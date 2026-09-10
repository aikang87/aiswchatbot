import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dismissGap, getGaps, promoteKnowledge } from "../../api/client";
import type { GapCluster } from "../../api/types";
import { PromoteDialog } from "../../components/PromoteDialog";

export function Gaps() {
  const { data, isLoading, error } = useQuery({ queryKey: ["admin-gaps"], queryFn: () => getGaps(30) });
  const [target, setTarget] = useState<GapCluster | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-gaps"] });
  }

  const promote = useMutation({
    mutationFn: (input: { question: string; answer: string; status: string }) =>
      promoteKnowledge({ message_id: target!.representative_message_id, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-knowledge"] });
      invalidate();
      setTarget(null);
    },
  });

  const dismiss = useMutation({
    mutationFn: (messageIds: number[]) => dismissGap(messageIds),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
  });

  function toggleSelected(key: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allKeys = data?.map((c) => c.representative_message_id) ?? [];
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  }

  function deleteSelected() {
    if (!data || selected.size === 0) return;
    const messageIds = data.filter((c) => selected.has(c.representative_message_id)).flatMap((c) => c.message_ids);
    if (confirm(`선택한 ${selected.size}개 항목을 삭제할까요? (원본 대화 기록은 남습니다)`)) {
      dismiss.mutate(messageIds);
    }
  }

  function deleteAll() {
    if (!data || data.length === 0) return;
    const messageIds = data.flatMap((c) => c.message_ids);
    if (confirm(`지식 공백 전체 ${data.length}개 항목을 삭제할까요? (원본 대화 기록은 남습니다)`)) {
      dismiss.mutate(messageIds);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">지식 공백</h1>
      <p className="mb-4 text-sm text-neutral-500">
        차단됐거나 LLM이 답을 찾지 못한 질문을 비슷한 것끼리 묶어 빈도순으로 보여줍니다. 반복되는
        질문은 FAQ로 승격하고, 의미 없는 질문(스팸·잡담 등)은 삭제하세요.
      </p>

      {isLoading && <p className="text-sm text-neutral-400">불러오는 중...</p>}
      {error && <p className="text-sm text-red-600">불러오지 못했습니다</p>}

      {data && data.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="size-4" />
            전체 선택
          </label>
          {selected.size > 0 && <span className="text-xs text-neutral-400">{selected.size}개 선택됨</span>}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={selected.size === 0 || dismiss.isPending}
              onClick={deleteSelected}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
            >
              선택 삭제
            </button>
            <button
              type="button"
              disabled={dismiss.isPending}
              onClick={deleteAll}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40"
            >
              전체 삭제
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {data?.map((cluster, i) => (
          <div key={i} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(cluster.representative_message_id)}
                  onChange={() => toggleSelected(cluster.representative_message_id)}
                  className="mt-1 size-4 shrink-0"
                />
                <div>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{cluster.representative}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {cluster.count}회 · 최근 {new Date(cluster.last_seen).toLocaleString()}
                    {cluster.last_block_reason && ` · ${cluster.last_block_reason}`}
                  </p>
                  {cluster.examples.length > 1 && (
                    <ul className="mt-2 list-disc pl-4 text-xs text-neutral-500">
                      {cluster.examples.slice(1).map((ex, j) => (
                        <li key={j}>{ex}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setTarget(cluster)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  FAQ로 승격
                </button>
                <button
                  type="button"
                  disabled={dismiss.isPending}
                  onClick={() => {
                    if (confirm(`"${cluster.representative}" 항목을 목록에서 삭제할까요? (원본 대화 기록은 남습니다)`)) {
                      dismiss.mutate(cluster.message_ids);
                    }
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        ))}
        {data?.length === 0 && <p className="text-sm text-neutral-400">지식 공백이 없습니다.</p>}
      </div>

      {target && (
        <PromoteDialog
          initialQuestion={target.representative}
          onCancel={() => setTarget(null)}
          onSubmit={(input) => promote.mutateAsync(input)}
        />
      )}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
  reindexKnowledge,
  updateKnowledge,
} from "../../api/client";
import type { KnowledgeItem } from "../../api/types";

const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  published: "게시됨",
  archived: "보관됨",
};

function KnowledgeForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: KnowledgeItem;
  onCancel: () => void;
  onSubmit: (input: { question: string; answer: string; status: string }) => Promise<unknown>;
}) {
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [status, setStatus] = useState<KnowledgeItem["status"]>(initial?.status ?? "draft");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({ question, answer, status });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {initial ? "FAQ 수정" : "FAQ 등록"}
        </h3>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">질문</label>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">답변</label>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={5}
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">상태</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as KnowledgeItem["status"])}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          >
            <option value="draft">초안</option>
            <option value="published">게시</option>
            <option value="archived">보관</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            저장
          </button>
        </div>
      </form>
    </div>
  );
}

export function Knowledge() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-knowledge", statusFilter],
    queryFn: () => listKnowledge(statusFilter || undefined),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-knowledge"] });
  }

  const createMut = useMutation({
    mutationFn: createKnowledge,
    onSuccess: () => {
      invalidate();
      setCreating(false);
    },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...input }: { id: number; question: string; answer: string; status: string }) =>
      updateKnowledge(id, input),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const deleteMut = useMutation({ mutationFn: deleteKnowledge, onSuccess: invalidate });
  const reindexMut = useMutation({ mutationFn: reindexKnowledge });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">FAQ 관리</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + FAQ 등록
        </button>
      </div>

      <div className="mb-3 flex gap-2 text-sm">
        {["", "draft", "published", "archived"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 ${
              statusFilter === s
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {s === "" ? "전체" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-neutral-400">불러오는 중...</p>}

      <div className="space-y-2">
        {data?.map((item) => (
          <div key={item.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      item.status === "published"
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : item.status === "draft"
                          ? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          : "bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500"
                    }`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                  <span className="text-xs text-neutral-400">{item.source}</span>
                </div>
                <p className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">{item.question}</p>
                <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-300">{item.answer}</p>
              </div>
              <div className="flex shrink-0 gap-1 text-xs">
                <button
                  onClick={() => setEditing(item)}
                  className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  수정
                </button>
                <button
                  onClick={() => reindexMut.mutate(item.id)}
                  className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  재색인
                </button>
                <button
                  onClick={() => {
                    if (confirm("삭제하시겠습니까?")) deleteMut.mutate(item.id);
                  }}
                  className="rounded px-2 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        ))}
        {data?.length === 0 && <p className="text-sm text-neutral-400">등록된 FAQ가 없습니다.</p>}
      </div>

      {creating && (
        <KnowledgeForm onCancel={() => setCreating(false)} onSubmit={(input) => createMut.mutateAsync(input)} />
      )}
      {editing && (
        <KnowledgeForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSubmit={(input) => updateMut.mutateAsync({ id: editing.id, ...input })}
        />
      )}
    </div>
  );
}

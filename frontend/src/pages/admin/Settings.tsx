import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getDomainSettings, updateDomainSettings } from "../../api/client";

export function Settings() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-domain-settings"], queryFn: getDomainSettings });
  const [systemPrompt, setSystemPrompt] = useState("");
  const [scopeThreshold, setScopeThreshold] = useState(0.35);
  const [retrievalThreshold, setRetrievalThreshold] = useState(0.475);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setSystemPrompt(data.system_prompt);
      setScopeThreshold(data.scope_threshold);
      setRetrievalThreshold(data.retrieval_threshold);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateDomainSettings({
        system_prompt: systemPrompt,
        scope_threshold: scopeThreshold,
        retrieval_threshold: retrievalThreshold,
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading) return <p className="text-sm text-neutral-400">불러오는 중...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        설정 — {data?.name}
      </h1>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-200">
            시스템 프롬프트
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-200">
              scope_threshold (Stage 1)
            </label>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={scopeThreshold}
              onChange={(e) => setScopeThreshold(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-200">
              retrieval_threshold (Stage 3)
            </label>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={retrievalThreshold}
              onChange={(e) => setRetrievalThreshold(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {save.isPending ? "저장 중..." : "저장"}
          </button>
          {saved && <span className="text-sm text-green-600">저장됨</span>}
        </div>
      </div>
    </div>
  );
}

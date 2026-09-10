import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { deleteConversations, listConversations } from "../../api/client";

export function Conversations() {
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-conversations", onlyBlocked, search],
    queryFn: () => listConversations({ blocked: onlyBlocked ? true : undefined, q: search || undefined }),
  });

  const remove = useMutation({
    mutationFn: (conversationIds: number[]) => deleteConversations(conversationIds),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin-conversations"] });
    },
  });

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allIds = data?.map((c) => c.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    if (confirm(`선택한 대화 ${selected.size}건을 삭제할까요? 메시지 기록도 함께 삭제되며 되돌릴 수 없습니다.`)) {
      remove.mutate([...selected]);
    }
  }

  function deleteAll() {
    if (allIds.length === 0) return;
    if (confirm(`현재 목록의 대화 ${allIds.length}건을 전부 삭제할까요? 메시지 기록도 함께 삭제되며 되돌릴 수 없습니다.`)) {
      remove.mutate(allIds);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">대화 로그</h1>

      <div className="mb-4 flex items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="키워드 검색"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button type="submit" className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-white dark:bg-neutral-700">
            검색
          </button>
        </form>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} />
          차단된 대화만
        </label>
      </div>

      {isLoading && <p className="text-sm text-neutral-400">불러오는 중...</p>}
      {error && <p className="text-sm text-red-600">목록을 불러오지 못했습니다</p>}

      {data && data.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="size-4" />
            전체 선택
          </label>
          {selected.size > 0 && <span className="text-xs text-neutral-400">{selected.size}건 선택됨</span>}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={selected.size === 0 || remove.isPending}
              onClick={deleteSelected}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
            >
              선택 삭제
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={deleteAll}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40"
            >
              전체 삭제
            </button>
          </div>
        </div>
      )}

      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="w-8 py-2 font-medium" />
              <th className="py-2 font-medium">ID</th>
              <th className="py-2 font-medium">시작</th>
              <th className="py-2 font-medium">메시지 수</th>
              <th className="py-2 font-medium">차단 수</th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleSelected(c.id)}
                    className="size-4"
                  />
                </td>
                <td className="py-2">
                  <Link to={`/admin/conversations/${c.id}`} className="text-blue-600 hover:underline">
                    #{c.id}
                  </Link>
                </td>
                <td className="py-2 text-neutral-600 dark:text-neutral-300">
                  {new Date(c.started_at).toLocaleString()}
                </td>
                <td className="py-2">{c.message_count}</td>
                <td className="py-2">
                  {c.blocked_count > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      {c.blocked_count}
                    </span>
                  ) : (
                    0
                  )}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-neutral-400">
                  결과가 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

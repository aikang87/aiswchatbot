import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listConversations } from "../../api/client";

export function Conversations() {
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-conversations", onlyBlocked, search],
    queryFn: () => listConversations({ blocked: onlyBlocked ? true : undefined, q: search || undefined }),
  });

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

      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
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
                <td colSpan={4} className="py-6 text-center text-neutral-400">
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

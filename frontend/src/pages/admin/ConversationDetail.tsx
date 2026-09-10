import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getAdminConversation } from "../../api/client";

export function ConversationDetail() {
  const { id } = useParams();
  const conversationId = Number(id);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-conversation", conversationId],
    queryFn: () => getAdminConversation(conversationId),
    enabled: Number.isFinite(conversationId),
  });

  return (
    <div>
      <Link to="/admin/conversations" className="text-sm text-blue-600 hover:underline">
        ← 목록으로
      </Link>
      <h1 className="mb-4 mt-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        대화 #{conversationId}
      </h1>

      {isLoading && <p className="text-sm text-neutral-400">불러오는 중...</p>}
      {error && <p className="text-sm text-red-600">불러오지 못했습니다</p>}

      {data && (
        <div className="space-y-3">
          {data.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border p-3 text-sm ${
                m.blocked
                  ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                  : "border-neutral-200 dark:border-neutral-800"
              }`}
            >
              <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
                <span className="font-medium">{m.role === "user" ? "사용자" : "어시스턴트"}</span>
                <span>{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-neutral-800 dark:text-neutral-100">{m.content}</p>
              {m.blocked && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  차단됨 · stage={m.block_stage} · reason={m.block_reason}
                  {m.top_score !== null && ` · top_score=${m.top_score.toFixed(3)}`}
                </p>
              )}
              {m.citations.length > 0 && (
                <p className="mt-1 text-xs text-neutral-400">
                  인용: {m.citations.map((c) => `#${c.chunk_id}(${c.score.toFixed(3)})`).join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

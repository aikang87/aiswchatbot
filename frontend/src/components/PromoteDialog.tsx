import { useState } from "react";

interface Props {
  initialQuestion: string;
  onCancel: () => void;
  onSubmit: (input: { question: string; answer: string; status: string }) => Promise<unknown>;
}

export function PromoteDialog({ initialQuestion, onCancel, onSubmit }: Props) {
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("published");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ question, answer, status });
    } catch (err) {
      setError(err instanceof Error ? err.message : "승격에 실패했습니다");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900">
        <h3 className="mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
          지식 공백을 FAQ로 승격
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">질문</label>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">답변</label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="실제 정확한 답변을 입력하세요"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">상태</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value="published">바로 게시 (published)</option>
              <option value="draft">초안으로 저장 (draft)</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
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
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "저장 중..." : "승격하기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

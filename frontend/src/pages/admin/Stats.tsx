import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStats } from "../../api/client";

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warning" | "critical" }) {
  const toneClass =
    tone === "good"
      ? "text-[#0ca30c]"
      : tone === "warning"
        ? "text-[#b8790f] dark:text-[#fab219]"
        : tone === "critical"
          ? "text-[#d03b3b]"
          : "text-neutral-900 dark:text-neutral-100";

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function DailyBarChart({ data }: { data: { date: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="text-sm text-neutral-400">데이터가 없습니다.</p>;

  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div
      className="viz-root rounded-xl border p-4"
      style={
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "--surface-1": "#fcfcfb",
          "--text-secondary": "#52514e",
          "--muted": "#898781",
          "--baseline": "#c3c2b7",
          "--series-1": "#2a78d6",
          borderColor: "var(--baseline)",
        } as React.CSSProperties
      }
    >
      <div className="flex h-40 gap-1.5">
        {data.map((d, i) => (
          <div key={d.date} className="relative flex h-full flex-1 flex-col items-center justify-end">
            {hover === i && (
              <div className="absolute -top-7 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900">
                {d.date} · {d.count}건
              </div>
            )}
            <div
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="w-full rounded-t-sm transition-opacity hover:opacity-80"
              style={{
                height: `${(d.count / max) * 100}%`,
                minHeight: d.count > 0 ? 3 : 0,
                background: "var(--series-1)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 h-px w-full" style={{ background: "var(--baseline)" }} />
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function Stats() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-stats"], queryFn: getStats });

  if (isLoading || !data) return <p className="text-sm text-neutral-400">불러오는 중...</p>;

  const blockRatePct = (data.block_rate * 100).toFixed(1);
  const blockTone = data.block_rate < 0.1 ? "good" : data.block_rate < 0.3 ? "warning" : "critical";

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">통계</h1>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatTile label="총 대화 수" value={String(data.total_conversations)} />
        <StatTile label="차단율" value={`${blockRatePct}%`} tone={blockTone} />
        <StatTile label="피드백" value={`👍 ${data.feedback.positive} / 👎 ${data.feedback.negative}`} />
      </div>

      <h2 className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">일별 대화 수</h2>
      <DailyBarChart data={data.daily_conversations} />

      <h2 className="mb-2 mt-6 text-sm font-medium text-neutral-700 dark:text-neutral-200">상위 지식 공백</h2>
      <ul className="space-y-1.5">
        {data.top_gaps.map((g, i) => (
          <li key={i} className="flex justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
            <span className="text-neutral-800 dark:text-neutral-100">{g.representative}</span>
            <span className="text-neutral-400">{g.count}회</span>
          </li>
        ))}
        {data.top_gaps.length === 0 && <p className="text-sm text-neutral-400">없음</p>}
      </ul>
    </div>
  );
}

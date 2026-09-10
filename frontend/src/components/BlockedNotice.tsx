export function BlockedNotice({ reason }: { reason?: string }) {
  return (
    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800">
      <span aria-hidden>⚠</span>
      <span>답변 범위를 벗어난 질문으로 판단되었습니다{reason ? ` (${reason})` : ""}</span>
    </div>
  );
}

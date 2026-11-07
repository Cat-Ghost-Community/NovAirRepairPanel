/** حالت بارگذاری سراسری — اسکلتون با shimmer */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="skeleton h-7 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
      </div>
      <div className="card">
        <div className="skeleton h-10 rounded-t-xl" />
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-9 border-t border-zinc-100 dark:border-zinc-800/50" />)}
      </div>
    </div>
  );
}

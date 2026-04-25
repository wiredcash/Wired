export function CardSkeleton() {
  return (
    <div className="card p-2.5 shadow-card animate-pulse">
      <div className="h-8 px-2.5 mb-2.5 flex items-center justify-between">
        <div className="w-20 h-3 rounded bg-white/[0.06]" />
        <div className="w-24 h-9 rounded-full bg-white/[0.06]" />
      </div>
      <div className="card-inset h-[88px] mb-1.5" />
      <div className="flex justify-center -my-2.5 relative z-10">
        <div className="w-9 h-9 rounded-full bg-elevated border border-white/[0.10]" />
      </div>
      <div className="card-inset h-[88px]" />
      <div className="mt-4 h-12 rounded-2xl bg-white/[0.05]" />
    </div>
  );
}

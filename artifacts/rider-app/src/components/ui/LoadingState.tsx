import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  message?: string;
  rows?: number;
  className?: string;
}

export function LoadingState({ message, rows = 3, className = "" }: LoadingStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Loader2 size={22} className="text-gray-400 animate-spin" />
      </div>
      <p className="text-sm font-semibold text-gray-500">{message ?? "Loading…"}</p>
    </div>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-white rounded-3xl border border-gray-100 p-4 flex items-center gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-2xl bg-gray-100 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 bg-gray-200 rounded-full w-32" />
            <div className="h-2.5 bg-gray-100 rounded-full w-24" />
          </div>
          <div className="space-y-1.5 items-end flex flex-col">
            <div className="h-3.5 bg-gray-200 rounded-full w-16" />
            <div className="h-5 bg-gray-100 rounded-full w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

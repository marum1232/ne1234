import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  subtitle?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  subtitle = "Check your connection and try again.",
  onRetry,
  retryLabel = "Try Again",
  className = "",
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}>
      <div className="w-16 h-16 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
        <AlertCircle size={28} className="text-red-400" />
      </div>
      <p className="font-bold text-gray-700 text-base">{title}</p>
      {subtitle && (
        <p className="text-gray-400 text-sm mt-1 leading-relaxed">{subtitle}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-700 text-sm font-bold rounded-2xl active:bg-red-100 transition-colors border border-red-100"
        >
          <RefreshCw size={13} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

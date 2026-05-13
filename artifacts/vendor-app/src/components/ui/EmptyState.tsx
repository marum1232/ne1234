import type { LucideIcon } from "lucide-react";
import { Package } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  emoji?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon = Package,
  emoji,
  title,
  subtitle,
  actionLabel,
  onAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}>
      <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-gray-100">
        {emoji ? (
          <span className="text-3xl">{emoji}</span>
        ) : (
          <Icon size={28} className="text-gray-300" />
        )}
      </div>
      <p className="font-bold text-gray-700 text-base">{title}</p>
      {subtitle && (
        <p className="text-gray-400 text-sm mt-1 leading-relaxed max-w-xs">{subtitle}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-5 py-2.5 bg-orange-500 text-white text-sm font-bold rounded-2xl hover:bg-orange-600 active:bg-orange-700 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

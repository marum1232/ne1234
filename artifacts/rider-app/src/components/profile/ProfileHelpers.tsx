import { CheckCircle } from "lucide-react";

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className || ""}`} />;
}

export function SkeletonProfile() {
  return (
    <div className="bg-[#F5F6F8] min-h-screen">
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 px-5 pb-24 rounded-b-[2rem]"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)" }} />
      <div className="px-4 -mt-20 space-y-4">
        <div className="bg-white rounded-3xl shadow-lg p-5">
          <div className="flex items-start gap-4">
            <SkeletonBlock className="w-16 h-16 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-5 w-32" />
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {[1,2,3,4].map(i => <SkeletonBlock key={i} className="flex-1 h-20 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => <SkeletonBlock key={i} className="h-20 rounded-2xl" />)}
        </div>
        <SkeletonBlock className="h-48 rounded-3xl" />
      </div>
    </div>
  );
}

export function InfoRow({ label, value, empty, icon }: { label: string; value?: string | null; empty?: string; icon?: React.ReactElement }) {
  return (
    <div className="flex justify-between items-center py-3.5 border-b border-gray-50 last:border-0 gap-3 px-5">
      <span className="text-xs text-gray-500 font-semibold flex items-center gap-2 flex-shrink-0">
        {icon}{label}
      </span>
      <span className={`text-sm font-semibold text-right ${value ? "text-gray-800" : "text-gray-300 italic text-xs"}`}>
        {value || empty || "—"}
      </span>
    </div>
  );
}

export function SavedCheckmark({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-green-600 text-xs font-bold animate-[fadeIn_0.3s_ease-out]">
      <CheckCircle size={14} className="text-green-500" /> {label}
    </span>
  );
}

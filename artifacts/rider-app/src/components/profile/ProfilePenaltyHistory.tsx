import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Clock, ChevronDown, ChevronUp, RefreshCcw } from "lucide-react";
import { formatCurrency as _sharedFcP } from "@workspace/api-zod";
import { api } from "../../lib/api";

const fc = (n: string | number | null | undefined, currencySymbol = "Rs.") =>
  _sharedFcP(n != null ? String(n) : (n as null | undefined), currencySymbol);

interface ProfilePenaltyHistoryProps {
  currency: string;
}

export function ProfilePenaltyHistory({ currency }: ProfilePenaltyHistoryProps) {
  const [open, setOpen] = useState(false);

  const { data: penaltyData } = useQuery({
    queryKey: ["rider-penalty-history"],
    queryFn: () => api.getPenaltyHistory(),
    enabled: open,
    staleTime: 60000,
  });

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-[slideUp_0.7s_ease-out]">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-5 py-4 flex items-center justify-between active:bg-gray-50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Ban size={16} className="text-red-500"/>
          </div>
          <div className="text-left">
            <p className="font-bold text-gray-900 text-[14px]">Penalty History</p>
            <p className="text-[10px] text-gray-400">Deductions, ignores &amp; cancellation penalties</p>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-300"/> : <ChevronDown size={16} className="text-gray-300"/>}
      </button>
      {open && (
        <div className="border-t border-gray-50">
          {!penaltyData ? (
            <div className="px-5 py-8 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin"/>
            </div>
          ) : (() => {
            const penalties: any[] = penaltyData?.penalties ?? [];
            if (penalties.length === 0) return (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-gray-400 font-medium">No penalties on record</p>
              </div>
            );
            const typeColor: Record<string, string> = {
              ignore: "bg-amber-100 text-amber-700",
              cancel: "bg-red-100 text-red-700",
              ignore_penalty: "bg-orange-100 text-orange-700",
              cancel_penalty: "bg-red-100 text-red-700",
            };
            return (
              <div className="divide-y divide-gray-50">
                {penalties.map((p: any) => (
                  <div key={p.id} className="px-5 py-3.5 flex items-start gap-3">
                    <div className="w-9 h-9 bg-red-50 rounded-2xl flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Ban size={15} className="text-red-400"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColor[p.type] ?? "bg-gray-100 text-gray-600"}`}>
                          {(p.type || "penalty").replace(/_/g, " ")}
                        </span>
                        {Number(p.amount) > 0 && (
                          <span className="text-xs font-black text-red-600">−{fc(p.amount, currency)}</span>
                        )}
                      </div>
                      {p.reason && <p className="text-xs text-gray-600 mt-1 leading-relaxed">{p.reason}</p>}
                      <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                        <Clock size={9}/> {new Date(p.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

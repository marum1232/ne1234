import { X } from "lucide-react";
import { formatCurrency } from "../dashboard";

interface HomeGoalModalProps {
  onClose: () => void;
  goalInput: string;
  setGoalInput: (v: string) => void;
  handleSaveGoal: () => void;
  goalMutation: { isPending: boolean; mutate: (v: null) => void };
  config: { rider?: { dailyGoal?: number } };
  currency: string;
  earningsData: { dailyGoal?: number } | undefined;
  user: { dailyGoal?: number } | null | undefined;
  T: (key: import("@workspace/i18n").TranslationKey) => string;
}

export function HomeGoalModal({ onClose, goalInput, setGoalInput, handleSaveGoal, goalMutation, config, currency, earningsData, user, T }: HomeGoalModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-extrabold text-gray-900 text-base">{T("setDailyGoalTitle")}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Admin default: {formatCurrency(config.rider?.dailyGoal ?? 5000, currency)}/day
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
            <X size={16}/>
          </button>
        </div>

        <div className="mb-4">
          <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1.5">
            Your Personal Goal ({currency})
          </label>
          <div className="flex items-center border-2 border-gray-200 rounded-2xl overflow-hidden focus-within:border-gray-900 transition-colors">
            <span className="px-3 text-gray-400 font-bold text-sm">{currency}</span>
            <input
              type="number"
              min="1"
              step="100"
              value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              placeholder={String(Math.round(config.rider?.dailyGoal ?? 5000))}
              className="flex-1 py-3 pr-3 text-gray-900 font-extrabold text-lg outline-none bg-transparent"
              autoFocus
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Leave blank to use the admin default ({formatCurrency(config.rider?.dailyGoal ?? 5000, currency)}).
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSaveGoal}
            disabled={goalMutation.isPending}
            className="flex-1 py-3 rounded-2xl bg-gray-900 text-white font-bold text-sm hover:bg-gray-800 transition-colors disabled:opacity-60">
            {goalMutation.isPending ? "Saving…" : T("saveGoal")}
          </button>
        </div>

        {(earningsData?.dailyGoal ?? user?.dailyGoal) && (
          <button
            onClick={() => goalMutation.mutate(null)}
            disabled={goalMutation.isPending}
            className="w-full mt-2 py-2.5 text-xs font-bold text-red-500 hover:text-red-700 transition-colors disabled:opacity-60">
            {T("resetToAdminDefault")}
          </button>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Target, CheckCircle, Pencil, X } from "lucide-react";
import { formatCurrency } from "../dashboard";
import { api } from "../../lib/api";

interface GoalSectionProps {
  adminGoal: number;
  personalGoal: number | null;
  todayEarnings: number;
  currency: string;
  T: (key: import("@workspace/i18n").TranslationKey) => string;
  showToast: (msg: string, type: "success" | "error") => void;
  refreshUser: () => Promise<void>;
}

export function GoalSection({ adminGoal, personalGoal, todayEarnings, currency, T, showToast, refreshUser }: GoalSectionProps) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [goalInput, setGoalInput] = useState("");

  const dailyGoal = personalGoal ?? adminGoal;
  const todayPct = dailyGoal > 0 ? Math.min(100, Math.round((todayEarnings / dailyGoal) * 100)) : 0;
  const reached = todayPct >= 100;

  const goalMutation = useMutation({
    mutationFn: (v: number | null) => api.updateProfile({ dailyGoal: v }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["rider-earnings"] });
      await refreshUser().catch((err) => { console.warn('[artifacts/rider-app/src/components/home/GoalSection.tsx]', err); }); // eslint-disable-line no-console
      setShowModal(false);
      showToast("Daily goal updated!", "success");
    },
    onError: () => showToast("Could not save goal. Please try again.", "error"),
  });

  const openModal = () => {
    setGoalInput(personalGoal ? String(Math.round(personalGoal)) : "");
    setShowModal(true);
  };

  const handleSave = () => {
    const parsed = parseFloat(goalInput);
    if (goalInput.trim() === "") goalMutation.mutate(null);
    else if (!isNaN(parsed) && parsed > 0) goalMutation.mutate(parsed);
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label="Set personal daily earnings goal"
        className="w-full text-left bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 active:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
            <Target size={12} className={reached ? "text-green-500" : "text-gray-400"} />
            {T("dailyGoal")}
            {personalGoal !== null && (
              <span className="text-[8px] font-bold bg-gray-900 text-white rounded-full px-1.5 py-0.5 uppercase tracking-wider">{T("myGoalBadge")}</span>
            )}
          </p>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-extrabold ${reached ? "text-green-600" : "text-gray-900"}`}>{todayPct}%</span>
            {reached && <CheckCircle size={12} className="text-green-500" />}
            <Pencil size={11} className="text-gray-300"/>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-700 ${reached ? "bg-green-500" : todayPct >= 60 ? "bg-gray-700" : "bg-gray-400"}`}
            style={{ width: `${todayPct}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 font-medium">
          {reached ? T("dailyGoalReached") : `${formatCurrency(todayEarnings, currency)} / ${formatCurrency(dailyGoal, currency)}`}
        </p>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-extrabold text-gray-900 text-base">{T("setDailyGoalTitle")}</h3>
                <p className="text-xs text-gray-400 mt-0.5">Admin default: {formatCurrency(adminGoal, currency)}/day</p>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                <X size={16}/>
              </button>
            </div>
            <div className="mb-4">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1.5">Your Personal Goal ({currency})</label>
              <div className="flex items-center border-2 border-gray-200 rounded-2xl overflow-hidden focus-within:border-gray-900 transition-colors">
                <span className="px-3 text-gray-400 font-bold text-sm">{currency}</span>
                <input
                  type="number" min="1" step="100" value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  placeholder={String(Math.round(adminGoal))}
                  className="flex-1 py-3 pr-3 text-gray-900 font-extrabold text-lg outline-none bg-transparent"
                  autoFocus
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Leave blank to use admin default ({formatCurrency(adminGoal, currency)}).</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={goalMutation.isPending} className="flex-1 py-3 rounded-2xl bg-gray-900 text-white font-bold text-sm hover:bg-gray-800 transition-colors disabled:opacity-60">
                {goalMutation.isPending ? "Saving…" : T("saveGoal")}
              </button>
            </div>
            {personalGoal != null && (
              <button onClick={() => goalMutation.mutate(null)} disabled={goalMutation.isPending} className="w-full mt-2 py-2.5 text-xs font-bold text-red-500 hover:text-red-700 transition-colors disabled:opacity-60">
                {T("resetToAdminDefault")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

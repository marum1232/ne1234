import { AlertTriangle, CheckCircle, Shield, MessageSquare, X } from "lucide-react";

export interface ActiveModalsProps {
  showOtpModal: boolean;
  showCancelConfirm: boolean;
  showNoPhotoWarning: boolean;
  showAdminChat: boolean;
  toastMsg: string | null;
  toastIsError: boolean;
  cancelTarget: "order" | "ride" | null;
  otpInput: string;
  setOtpInput: (v: string) => void;
  setShowOtpModal: (v: boolean) => void;
  setShowCancelConfirm: (v: boolean) => void;
  setShowNoPhotoWarning: (v: boolean) => void;
  setShowAdminChat: (v: boolean) => void;
  chatReply: string;
  setChatReply: (v: string) => void;
  adminMessages: Array<{ text: string; ts: string; from: "rider" | "admin" }>;
  setAdminMessages: (fn: (prev: Array<{ text: string; ts: string; from: "rider" | "admin" }>) => Array<{ text: string; ts: string; from: "rider" | "admin" }>) => void;
  socketRef: React.RefObject<{ emit: (event: string, data: unknown) => void } | null>;
  order: Record<string, unknown> | null;
  ride: Record<string, unknown> | null;
  updateOrderMut: { mutate: (args: { id: string; status: string }) => void; isPending: boolean };
  updateRideMut: { mutate: (args: { id: string; status: string }) => void; isPending: boolean };
  verifyOtpMut: { mutate: (args: { id: string; otp: string }) => void; isPending: boolean };
  handleMarkDelivered: (id: string, forceNoPhoto?: boolean) => void;
  proofUploading: boolean;
  T: (key: import("@workspace/i18n").TranslationKey) => string;
}

export function ActiveModals({
  showOtpModal, showCancelConfirm, showNoPhotoWarning, showAdminChat,
  toastMsg, toastIsError, cancelTarget,
  otpInput, setOtpInput,
  setShowOtpModal, setShowCancelConfirm, setShowNoPhotoWarning, setShowAdminChat,
  chatReply, setChatReply, adminMessages, setAdminMessages, socketRef,
  order, ride,
  updateOrderMut, updateRideMut, verifyOtpMut,
  handleMarkDelivered, proofUploading, T,
}: ActiveModalsProps) {
  return (
    <>
      {/* Admin Chat Modal */}
      {showAdminChat && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAdminChat(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-black text-gray-900 flex items-center gap-2"><MessageSquare size={16} className="text-blue-600"/> Admin Chat</p>
                <p className="text-xs text-gray-400">Admin can see your messages</p>
              </div>
              <button onClick={() => setShowAdminChat(false)}><X size={18} className="text-gray-400"/></button>
            </div>
            <div className="bg-gray-50 rounded-2xl p-3 min-h-[80px] max-h-44 overflow-y-auto space-y-2 mb-3">
              {adminMessages.map((m) => (
                <div key={`${m.ts}-${m.text}`} className={`flex ${m.from === "rider" ? "justify-end" : "justify-start"}`}>
                  <div className={`text-xs px-3 py-1.5 rounded-xl max-w-[80%] ${m.from === "rider" ? "bg-gray-900 text-white" : "bg-blue-600 text-white"}`}>{m.text}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatReply}
                onChange={e => setChatReply(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && chatReply.trim() && socketRef.current) {
                    const msg = chatReply.trim();
                    socketRef.current.emit("rider:chat", { message: msg });
                    setAdminMessages(prev => [...prev, { text: msg, ts: new Date().toISOString(), from: "rider" }]);
                    setChatReply("");
                  }
                }}
                placeholder="Reply to admin..."
                className="flex-1 text-sm border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => {
                  if (!chatReply.trim() || !socketRef.current) return;
                  const msg = chatReply.trim();
                  socketRef.current.emit("rider:chat", { message: msg });
                  setAdminMessages(prev => [...prev, { text: msg, ts: new Date().toISOString(), from: "rider" }]);
                  setChatReply("");
                }}
                className="bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-xl"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP Verification Modal */}
      {showOtpModal && ride && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-[slideUp_0.3s_ease-out]">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 px-6 py-6 flex flex-col items-center gap-3 border-b border-blue-100">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-200">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <div className="text-center">
                <p className="font-black text-gray-900 text-xl">Enter Customer OTP</p>
                <p className="text-gray-500 text-sm mt-1">Ask the customer for their 4-digit trip code</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={otpInput}
                  onChange={e => { const val = e.target.value.replace(/\D/g, '').slice(0, 4); setOtpInput(val); }}
                  placeholder="_ _ _ _"
                  className="w-full text-center text-3xl font-black tracking-[0.5em] border-2 border-gray-200 rounded-2xl py-4 focus:border-blue-500 focus:outline-none"
                />
                {otpInput.length < 4 && (
                  <p className="text-center text-xs text-blue-500 font-medium">Enter the 4-digit code from the customer</p>
                )}
              </div>
              <button
                onClick={() => { if (otpInput.length === 4) verifyOtpMut.mutate({ id: ride.id as string, otp: otpInput }); }}
                disabled={otpInput.length !== 4 || verifyOtpMut.isPending}
                className="w-full bg-blue-600 text-white font-black rounded-2xl py-4 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-200">
                <CheckCircle size={18}/> {verifyOtpMut.isPending ? "Verifying…" : "Verify & Start Ride"}
              </button>
              <button onClick={() => setShowOtpModal(false)} className="w-full text-gray-400 font-bold py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirm Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-[slideUp_0.3s_ease-out]">
            <div className="bg-gradient-to-br from-red-50 to-pink-50 px-6 py-6 flex flex-col items-center gap-3 border-b border-red-100">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center shadow-lg shadow-red-200">
                <AlertTriangle className="w-8 h-8 text-white" />
              </div>
              <div className="text-center">
                <p className="font-black text-gray-900 text-xl">{T("cancelConfirm")} {cancelTarget === "order" ? T("deliveryLabel") : T("ride")}?</p>
                <p className="text-sm text-gray-500 mt-1.5">{T("actionNotReversible")}</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl px-4 py-3.5 flex gap-3">
                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Shield size={16} className="text-amber-600"/>
                </div>
                <p className="text-xs text-amber-800 font-medium leading-relaxed">{T("cancelWarning")}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 bg-gray-100 text-gray-700 font-bold rounded-xl active:bg-gray-200 transition-colors py-3">
                  {T("goBack")}
                </button>
                <button
                  onClick={() => {
                    setShowCancelConfirm(false);
                    if (cancelTarget === "order" && order) {
                      updateOrderMut.mutate({ id: order.id as string, status: "cancelled" });
                    } else if (cancelTarget === "ride" && ride) {
                      updateRideMut.mutate({ id: ride.id as string, status: "cancelled" });
                    }
                  }}
                  disabled={updateOrderMut.isPending || updateRideMut.isPending}
                  className="flex-1 bg-gradient-to-r from-red-600 to-pink-600 text-white font-bold rounded-xl disabled:opacity-60 active:scale-[0.97] transition-transform shadow-md shadow-red-200 py-3">
                  {(updateOrderMut.isPending || updateRideMut.isPending) ? T("cancelling") : T("yesCancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No Photo Warning Modal */}
      {showNoPhotoWarning && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center pointer-events-auto animate-[fadeIn_0.15s_ease-out]">
          <div className="w-full max-w-sm mx-auto bg-white rounded-t-3xl px-6 py-6 shadow-2xl animate-[slideUp_0.2s_ease-out]">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center">
                <AlertTriangle size={28} className="text-amber-600"/>
              </div>
              <div className="text-center">
                <p className="text-base font-extrabold text-gray-900">No Photo Taken</p>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">Delivering without proof photo may cause disputes. Are you sure?</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowNoPhotoWarning(false)}
                className="flex-1 h-12 border-2 border-gray-200 text-gray-700 font-bold rounded-xl text-sm hover:bg-gray-50 transition-colors">
                Take Photo
              </button>
              <button onClick={() => { setShowNoPhotoWarning(false); if (order) handleMarkDelivered(order.id as string, true); }}
                disabled={proofUploading || updateOrderMut.isPending}
                className="flex-1 h-12 bg-amber-600 text-white font-bold rounded-xl text-sm hover:bg-amber-700 transition-colors disabled:opacity-60">
                Deliver Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-2.5 animate-[slideDown_0.3s_ease-out] max-w-[90vw] backdrop-blur-md ${toastIsError ? "bg-red-600/95 text-white" : "bg-gray-900/95 text-white"}`}>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${toastIsError ? "bg-red-500" : "bg-green-500"}`}>
            {toastIsError
              ? <AlertTriangle size={14} className="text-white"/>
              : <CheckCircle size={14} className="text-white"/>
            }
          </div>
          {toastMsg}
        </div>
      )}
    </>
  );
}

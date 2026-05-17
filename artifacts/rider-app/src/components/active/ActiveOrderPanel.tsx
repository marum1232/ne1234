import { type RefObject, type ChangeEvent } from "react";
import {
  ShoppingCart, Package, CheckCircle, X, RefreshCw,
  MapPin, MapPinned, Phone, Truck, Camera, ChevronRight, User,
} from "lucide-react";
import {
  MapErrorBoundary, TurnByTurnPanel, RideRouteMap,
  NavButton, CallButton, ChatButton,
  formatCurrency, ORDER_STEP_ICONS,
  type OrderItem,
} from "./ActiveHelpers";
import { SafeImage } from "../../components/ui/SafeImage";

export function orderTypeGradient(type?: string | null): string {
  const t = (type || "").toLowerCase();
  if (t === "food") return "from-orange-500 via-red-500 to-pink-600";
  if (t === "pharmacy") return "from-teal-500 via-green-500 to-emerald-600";
  if (t === "grocery") return "from-lime-500 via-green-500 to-emerald-500";
  if (t === "mart") return "from-blue-500 via-indigo-500 to-violet-600";
  return "from-gray-700 via-gray-800 to-gray-900";
}

export function OrderTypeIcon({ type }: { type?: string | null }) {
  const t = (type || "").toLowerCase();
  if (t === "food") return <span className="text-xl">🍔</span>;
  if (t === "pharmacy") return <span className="text-xl">💊</span>;
  if (t === "grocery") return <span className="text-xl">🛒</span>;
  if (t === "mart") return <ShoppingCart size={20} className="text-white" />;
  return <Package size={20} className="text-white" />;
}

export interface ActiveOrderPanelProps {
  order: Record<string, unknown>;
  orderStep: number;
  ORDER_LABELS: string[];
  riderPos: { lat: number; lng: number } | null;
  currency: string;
  deliveryFeeConfig: unknown;
  riderEarningPct: number;
  updateOrderMut: { mutate: (args: { id: string; status: string; photoUrl?: string }) => void; isPending: boolean };
  proofPhoto: string | null;
  proofFile: File | null;
  proofFileName: string;
  proofUploading: boolean;
  setProofPhoto: (v: string | null) => void;
  setProofFile: (v: File | null) => void;
  setProofFileName: (v: string) => void;
  setShowNoPhotoWarning: (v: boolean) => void;
  photoInputRef: RefObject<HTMLInputElement | null>;
  handlePhotoCapture: (e: ChangeEvent<HTMLInputElement>) => void;
  handleMarkDelivered: (id: string, forceNoPhoto?: boolean) => void;
  setCancelTarget: (v: "order" | "ride") => void;
  setShowCancelConfirm: (v: boolean) => void;
  pressedBtn: string | null;
  setPressedBtn: (v: string | null) => void;
  T: (key: import("@workspace/i18n").TranslationKey) => string;
}

export function ActiveOrderPanel({
  order, orderStep, ORDER_LABELS, riderPos, currency,
  deliveryFeeConfig, riderEarningPct,
  updateOrderMut, proofPhoto, proofFile: _proofFile, proofFileName: _pFN,
  proofUploading, setProofPhoto, setProofFile, setProofFileName,
  setShowNoPhotoWarning, photoInputRef, handlePhotoCapture,
  handleMarkDelivered, setCancelTarget, setShowCancelConfirm,
  pressedBtn, setPressedBtn, T,
}: ActiveOrderPanelProps) {
  const id = order.id as string;
  const type = order.type as string | undefined;
  const status = order.status as string;

  const riderEarning = (() => {
    const df = deliveryFeeConfig;
    let fee: number;
    if (typeof df === "number") { fee = df; }
    else if (df && typeof df === "object") {
      const raw = (df as Record<string, unknown>)[type ?? ""] ?? (df as Record<string, unknown>).mart ?? 0;
      fee = typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
    } else { fee = parseFloat(String(df)) || 0; }
    return fee * (riderEarningPct / 100);
  })();

  return (
    <>
      {/* Order header card */}
      <div className="bg-white rounded-3xl shadow-lg shadow-gray-200/50 border border-gray-100 overflow-hidden animate-[slideUp_0.4s_ease-out]">
        <div className={`bg-gradient-to-r ${orderTypeGradient(type)} px-4 py-4 flex items-center gap-3 relative overflow-hidden`}>
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full"/>
          <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-white/5 rounded-full"/>
          <div className="relative w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center flex-shrink-0 border border-white/20 shadow-inner">
            <OrderTypeIcon type={type}/>
          </div>
          <div className="relative flex-1 min-w-0">
            <p className="font-black text-white capitalize text-lg">{type} Order</p>
            <p className="text-white/70 text-xs font-mono mt-0.5">#{id.slice(-6).toUpperCase()}</p>
          </div>
          <div className="relative text-right">
            <p className="font-black text-white text-xl tracking-tight">{formatCurrency(order.total as string | number, currency)}</p>
            <div className="mt-1 bg-white/15 backdrop-blur-sm rounded-lg px-2.5 py-1 border border-white/10">
              <p className="text-white text-[10px] font-bold">You earn {formatCurrency(riderEarning, currency)}</p>
            </div>
          </div>
        </div>

        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center justify-between relative">
            {ORDER_LABELS.map((label, i) => (
              <div key={i} className="flex flex-col items-center gap-2 z-10" style={{ flex: 1 }}>
                <div className={`w-11 h-11 rounded-2xl border-2 flex items-center justify-center transition-all duration-500
                  ${i < orderStep ? "bg-green-500 border-green-500 text-white shadow-lg shadow-green-200" :
                    i === orderStep ? "bg-gray-900 border-gray-900 text-white shadow-lg shadow-gray-300 ring-4 ring-gray-200" :
                    "bg-white border-gray-200 text-gray-300"}`}>
                  {i < orderStep ? <CheckCircle size={16}/> : ORDER_STEP_ICONS[i]}
                </div>
                <p className={`text-[10px] font-bold text-center leading-tight max-w-[70px] ${
                  i <= orderStep ? "text-gray-900" : "text-gray-400"}`}>{label}</p>
              </div>
            ))}
          </div>
          <div className="relative mx-10 h-1 bg-gray-100 rounded-full -mt-8 mb-6">
            <div className="absolute top-0 left-0 h-full bg-gray-900 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${orderStep === 0 ? 0 : orderStep === 1 ? 50 : 100}%` }} />
          </div>
        </div>
      </div>

      {/* Step 1 — Go to Store */}
      {status !== "picked_up" && status !== "out_for_delivery" && status !== "delivered" && (
        <div className="bg-white rounded-3xl shadow-lg shadow-gray-200/50 border border-gray-100 overflow-hidden animate-[slideUp_0.5s_ease-out]">
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3 flex items-center gap-2">
            <div className="w-7 h-7 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
              <ShoppingCart size={14} className="text-white"/>
            </div>
            <p className="text-sm font-black text-white uppercase tracking-wide">Step 1 — Go to Store</p>
          </div>
          <div className="p-4 space-y-3">
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-orange-200">
                  <ShoppingCart size={18} className="text-white"/>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-orange-500 font-bold uppercase tracking-wider">Vendor / Store</p>
                  <p className="text-base font-black text-gray-900 mt-0.5">{(order.vendorStoreName as string) || "Store"}</p>
                  {!!order.vendorPhone && (
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Phone size={10}/> {order.vendorPhone as string}</p>
                  )}
                </div>
              </div>
            </div>

            {Array.isArray(order.items) && (order.items as unknown[]).length > 0 && (
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Package size={11}/> Items to Collect ({(order.items as unknown[]).length})
                </p>
                <div className="space-y-2">
                  {(order.items as OrderItem[]).slice(0, 5).map((item, i) => (
                    <div key={i} className="flex justify-between text-sm bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                      <span className="text-gray-700 font-medium">{item.name} <span className="text-gray-400">×{item.quantity}</span></span>
                      <span className="font-bold text-gray-800">{formatCurrency(item.price * item.quantity, currency)}</span>
                    </div>
                  ))}
                  {(order.items as unknown[]).length > 5 && (
                    <p className="text-xs text-gray-400 text-center mt-1 font-medium">+{(order.items as unknown[]).length - 5} {T("moreItems")}</p>
                  )}
                </div>
              </div>
            )}

            {!!order.vendorAddress && (
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-200">
                    <MapPin size={18} className="text-white"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">Store Location</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5 break-words">{order.vendorAddress as string}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <NavButton label={T("goToStore")} lat={order.vendorLat as number} lng={order.vendorLng as number} address={(order.vendorAddress || order.vendorStoreName) as string} color="orange" />
              {!!order.vendorPhone && <CallButton phone={order.vendorPhone as string} label="Call Store" name={order.vendorStoreName as string} />}
            </div>

            {riderPos && order.vendorLat != null && order.vendorLng != null && (
              <MapErrorBoundary>
                <TurnByTurnPanel
                  fromLat={riderPos.lat} fromLng={riderPos.lng}
                  toLat={order.vendorLat as number} toLng={order.vendorLng as number}
                  label="Store"
                  riderLat={riderPos.lat} riderLng={riderPos.lng}
                />
              </MapErrorBoundary>
            )}

            {order.vendorLat != null && order.vendorLng != null && riderPos && (
              <MapErrorBoundary fallbackMsg="Route map unavailable">
                <RideRouteMap
                  pickupLat={riderPos.lat} pickupLng={riderPos.lng} pickupLabel="Your Position"
                  dropLat={order.vendorLat as number} dropLng={order.vendorLng as number} dropLabel={(order.vendorAddress || order.vendorStoreName) as string}
                  riderLat={riderPos.lat} riderLng={riderPos.lng}
                />
              </MapErrorBoundary>
            )}

            <button
              onClick={() => { updateOrderMut.mutate({ id, status: "picked_up" }); }}
              disabled={updateOrderMut.isPending}
              onTouchStart={() => setPressedBtn("pickup")} onTouchEnd={() => setPressedBtn(null)}
              className={`w-full bg-gray-900 text-white font-black rounded-2xl py-4 text-base disabled:opacity-60 flex items-center justify-center gap-2.5 shadow-lg transition-transform ${pressedBtn === "pickup" ? "scale-[0.97]" : ""}`}>
              <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
                <Package size={18}/>
              </div>
              {T("pickUpOrder")}
              <ChevronRight size={16} className="ml-1"/>
            </button>

            <button
              onClick={() => { setCancelTarget("order"); setShowCancelConfirm(true); }}
              className="w-full border-2 border-red-200 text-red-500 text-sm font-bold rounded-xl py-3 bg-red-50/50 flex items-center justify-center gap-1.5 active:bg-red-100 transition-colors">
              <X size={14}/> {T("cantPickUp")}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Deliver */}
      {(status === "picked_up" || status === "out_for_delivery") && (
        <div className="bg-white rounded-3xl shadow-lg shadow-gray-200/50 border border-gray-100 overflow-hidden animate-[slideUp_0.5s_ease-out]">
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-3 flex items-center gap-2">
            <div className="w-7 h-7 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
              <Truck size={14} className="text-white"/>
            </div>
            <p className="text-sm font-black text-white uppercase tracking-wide">Step 2 — Deliver</p>
          </div>
          <div className="p-4 space-y-3">
            {!!order.customerName && (
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl px-4 py-3.5 flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-200">
                  <User size={22} className="text-white"/>
                </div>
                <div>
                  <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">Customer</p>
                  <p className="text-base font-black text-gray-900">{order.customerName as string}</p>
                  {!!order.customerPhone && <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><Phone size={10}/> {order.customerPhone as string}</p>}
                </div>
              </div>
            )}

            <div className="bg-gradient-to-br from-red-50 to-pink-50 border border-red-100 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-red-200">
                  <MapPinned size={18} className="text-white"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-red-500 font-bold uppercase tracking-wider">Delivery Address</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5 break-words">{(order.deliveryAddress as string) || "Address not provided"}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <NavButton label={T("navigateLabel")} lat={order.deliveryLat as number} lng={order.deliveryLng as number} address={order.deliveryAddress as string} color="blue" />
              <CallButton name={order.customerName as string} phone={order.customerPhone as string} />
              <ChatButton name={order.customerName as string} />
            </div>

            {riderPos && order.deliveryLat != null && order.deliveryLng != null && (
              <MapErrorBoundary>
                <TurnByTurnPanel
                  fromLat={riderPos.lat} fromLng={riderPos.lng}
                  toLat={order.deliveryLat as number} toLng={order.deliveryLng as number}
                  label="Customer"
                  riderLat={riderPos.lat} riderLng={riderPos.lng}
                />
              </MapErrorBoundary>
            )}

            {order.deliveryLat != null && order.deliveryLng != null && riderPos && (
              <MapErrorBoundary fallbackMsg="Route map unavailable">
                <RideRouteMap
                  pickupLat={riderPos.lat} pickupLng={riderPos.lng} pickupLabel="Your Position"
                  dropLat={order.deliveryLat as number} dropLng={order.deliveryLng as number} dropLabel={order.deliveryAddress as string}
                  riderLat={riderPos.lat} riderLng={riderPos.lng}
                />
              </MapErrorBoundary>
            )}

            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4">
              <p className="text-xs font-extrabold text-blue-700 mb-3 flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Camera className="w-3.5 h-3.5 text-blue-600" />
                </div>
                {T("proofOfDelivery")} ({T("recommended")})
              </p>
              {proofPhoto ? (
                <div className="space-y-2.5">
                  <div className="relative rounded-2xl overflow-hidden h-44 bg-gray-100 shadow-inner">
                    <SafeImage src={proofPhoto} alt="Delivery proof" className="w-full h-full object-cover" loading="eager" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent"/>
                    <div className="absolute top-3 right-3">
                      <span className="bg-green-500 text-white text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-lg">
                        <CheckCircle size={10}/> {T("photoReady")}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => { setProofPhoto(null); setProofFileName(""); setProofFile(null); setShowNoPhotoWarning(false); if (photoInputRef.current) photoInputRef.current.value = ""; }}
                    className="w-full text-xs text-blue-600 font-bold py-2.5 border-2 border-blue-200 rounded-xl bg-white flex items-center justify-center gap-1.5 active:bg-blue-50 transition-colors">
                    <Camera size={12}/> {T("retakePhoto")}
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handlePhotoCapture}
                  />
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-blue-300 rounded-2xl py-5 flex flex-col items-center gap-2.5 bg-white text-blue-500 hover:bg-blue-50 transition-all active:scale-[0.98]">
                    <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
                      <Camera className="w-6 h-6 text-blue-500" />
                    </div>
                    <span className="text-sm font-bold">{T("takePhoto")}</span>
                    <span className="text-[10px] text-blue-400">{T("opensCamera")}</span>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => handleMarkDelivered(id)}
              disabled={updateOrderMut.isPending || proofUploading}
              onTouchStart={() => setPressedBtn("deliver")} onTouchEnd={() => setPressedBtn(null)}
              className={`w-full font-black rounded-2xl py-4 text-lg disabled:opacity-60 transition-transform bg-gradient-to-r from-green-500 to-emerald-600 text-white flex items-center justify-center gap-2.5 shadow-lg shadow-green-200 ${pressedBtn === "deliver" ? "scale-[0.97]" : ""}`}>
              <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
                {proofUploading ? <RefreshCw size={18} className="animate-spin"/> : <CheckCircle size={20}/>}
              </div>
              {proofUploading ? T("uploadingPhoto") : updateOrderMut.isPending ? T("updating") : proofPhoto ? T("confirmDeliveryWithProof") : T("markDelivered")}
            </button>

            <div>
              <div className="w-full border-2 border-gray-100 text-gray-400 text-sm font-bold rounded-xl py-3 bg-gray-50 flex items-center justify-center gap-1.5 cursor-not-allowed">
                <ChevronRight size={14} className="rotate-180"/> {T("backToStoreStep")}
              </div>
              <p className="text-[10px] text-gray-400 text-center mt-1">
                Cannot go back — server already recorded pickup. Contact support if needed.
              </p>
            </div>

            <button
              onClick={() => { setCancelTarget("order"); setShowCancelConfirm(true); }}
              disabled={updateOrderMut.isPending}
              className="w-full border-2 border-red-200 text-red-500 text-sm font-bold rounded-xl py-3 bg-red-50/50 flex items-center justify-center gap-1.5 active:bg-red-100 transition-colors disabled:opacity-60">
              <X size={14}/> {T("cannotDeliverCancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

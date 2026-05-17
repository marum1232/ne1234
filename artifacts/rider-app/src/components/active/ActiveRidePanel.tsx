import {
  Bike, Car, ArrowDown, CheckCircle, MapPin, Shield, X, User,
} from "lucide-react";
import {
  MapErrorBoundary, TurnByTurnPanel, RideRouteMap,
  NavButton, CallButton, ChatButton, SosButton,
  EstimatedArrivalBadge, formatCurrency, RIDE_STEP_ICONS, RIDE_STEPS,
} from "./ActiveHelpers";

export interface ActiveRidePanelProps {
  ride: Record<string, unknown>;
  rideStep: number;
  RIDE_LABELS: string[];
  riderPos: { lat: number; lng: number } | null;
  currency: string;
  riderEarningPct: number;
  config: { rides?: { riderEarningPct?: number }; finance: { riderEarningPct?: number }; features?: { sos?: boolean } };
  updateRideMut: { mutate: (args: { id: string; status: string; lat?: number; lng?: number }) => void; isPending: boolean };
  setShowOtpModal: (v: boolean) => void;
  setOtpInput: (v: string) => void;
  setCancelTarget: (v: "order" | "ride") => void;
  setShowCancelConfirm: (v: boolean) => void;
  pressedBtn: string | null;
  setPressedBtn: (v: string | null) => void;
  showToast: (msg: string, isError?: boolean) => void;
  T: (key: string) => string;
}

export function ActiveRidePanel({
  ride, rideStep, RIDE_LABELS, riderPos, currency,
  riderEarningPct, config,
  updateRideMut, setShowOtpModal, setOtpInput,
  setCancelTarget, setShowCancelConfirm,
  pressedBtn, setPressedBtn, showToast, T,
}: ActiveRidePanelProps) {
  const id = ride.id as string;
  const type = ride.type as string | undefined;
  const status = ride.status as string;
  const riderEarning = (ride.fare as number) * (riderEarningPct / 100);

  return (
    <div className="bg-white rounded-3xl shadow-lg shadow-gray-200/50 border border-gray-100 overflow-hidden animate-[slideUp_0.4s_ease-out]">
      <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-700 px-4 py-4 flex items-center gap-3 relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-white/5 rounded-full"/>
        <div className="relative w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center flex-shrink-0 border border-white/20 shadow-inner">
          {type === "bike" ? <Bike size={22} className="text-white"/> : <Car size={22} className="text-white"/>}
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-white capitalize text-lg">{type} Ride</p>
            {(ride as { isPoolRide?: boolean }).isPoolRide && (
              <span className="bg-white/20 border border-white/30 text-white text-[9px] font-bold px-2 py-0.5 rounded-full tracking-wide flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                POOL
              </span>
            )}
          </div>
          <p className="text-purple-200 text-xs font-mono mt-0.5">#{id.slice(-6).toUpperCase()} · {ride.distance as string}km</p>
        </div>
        <div className="relative text-right">
          <p className="font-black text-white text-xl tracking-tight">{formatCurrency(ride.fare as number, currency)}</p>
          <div className="mt-1 bg-white/15 backdrop-blur-sm rounded-lg px-2.5 py-1 border border-white/10">
            <p className="text-white text-[10px] font-bold">You earn {formatCurrency(riderEarning, currency)}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {rideStep >= 0 && (
          <div className="bg-gradient-to-br from-gray-50 to-purple-50/30 rounded-2xl p-5 border border-gray-100">
            <div className="flex justify-between mb-5 relative">
              {RIDE_LABELS.map((label, i) => (
                <div key={i} className="flex flex-col items-center gap-2 z-10" style={{ flex: 1 }}>
                  <div className={`w-10 h-10 rounded-2xl border-2 flex items-center justify-center transition-all duration-500
                    ${i < rideStep ? "bg-green-500 border-green-500 text-white shadow-lg shadow-green-200" :
                      i === rideStep ? "bg-gray-900 border-gray-900 text-white shadow-lg shadow-gray-300 ring-4 ring-gray-200" :
                      "bg-white border-gray-200 text-gray-300"}`}>
                    {i < rideStep ? <CheckCircle size={14}/> : RIDE_STEP_ICONS[i]}
                  </div>
                  <p className={`text-[9px] font-bold text-center max-w-[60px] ${i <= rideStep ? "text-gray-900" : "text-gray-400"}`}>{label}</p>
                </div>
              ))}
            </div>
            <div className="relative h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="absolute top-0 left-0 h-full bg-gray-900 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${rideStep < 0 ? 0 : (rideStep / (RIDE_STEPS.length - 1)) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="relative">
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 border border-green-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-green-200">
                <MapPin size={18} className="text-white"/>
              </div>
              <div>
                <p className="text-[10px] text-green-600 font-bold uppercase tracking-wider">Pickup</p>
                <p className="text-sm font-bold text-gray-800 mt-0.5">{ride.pickupAddress as string}</p>
              </div>
            </div>
          </div>
          <div className="flex justify-center -my-1.5 relative z-10">
            <div className="w-8 h-8 bg-white rounded-xl border-2 border-gray-200 flex items-center justify-center shadow-sm">
              <ArrowDown size={14} className="text-gray-400"/>
            </div>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-pink-50 rounded-2xl p-4 border border-red-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-red-200">
                <MapPin size={18} className="text-white"/>
              </div>
              <div>
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider">Drop-off</p>
                <p className="text-sm font-bold text-gray-800 mt-0.5">{ride.dropAddress as string}</p>
              </div>
            </div>
          </div>
        </div>

        {ride.customerName && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl px-4 py-3.5 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-200">
              <User size={22} className="text-white"/>
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">Passenger</p>
              <p className="text-base font-black text-gray-900">{ride.customerName as string}</p>
              {ride.customerPhone && <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.36 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 17z"/></svg>
                {ride.customerPhone as string}
              </p>}
            </div>
          </div>
        )}

        {status === "accepted" && (
          <EstimatedArrivalBadge riderPos={riderPos} pickupLat={ride.pickupLat as number} pickupLng={ride.pickupLng as number} vehicleType={type} />
        )}

        <div className="grid grid-cols-3 gap-2">
          {status === "accepted" ? (
            <NavButton label="Go to Pickup" lat={ride.pickupLat as number} lng={ride.pickupLng as number} address={ride.pickupAddress as string} color="orange" />
          ) : (
            <NavButton label="Go to Drop" lat={ride.dropLat as number} lng={ride.dropLng as number} address={ride.dropAddress as string} color="blue" />
          )}
          <CallButton name={ride.customerName as string} phone={ride.customerPhone as string} />
          <ChatButton name={ride.customerName as string} />
        </div>

        {riderPos && status === "accepted" && ride.pickupLat != null && ride.pickupLng != null && (
          <MapErrorBoundary>
            <TurnByTurnPanel
              fromLat={riderPos.lat} fromLng={riderPos.lng}
              toLat={ride.pickupLat as number} toLng={ride.pickupLng as number}
              label="Pickup"
              riderLat={riderPos.lat} riderLng={riderPos.lng}
            />
          </MapErrorBoundary>
        )}
        {riderPos && (status === "arrived" || status === "in_transit") && ride.dropLat != null && ride.dropLng != null && (
          <MapErrorBoundary>
            <TurnByTurnPanel
              fromLat={riderPos.lat} fromLng={riderPos.lng}
              toLat={ride.dropLat as number} toLng={ride.dropLng as number}
              label="Drop-off"
              riderLat={riderPos.lat} riderLng={riderPos.lng}
            />
          </MapErrorBoundary>
        )}

        {ride.pickupLat != null && ride.pickupLng != null && ride.dropLat != null && ride.dropLng != null && (
          <MapErrorBoundary fallbackMsg="Route map unavailable">
            <RideRouteMap
              pickupLat={ride.pickupLat as number} pickupLng={ride.pickupLng as number} pickupLabel={ride.pickupAddress as string}
              dropLat={ride.dropLat as number} dropLng={ride.dropLng as number} dropLabel={ride.dropAddress as string}
              riderLat={riderPos?.lat} riderLng={riderPos?.lng}
            />
          </MapErrorBoundary>
        )}

        {config.features?.sos !== false && (status === "accepted" || status === "arrived" || status === "in_transit") && (
          <div className="flex justify-end">
            <SosButton rideId={id} riderPos={riderPos} T={T as (key: import("@workspace/i18n").TranslationKey) => string} showToast={showToast} />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {status === "accepted" && (
            <button
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (pos) => updateRideMut.mutate({ id, status: "arrived", lat: pos.coords.latitude, lng: pos.coords.longitude }),
                    () => updateRideMut.mutate({ id, status: "arrived" }),
                    { enableHighAccuracy: true, timeout: 5000 }
                  );
                } else {
                  updateRideMut.mutate({ id, status: "arrived" });
                }
              }}
              disabled={updateRideMut.isPending}
              onTouchStart={() => setPressedBtn("arrived")} onTouchEnd={() => setPressedBtn(null)}
              className={`flex-1 bg-gray-900 text-white font-black rounded-2xl py-4 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg transition-transform ${pressedBtn === "arrived" ? "scale-[0.97]" : ""}`}>
              <MapPin size={16}/> {T("arrivedAtPickup")}
            </button>
          )}
          {["arrived", "accepted"].includes(status) && !(ride as { otpVerified?: boolean }).otpVerified && (
            <button
              onClick={() => { setOtpInput(""); setShowOtpModal(true); }}
              disabled={updateRideMut.isPending}
              onTouchStart={() => setPressedBtn("otp")} onTouchEnd={() => setPressedBtn(null)}
              className={`flex-1 bg-blue-600 text-white font-black rounded-2xl py-4 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-blue-200 transition-transform ${pressedBtn === "otp" ? "scale-[0.97]" : ""}`}>
              <Shield size={16}/> Verify OTP to Start
            </button>
          )}
          {status === "arrived" && (ride as { otpVerified?: boolean }).otpVerified && (
            <button
              onClick={() => updateRideMut.mutate({ id, status: "in_transit" })}
              disabled={updateRideMut.isPending}
              onTouchStart={() => setPressedBtn("start")} onTouchEnd={() => setPressedBtn(null)}
              className={`flex-1 bg-gray-900 text-white font-black rounded-2xl py-4 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg transition-transform ${pressedBtn === "start" ? "scale-[0.97]" : ""}`}>
              <Car size={16}/> {T("startRide")}
            </button>
          )}
          {status === "in_transit" && (
            <button
              onClick={() => updateRideMut.mutate({ id, status: "completed" })}
              disabled={updateRideMut.isPending}
              onTouchStart={() => setPressedBtn("complete")} onTouchEnd={() => setPressedBtn(null)}
              className={`flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-black rounded-2xl py-4 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-green-200 transition-transform ${pressedBtn === "complete" ? "scale-[0.97]" : ""}`}>
              <CheckCircle size={16}/> {T("completeRide")}
            </button>
          )}
          {(status === "accepted" || status === "arrived" || status === "in_transit") && (
            <button
              onClick={() => { setCancelTarget("ride"); setShowCancelConfirm(true); }}
              disabled={updateRideMut.isPending}
              className="px-5 bg-red-50 text-red-600 font-bold rounded-2xl py-4 text-sm border-2 border-red-200 active:bg-red-100 transition-colors">
              <X size={16}/>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

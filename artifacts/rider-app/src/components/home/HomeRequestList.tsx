import { AlertTriangle, Bike, Eye } from "lucide-react";
import { OrderRequestCard, RideRequestCard } from "../dashboard";
import type { Order, Ride } from "../../lib/api";

function getDeliveryEarn(type: string, config: any): number {
  const df = config.deliveryFee;
  let fee: number;
  if (typeof df === "number") {
    fee = df;
  } else if (df && typeof df === "object") {
    const raw = (df as Record<string, unknown>)[type] ?? (df as Record<string, unknown>).mart ?? 0;
    fee = typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
  } else {
    fee = parseFloat(String(df)) || 0;
  }
  return fee * (config.finance.riderEarningPct / 100);
}

interface HomeRequestListProps {
  requestsLoading: boolean;
  requestsError: boolean;
  totalRequests: number;
  dismissed: Set<string>;
  onClearDismissed: () => void;
  orders: Order[];
  rides: Ride[];
  currency: string;
  config: any;
  onAcceptOrder: (id: string) => void;
  onRejectOrder: (id: string) => void;
  onAcceptRide: (id: string) => void;
  onCounterRide: (id: string, fare: number) => void;
  onRejectOffer: (id: string) => void;
  onIgnoreRide: (id: string) => void;
  onDismiss: (id: string) => void;
  acceptOrderPending: boolean;
  rejectOrderPending: boolean;
  acceptRidePending: boolean;
  counterRidePending: boolean;
  rejectOfferPending: boolean;
  ignoreRidePending: boolean;
  requestsServerTime: string | null;
  userId: string;
  isRestricted: boolean;
  onRetry: () => void;
  T: (key: import("@workspace/i18n").TranslationKey) => string;
}

export function HomeRequestList({
  requestsLoading, requestsError, totalRequests, dismissed, onClearDismissed,
  orders, rides, currency, config,
  onAcceptOrder, onRejectOrder, onAcceptRide, onCounterRide, onRejectOffer, onIgnoreRide, onDismiss,
  acceptOrderPending, rejectOrderPending, acceptRidePending, counterRidePending,
  rejectOfferPending, ignoreRidePending, requestsServerTime, userId, isRestricted, onRetry, T,
}: HomeRequestListProps) {
  if (requestsLoading) {
    return (
      <div className="bg-white p-10 text-center">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-xs font-medium">Loading requests…</p>
      </div>
    );
  }
  if (requestsError) {
    return (
      <div className="bg-white p-8 text-center">
        <AlertTriangle size={28} className="text-red-300 mx-auto mb-3" />
        <p className="text-gray-600 font-bold text-sm">Could not load requests</p>
        <p className="text-gray-400 text-xs mt-1">Check your connection and try again.</p>
        <button onClick={onRetry} className="mt-3 text-xs text-indigo-600 font-bold underline">Retry</button>
      </div>
    );
  }
  if (totalRequests === 0) {
    return (
      <div className="bg-white p-8 sm:p-10 text-center">
        <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
          <Bike size={28} className="text-gray-300" />
        </div>
        <p className="text-gray-600 font-bold text-sm sm:text-base">{T("noRequestsNow")}</p>
        <p className="text-gray-400 text-xs mt-1.5">{T("autoRefreshes")}</p>
        {dismissed.size > 0 && (
          <button
            onClick={onClearDismissed}
            className="mt-4 text-xs text-gray-900 font-bold bg-gray-100 border border-gray-200 px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-gray-200 transition-colors"
            aria-label={`Show ${dismissed.size} hidden requests`}
          >
            <Eye size={12} /> Show {dismissed.size} hidden request{dismissed.size > 1 ? "s" : ""}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="bg-white divide-y divide-gray-100">
      {orders.map((o) => (
        <OrderRequestCard
          key={o.id}
          order={o}
          earnings={getDeliveryEarn(o.type ?? "", config)}
          currency={currency}
          config={config}
          onAccept={onAcceptOrder}
          onReject={onRejectOrder}
          onDismiss={onDismiss}
          acceptPending={acceptOrderPending}
          rejectPending={rejectOrderPending}
          anyAcceptPending={acceptRidePending}
          serverTime={requestsServerTime}
          T={T}
        />
      ))}
      {rides.map((r) => (
        <RideRequestCard
          key={r.id}
          ride={r}
          userId={userId}
          isRestricted={isRestricted}
          config={config}
          currency={currency}
          onAccept={onAcceptRide}
          onCounter={onCounterRide}
          onRejectOffer={onRejectOffer}
          onIgnore={onIgnoreRide}
          onDismiss={onDismiss}
          acceptPending={acceptRidePending}
          counterPending={counterRidePending}
          rejectOfferPending={rejectOfferPending}
          ignorePending={ignoreRidePending}
          anyAcceptPending={acceptOrderPending}
          serverTime={requestsServerTime}
          T={T}
        />
      ))}
    </div>
  );
}

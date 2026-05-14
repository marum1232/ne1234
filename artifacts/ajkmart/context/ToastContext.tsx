import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
  runOnJS,
} from "react-native-reanimated";
import { Platform, TouchableOpacity, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ToastType = "success" | "error" | "info" | "warning";
type IoniconName = keyof typeof Ionicons.glyphMap;

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastCtx {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastCtx>({ showToast: () => {} });

const COLORS: Record<ToastType, { bg: string; icon: IoniconName; text: string }> = {
  success: { bg: "#065F46", icon: "checkmark-circle",     text: "#ffffff" },
  error:   { bg: "#991B1B", icon: "alert-circle",         text: "#ffffff" },
  info:    { bg: "#1E40AF", icon: "information-circle",   text: "#ffffff" },
  warning: { bg: "#92400E", icon: "warning",              text: "#ffffff" },
};

function ToastBanner({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const c = COLORS[item.type];
  const progress = useSharedValue(0);
  const doneCalled = useRef(false);

  const callDone = useCallback(() => {
    if (!doneCalled.current) {
      doneCalled.current = true;
      onDone();
    }
  }, [onDone]);

  useEffect(() => {
    progress.value = withSequence(
      withSpring(1, { damping: 12, stiffness: 180 }),
      withDelay(2800, withTiming(0, { duration: 250 })),
    );
    const timer = setTimeout(callDone, 2800 + 250 + 100);
    return () => clearTimeout(timer);
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -20 }],
  }));

  return (
    <Animated.View
      style={[
        ts.banner,
        {
          backgroundColor: c.bg,
          top: Platform.OS === "web" ? 72 : insets.top + 10,
        },
        animStyle,
      ]}
    >
      <Ionicons name={c.icon} size={20} color={c.text} />
      <Text style={[ts.bannerTxt, { color: c.text }]} numberOfLines={3}>{item.message}</Text>
      <TouchableOpacity activeOpacity={0.7} onPress={callDone} style={ts.closeBtn}>
        <Ionicons name="close" size={16} color={c.text} />
      </TouchableOpacity>
    </Animated.View>
  );
}

let _id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++_id;
    setToasts(prev => [...prev.slice(-1), { id, message, type }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.map(t => (
        <ToastBanner key={t.id} item={t} onDone={() => remove(t.id)} />
      ))}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const ts = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    elevation: 10,
    ...Platform.select({
      web: { boxShadow: "0 4px 12px rgba(0,0,0,0.25)" } as object,
      default: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12 },
    }),
  },
  bannerTxt: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
  },
  closeBtn: {
    padding: 2,
  },
});

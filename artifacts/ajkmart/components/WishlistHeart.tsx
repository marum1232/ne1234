import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { TouchableOpacity, StyleSheet, Alert, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, withSequence } from "react-native-reanimated";
import { useQueryClient, useQuery } from "@tanstack/react-query";

import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { addToWishlist, removeFromWishlist, getWishlist, type WishlistItem } from "@workspace/api-client-react";
import { AuthGateSheet, useAuthGate } from "@/components/AuthGateSheet";

const PENDING_KEY_PREFIX = "@ajkmart_pending_wishlist_";

export function WishlistHeart({
  productId,
  size = 18,
  style,
  initialState,
}: {
  productId: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  initialState?: boolean;
}) {
  const { colors: C } = useTheme();
  const { user, token, isCustomer } = useAuth();
  const isLoggedIn = !!user && !!token;
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const heartScale = useSharedValue(1);
  const { requireAuth, sheetProps } = useAuthGate();
  const pendingFiredRef = useRef(false);

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const { data: wishlistItems } = useQuery({
    queryKey: ["wishlist"],
    queryFn: () => getWishlist(),
    enabled: isLoggedIn && isCustomer,
    staleTime: 60 * 1000,
  });

  const isInWishlistFromCache = wishlistItems?.some((item: WishlistItem) => item.productId === productId) ?? false;
  const [localOverride, setLocalOverride] = useState<boolean | null>(null);
  const isInWishlist = localOverride !== null ? localOverride : (initialState !== undefined ? initialState : isInWishlistFromCache);

  useEffect(() => {
    setLocalOverride(null);
  }, [isInWishlistFromCache]);

  useEffect(() => {
    if (!isLoggedIn || !isCustomer || pendingFiredRef.current) return;
    const key = `${PENDING_KEY_PREFIX}${productId}`;
    AsyncStorage.getItem(key).then(async (val) => {
      if (val !== "1") return;
      pendingFiredRef.current = true;
      await AsyncStorage.removeItem(key).catch(() => {
        // no-op: removal failure is non-critical
      });
      if (!isInWishlistFromCache) {
        setLocalOverride(true);
        try {
          await addToWishlist(productId);
          queryClient.invalidateQueries({ queryKey: ["wishlist"] });
        } catch {
          setLocalOverride(null);
        }
      }
    }).catch(() => {
      // no-op: storage read failure is non-critical
    });
  }, [isLoggedIn, isCustomer, productId]);

  const toggle = useCallback(async () => {
    if (!isLoggedIn) {
      const key = `${PENDING_KEY_PREFIX}${productId}`;
      await AsyncStorage.setItem(key, "1").catch(() => {
        // no-op: storing pending wishlist item failed
      });
      requireAuth(() => {}, { message: "Sign in to save items to your wishlist" });
      return;
    }
    if (!isCustomer) {
      return;
    }
    if (loading) return;
    setLoading(true);
    const was = isInWishlist;
    setLocalOverride(!was);
    heartScale.value = withSequence(
      withTiming(1.4, { duration: 100 }),
      withSpring(1, { damping: 8, stiffness: 180 }),
    );
    try {
      if (was) {
        await removeFromWishlist(productId);
      } else {
        await addToWishlist(productId);
      }
      queryClient.invalidateQueries({ queryKey: ["wishlist"] });
    } catch (err: unknown) {
      setLocalOverride(was);
      const code = (err as { code?: string; data?: { code?: string } })?.code ?? (err as { code?: string; data?: { code?: string } })?.data?.code;
      if (code !== "ROLE_DENIED") {
        Alert.alert("Wishlist Error", "Could not update wishlist. Please try again.");
      }
    }
    setLoading(false);
  }, [isLoggedIn, isCustomer, productId, isInWishlist, loading, queryClient]);

  if (isLoggedIn && !isCustomer) {
    return null;
  }

  return (
    <>
      <AuthGateSheet {...sheetProps} />
      <Animated.View style={[heartStyle, style]}>
        <TouchableOpacity activeOpacity={0.7}
          onPress={(e) => { e?.stopPropagation?.(); toggle(); }}
          style={s.btn}
          hitSlop={6}
          accessibilityLabel={isInWishlist ? "Remove from wishlist" : "Add to wishlist"}
          accessibilityHint={isInWishlist ? "Tap to remove this item from your wishlist" : "Tap to add this item to your wishlist"}
          accessibilityRole="button"
        >
          <Ionicons
            name={isInWishlist ? "heart" : "heart-outline"}
            size={size}
            color={isInWishlist ? C.danger : "rgba(255,255,255,0.9)"}
          />
        </TouchableOpacity>
      </Animated.View>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center", justifyContent: "center",
  },
});

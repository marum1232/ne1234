import React, { useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { StyleProp, ViewStyle } from "react-native";
import { radii } from "@/constants/colors";
import { useTheme } from "@/context/ThemeContext";

export function SkeletonBlock({
  w,
  h,
  r = radii.lg,
  style,
}: {
  w: number | string;
  h: number;
  r?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors: C } = useTheme();
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 700 }),
        withTiming(0.35, { duration: 700 }),
      ),
      -1,
      false,
    );
    return () => {
      opacity.value = 0.35;
    };
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: w as number,
          height: h,
          borderRadius: r,
          backgroundColor: C.slate,
        },
        animStyle,
        style,
      ]}
    />
  );
}

import React, { useEffect } from "react";
import { TouchableOpacity, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
} from "react-native-reanimated";

interface AnimatedPressableProps {
  children: React.ReactNode;
  onPress: () => void;
  style?: ViewStyle | ViewStyle[];
  delay?: number;
  disabled?: boolean;
}

export function AnimatedPressable({
  children,
  onPress,
  style,
  delay = 0,
  disabled = false,
}: AnimatedPressableProps) {
  const scale = useSharedValue(0.96);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withDelay(
      delay,
      withSpring(1, { damping: 7, stiffness: 50 }),
    );
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 350 }),
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 500 });
  };

  const onPressOut = () => {
    scale.value = withSpring(1, { damping: 10, stiffness: 350 });
  };

  return (
    <Animated.View style={[animatedStyle, style]}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={disabled ? undefined : onPress}
        style={{ flex: 1 }}
        disabled={disabled}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

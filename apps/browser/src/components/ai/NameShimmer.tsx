import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { useGroupNaming } from "../../lib/ai/groupNaming";

const PERIOD_MS = 1100;

export function NameShimmer({ groupId, children }: { groupId: string; children: ReactNode }) {
  const thinking = useGroupNaming((s) => !!s.thinking[groupId]);
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!thinking) {
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: PERIOD_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: PERIOD_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [thinking]);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {children}
    </Animated.View>
  );
}

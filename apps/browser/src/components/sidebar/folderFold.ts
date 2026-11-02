import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

export const FOLDER_OPEN_MS = 260;
export const FOLDER_CLOSE_MS = 200;
const FOLDER_EASING = Easing.bezier(0.22, 0.8, 0.28, 1);

export function useFolderFold(collapsed: boolean): { open: Animated.Value; moving: boolean } {
  const open = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  const [settled, setSettled] = useState(collapsed);
  const [running, setRunning] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setRunning(true);
    const animation = Animated.timing(open, {
      toValue: collapsed ? 0 : 1,
      duration: collapsed ? FOLDER_CLOSE_MS : FOLDER_OPEN_MS,
      easing: FOLDER_EASING,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (!finished) return;
      setSettled(collapsed);
      setRunning(false);
    });
    return () => animation.stop();
  }, [collapsed]);
  return { open, moving: running || settled !== collapsed };
}

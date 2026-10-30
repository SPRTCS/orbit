import { Surface } from "@ardia/shell";
import { useEffect, useRef, type RefObject } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { create } from "zustand";
import { useGlassSidebar } from "../../lib/glassTheme";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { sidebarEntries } from "../sidebar/entries";
import { rowSpan } from "../sidebar/geometry";

export const GLIDE_SPRING = { stiffness: 784, damping: 56, mass: 1 };

type Glide = { to: string; from: number; target: number; key: number };

const useGlide = create<Record<string, Glide | undefined>>()(() => ({}));

if (__DEV__) (globalThis as { orbitGlide?: typeof useGlide }).orbitGlide = useGlide;

export function useGlidingTo(windowId: string, tabId: string): boolean {
  return useGlide((g) => g[windowId]?.to === tabId);
}

type GlideGeometry = { regions: Record<string, number>; newTabAtTop: boolean };

let glides = 0;

function glideFor(s: BrowserState, prev: BrowserState, windowId: string, profileId: string, geometry: GlideGeometry): Glide | null {
  const from = prev.windows[windowId]?.activeTabIds[profileId];
  const to = s.windows[windowId]?.activeTabIds[profileId];
  if (!from || !to || from === to || s.windows[windowId]?.profileId !== profileId || prev.windows[windowId]?.profileId !== profileId) return null;
  const before = sidebarEntries(prev, windowId, profileId).list;
  const after = sidebarEntries(s, windowId, profileId).list;
  if (before.length !== after.length || before.some((e, i) => e !== after[i])) return null;
  if (!after.includes(`t:${from}`) || !after.includes(`t:${to}`)) return null;
  const a = rowSpan(prev, windowId, profileId, from, geometry.newTabAtTop);
  const b = rowSpan(s, windowId, profileId, to, geometry.newTabAtTop);
  if (a?.section !== "list" || b?.section !== "list") return null;
  const base = geometry.regions.list ?? 0;
  return { to, from: base + a.top, target: base + b.top, key: ++glides };
}

export function SelectionGlide({ windowId, profileId, geometry }: { windowId: string; profileId: string; geometry: RefObject<GlideGeometry | null> }) {
  const glass = useGlassSidebar();
  useEffect(() => {
    if (!glass) return;
    const unsubscribe = useBrowser.subscribe((s, prev) => {
      if (s.windows === prev.windows || !geometry.current) return;
      const glide = glideFor(s, prev, windowId, profileId, geometry.current);
      if (glide) useGlide.setState({ [windowId]: glide });
    });
    return () => {
      unsubscribe();
      useGlide.setState({ [windowId]: undefined });
    };
  }, [glass, windowId, profileId]);
  const glide = useGlide((g) => g[windowId]);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{glass && glide ? <GlidingPill windowId={windowId} glide={glide} /> : null}</View>;
}

function GlidingPill({ windowId, glide }: { windowId: string; glide: Glide }) {
  const theme = useTheme();
  const y = useRef(new Animated.Value(glide.from)).current;
  useEffect(() => {
    Animated.spring(y, { toValue: glide.target, ...GLIDE_SPRING, restDisplacementThreshold: 0.25, restSpeedThreshold: 2, useNativeDriver: true }).start(() => {
      if (useGlide.getState()[windowId]?.key === glide.key) useGlide.setState({ [windowId]: undefined });
    });
  }, [glide.key]);
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: layout.rowHeight, transform: [{ translateY: y }] }}>
      <Surface
        fill={hex(theme.tabSelected)}
        cornerRadius={10}
        borderWidth={0.5}
        borderColors={theme.tabSelectedBorder.map(hex)}
        shadowColor={hex(theme.tabSelectedShadow)}
        shadowOpacity={1}
        shadowRadius={theme.tabSelectedShadowRadius}
        shadowOffset={[0, 0.5]}
        style={{ height: layout.rowHeight }}
      />
    </Animated.View>
  );
}

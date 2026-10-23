import { memo, useMemo } from "react";
import { tabBoosts } from "../../lib/boosts/runtime";
import { useZap } from "../../lib/boosts/zap";
import { useBoosts } from "../../store/boosts";
import { useTab } from "../../store/hooks";
import { ToolbarButton } from "../layout/controls";
import { type ToolbarPalette } from "../layout/toolbarColors";

export function useActiveBoosts(tabId: string) {
  const tab = useTab(tabId);
  const boosts = useBoosts((b) => b.boosts);
  const url = tab?.url;
  const profileId = tab?.profileId;
  return useMemo(() => (url && profileId ? tabBoosts(boosts, { url, profileId }, true) : []), [boosts, url, profileId]);
}

export const BoostIndicator = memo(function BoostIndicator({ tabId, palette, onPress }: { tabId: string; palette: ToolbarPalette; onPress: () => void }) {
  const active = useActiveBoosts(tabId);
  const zapping = useZap((z) => z.session?.tabId === tabId);
  if (!active.length && !zapping) return null;
  const names = active.map((b) => b.name).join(", ");
  return (
    <ToolbarButton
      palette={palette}
      icon={zapping ? "eye.slash" : "paintbrush.pointed.fill"}
      size={12}
      box={24}
      radius={6}
      onPress={onPress}
      active={zapping}
      tooltip={zapping ? "Zapping elements on this page" : active.length === 1 ? `Boost on: ${names}` : `${active.length} boosts on: ${names}`}
    />
  );
});

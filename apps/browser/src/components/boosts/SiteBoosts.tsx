import { useMemo } from "react";
import { newBoostForSite, openBoosts, toggleZap } from "../../lib/boosts/actions";
import { tabBoosts } from "../../lib/boosts/runtime";
import { useZap } from "../../lib/boosts/zap";
import { updateBoost, useBoosts } from "../../store/boosts";
import { useTab } from "../../store/hooks";
import { isIncognitoProfile } from "../../store/model";
import { PopoverRow, Toggle } from "../layout/controls";
import { SectionTitle } from "../site/SiteControlsParts";
import { useActiveBoosts } from "./BoostIndicator";

export function SiteBoosts({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const tab = useTab(tabId);
  const boosts = useBoosts((b) => b.boosts);
  const active = useActiveBoosts(tabId);
  const zapping = useZap((z) => z.session?.tabId === tabId);
  const url = tab?.url ?? "";
  const profileId = tab?.profileId ?? "";
  const site = useMemo(() => (url ? tabBoosts(boosts, { url, profileId }, false) : []), [boosts, url, profileId]);
  if (!tab || !/^https?:\/\//i.test(url)) return null;
  const incognito = isIncognitoProfile(profileId);
  const detail = (id: string, enabled: boolean, allowedPrivately: boolean) =>
    active.some((b) => b.id === id) ? "On for this page" : incognito && enabled && !allowedPrivately ? "Off in private windows" : enabled ? "Not on this page" : "Off";
  return (
    <>
      <SectionTitle title="Boosts" />
      {site.map((boost) => (
        <PopoverRow
          key={boost.id}
          icon="paintbrush.pointed"
          title={boost.name}
          detail={detail(boost.id, boost.enabled, boost.incognito)}
          onPress={() => {
            onClose();
            openBoosts(boost.id);
          }}
          accessory={<Toggle value={boost.enabled} onChange={(enabled) => updateBoost(boost.id, { enabled })} />}
        />
      ))}
      <PopoverRow
        icon="eye.slash"
        title={zapping ? "Stop Zapping" : "Zap Elements…"}
        detail={zapping ? undefined : "Click things on the page to hide them"}
        onPress={() => {
          onClose();
          toggleZap(tabId);
        }}
      />
      <PopoverRow
        icon={site.length ? "slider.horizontal.3" : "plus"}
        title={site.length ? "Edit Boosts…" : "New Boost…"}
        onPress={() => {
          onClose();
          openBoosts(site.length ? site[0]!.id : newBoostForSite(url));
        }}
      />
    </>
  );
}

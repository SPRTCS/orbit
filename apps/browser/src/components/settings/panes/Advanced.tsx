import { engineInfo, listComponents, WIDEVINE_COMPONENT_ID, type EngineComponent, type EngineInfo } from "@ardia/ardiacore";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { systemInfo } from "@ardia/shell";
import { describeCliInstall, installCliInBackground, useCli } from "../../../lib/cliControl";
import { openUrls } from "../../../lib/actions";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { openInternalPage } from "../../pages/urls";
import type { BatterySaverWhen } from "../../../store/settings";
import { Button, Group, PopUp, Row, SectionHeader, Toggle, useFormColors } from "../controls";
import { AgentsSection } from "./Agents";

const REPOSITORY = "https://github.com/SPRTCS/orbit";
const SOURCE_NOTICE = "Orbit is open source under the Apache License 2.0, based on Ardia by Mantra Patel.";

const BATTERY_SAVER_DESCRIPTIONS: Record<BatterySaverWhen, string> = {
  lowBattery: "At 20% battery or less, or in Low Power Mode, busy background tabs pause and animations slow down.",
  unplugged: "On battery or in Low Power Mode, busy background tabs pause and animations slow down.",
  never: "Background tabs and animations run at full speed on battery.",
};

export function AdvancedPane() {
  const theme = useTheme();
  const settings = useBrowser((s) => s.settings);
  const update = useBrowser((s) => s.updateSettings);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [widevine, setWidevine] = useState<EngineComponent | null | undefined>(undefined);
  useEffect(() => {
    void engineInfo().then(setInfo).catch(() => {});
    void listComponents()
      .then((list) => setWidevine(list.find((c) => c.id === WIDEVINE_COMPONENT_ID) ?? null))
      .catch(() => setWidevine(null));
  }, []);
  const widevineVersion = widevine && widevine.version !== "0.0.0.0" ? widevine.version : null;

  return (
    <View>
      <SectionHeader title="Browsing" />
      <Group>
        <Row title="Show full URL in the address bar" description="Instead of the site alone.">
          <Toggle value={settings.showFullUrl} onChange={(v) => update({ showFullUrl: v })} />
        </Row>
        <Row title="Warn before moving tabs between profiles" description="Some site data doesn't come along.">
          <Toggle value={settings.warnBeforeMovingTabsToProfile} onChange={(v) => update({ warnBeforeMovingTabsToProfile: v })} />
        </Row>
        <Row title="Show the Import bookmarks button" description="On an empty bookmarks bar.">
          <Toggle value={!settings.hideBookmarksBarImport} onChange={(v) => update({ hideBookmarksBarImport: !v })} />
        </Row>
      </Group>

      <SectionHeader title="Performance" />
      <Group>
        <Row title="Battery Saver" description={BATTERY_SAVER_DESCRIPTIONS[settings.batterySaverWhen]}>
          <PopUp
            value={settings.batterySaverWhen}
            options={[
              { value: "lowBattery", title: "When battery is low" },
              { value: "unplugged", title: "When unplugged" },
              { value: "never", title: "Never" },
            ]}
            onChange={(v) => update({ batterySaverWhen: v })}
            minWidth={190}
          />
        </Row>
      </Group>

      <SectionHeader title="Data" />
      <Group>
        <Row title="History" description="Every page you visited, by day.">
          <Button title="Show History" onPress={() => openInternalPage("history")} />
        </Row>
        <Row title="Downloads" description="Files you downloaded, with where they're saved.">
          <Button title="Show Downloads" onPress={() => openInternalPage("downloads")} />
        </Row>
      </Group>

      <CommandLineSection />
      <AgentsSection />

      <SectionHeader title="Web engine" />
      <Group>
        <Row title="Chromium" description={info ? "ArdiaCore" : undefined}>
          <Text selectable style={{ fontSize: 13, color: theme.textSecondary }}>
            {info?.chromiumVersion ?? "…"}
          </Text>
        </Row>
        <Row
          title="Widevine (protected video)"
          description={
            widevine === undefined
              ? "Checking…"
              : widevineVersion
                ? `Version ${widevineVersion}`
                : "Not available in this build: video that needs it, like Netflix or Disney+, won't play."
          }
        />
      </Group>

      <SectionHeader title="Source and licenses" />
      <Group>
        <Row title="Source code" description={SOURCE_NOTICE}>
          <Button title="Show on GitHub" onPress={() => openUrls([`${REPOSITORY}/tree/v${systemInfo().appVersion}`])} />
        </Row>
        <Row title="Licenses" description="Every open-source part of the engine, with its copyright and license.">
          <Button title="Show Licenses" onPress={() => openUrls(["chrome://credits"])} />
        </Row>
      </Group>
    </View>
  );
}

function CommandLineSection() {
  const theme = useTheme();
  const colors = useFormColors();
  const on = useBrowser((s) => s.settings.cliControl ?? false);
  const update = useBrowser((s) => s.updateSettings);
  const cli = useCli();
  const server = cli.server;
  const serverNote =
    server?.state === "external"
      ? "This instance already has a DevTools port from the command line, so the setting leaves it alone."
      : server?.reason
        ? server.reason
        : on && server?.state === "on"
          ? server.connections
            ? `Connected now: ${server.connections === 1 ? "1 session" : `${server.connections} sessions`}.`
            : "On. Nothing is connected."
          : "While it's on, the command can open, read and act in every page you're signed in to, and it stays on after you quit.";
  return (
    <>
      <SectionHeader title="Command line" />
      <Group>
        <Row title="Let the ardia command control Orbit" description={serverNote}>
          <Toggle value={on} onChange={(v) => update({ cliControl: v })} />
        </Row>
        <Row
          title="The ardia command"
          description={
            <Text selectable style={{ fontSize: 11.5, marginTop: 2, lineHeight: 15, color: cli.error && !cli.installing ? colors.destructive : theme.textSecondary }}>
              {describeCliInstall(cli)}
            </Text>
          }
        >
          <Button
            title={cli.installing ? "Installing…" : cli.installedVersion ? "Reinstall" : "Install"}
            disabled={!!cli.installing}
            onPress={() => void installCliInBackground("settings")}
          />
        </Row>
      </Group>
    </>
  );
}

import { copyText } from "@ardia/shell";
import { Text } from "react-native";
import { allowAgentsIn, dataPartners, effectiveSpaces, setAgentsCloseAnyTab, spaceIds, useAgentSpaces } from "../../../lib/agentSpaces";
import { useCli } from "../../../lib/cliControl";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { Button, Group, Row, SectionHeader, Toggle } from "../controls";

export const MCP_INSTALL_COMMAND = "ardia mcp install --target claude-code";

export function AgentsSection() {
  const theme = useTheme();
  const control = useBrowser((s) => s.settings.cliControl ?? false);
  const profiles = useBrowser((s) => s.profiles);
  const profileOrder = useBrowser((s) => s.profileOrder);
  const choices = useAgentSpaces();
  const connections = useCli((s) => (s.server?.state === "on" ? (s.server.connections ?? 0) : 0));
  const spaces = { profiles, profileOrder };
  const effective = effectiveSpaces(spaces, choices.allowed);
  const name = (id: string) => profiles[id]?.name ?? id;
  const status = !control
    ? "Off: turn on \"Let the ardia command control Orbit\" first. It's the master switch."
    : effective.size === 0
      ? "On, but no space is allowed yet, so agents see no tabs."
      : connections
        ? "An agent or the ardia command is connected now."
        : "Ready. Agents see only the tabs of the spaces allowed below, never private windows.";
  return (
    <>
      <SectionHeader title="AI agents (MCP)" />
      <Group>
        <Row
          title="Connect an agent"
          description={
            <Text selectable style={{ fontSize: 11.5, marginTop: 2, lineHeight: 15, color: theme.textSecondary }}>
              {`Claude Code, Claude Desktop, Codex and Cursor can use Orbit through the ardia command's MCP server. Run once in Terminal: ${MCP_INSTALL_COMMAND} (or claude-desktop, codex, cursor).`}
            </Text>
          }
        >
          <Button title="Copy Command" onPress={() => copyText(MCP_INSTALL_COMMAND)} />
        </Row>
        <Row title="Status" description={status} />
      </Group>
      <Group>
        {spaceIds(spaces).map((id) => {
          const partners = dataPartners(spaces, id);
          const allowed = choices.allowed.includes(id);
          const waiting = allowed && !effective.has(id);
          return (
            <Row
              key={id}
              title={`Allow AI agents in ${name(id)}`}
              description={
                partners.length
                  ? `${waiting ? "Waiting: " : ""}shares its data with ${partners.map(name).join(", ")}, so agents get in only when ${partners.length === 1 ? "that space is" : "those spaces are"} allowed too.`
                  : allowed
                    ? "Agents can list, open, read and act in this space's tabs."
                    : "Agents can't see this space's tabs."
              }
            >
              <Toggle value={allowed} onChange={(v) => allowAgentsIn(id, v)} />
            </Row>
          );
        })}
        <Row title="Let agents close any tab" description="Otherwise they close only the tabs they opened.">
          <Toggle value={choices.closeAnyTab} onChange={setAgentsCloseAnyTab} />
        </Row>
      </Group>
    </>
  );
}

# Orbit for AI agents (MCP)

`ardia mcp` is an [MCP](https://modelcontextprotocol.io) server that lets AI agents (Claude Code, Claude Desktop,
Codex, Cursor) use the user's own Orbit: list and open tabs, read pages, click, type, take screenshots and search
history. It is opt-in twice over: the master switch "Let the ardia command control Orbit" must be on, and each space
(Orbit's profiles) must be allowed on its own. Nothing is allowed by default.

## Setup

1. In Orbit: Settings › Advanced › Command line › turn on "Let the ardia command control Orbit".
2. Same pane, "AI agents (MCP)": turn on "Allow AI agents in <space>" for each space agents may use.
3. In Terminal, add the server to your agent (the row "Connect an agent" copies the command):

| Agent | Command | File it edits |
| --- | --- | --- |
| Claude Code | `ardia mcp install --target claude-code` | `~/.claude.json` (`--project`: `./.mcp.json`) |
| Claude Desktop | `ardia mcp install --target claude-desktop` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `ardia mcp install --target cursor` | `~/.cursor/mcp.json` (`--project`: `./.cursor/mcp.json`) |
| Codex | `ardia mcp install --target codex` | `~/.codex/config.toml` |

`--target` repeats. Only the `orbit` entry (`mcpServers.orbit`, or `[mcp_servers.orbit]` in Codex's TOML) changes;
the file is copied to `<file>.orbit-backup-<time>` first and replaced atomically, and a file that doesn't parse or is
a symbolic link is left alone. `ardia mcp uninstall --target …` removes the entry. `--data-dir DIR` pins the server
to one data dir (test instances). Restart the agent afterwards.

The entry runs the installed launcher (`~/.local/bin/ardia mcp`); from a repo checkout it runs
`<python> -m ardia_cli mcp` with `PYTHONPATH` set to `apps/cli`, so it works before a CLI release exists.

By hand, any MCP client: command `ardia`, args `["mcp"]`, stdio transport.

## Tools

Tab ids are DevTools target ids, from `list_tabs` or `open_tab`. Tools that take `tab` default to the tab the user is
looking at, when it's in an allowed space. Results are JSON text; `screenshot` returns a JPEG image.

| Tool | What it does |
| --- | --- |
| `list_spaces` | Every space: `name`, `allowed`, `open_tabs` (allowed ones), `shares_data_with`. |
| `list_tabs(space?)` | Tabs of allowed spaces: `id`, `title`, `url`, `space`, `pinned`, `active`, `opened_by_agent`. |
| `open_tab(url, space?, background=true)` | Opens an http(s) URL in a new tab, waits for the load. |
| `navigate(tab, url)` | Loads an http(s) URL in a tab. |
| `activate_tab(tab)` | Brings a tab to the front. |
| `close_tab(tab)` | Closes a tab the agent opened (any tab only with "Let agents close any tab"). |
| `read_page(tab?, format=markdown\|text, max_chars=20000)` | Visible content; markdown keeps headings, links, lists, tables. |
| `find_in_page(query, tab?, limit=20)` | Match count and each match in context. |
| `click(tab?, selector?, text?, index=0)` | Clicks by CSS selector or visible text/label. |
| `type(text, tab?, selector?, field?, clear, submit)` | Types into a field found by selector, label/placeholder/name, or the focused one. |
| `scroll(tab?, direction, amount?, selector?, text?)` | Scrolls the page or brings an element into view. |
| `wait_for(tab?, selector?, text?, timeout=10)` | Waits (≤ 60 s) for a visible element or text. |
| `screenshot(tab?, quality=80)` | The tab's visible area as JPEG. |
| `search_history(query, days=7, limit=50)` | History of the allowed spaces (the `history()` helper), filtered by words. |
| `pinned()` | Favorites and pinned tabs of the allowed spaces (the `pinned()` helper). |

Errors come back as tool errors with a sentence the agent can act on (nothing allowed, tab not visible, Orbit not
running, a password field, and so on).

## Permissions

- **Master switch.** The server connects only through `ArdiaControl.json` (the same checks as `ardia exec`: regular
  file, owned by the user, mode 0600, live pid). With the switch off it answers "Orbit isn't running, or … is off".
- **Spaces.** The app publishes `<data dir>/agent-spaces.json` (`lib/agentSpaces.ts`): the user's choices
  (`allowed`, `closeAnyTab`) and, while control is on, the DevTools browser context id of each allowed space plus
  the target ids of its tabs (learned with `Target.getTargetInfo` on the tab's own DevTools session, `devToolsTarget`
  on the WebView). The server reads it on every call (no symlinks, owned by the user) and only ever sees targets
  whose `browserContextId` belongs to an allowed space. Context ids are random per run, so a stale file opens
  nothing. Turning a space off takes effect on the next call.
- **Private windows** are never published (off-the-record contexts) and incognito entries are dropped when read.
- **Spaces that share data** ("Share data with…") share one browser context, so they count as allowed only when every
  space sharing it is allowed.
- **New tabs.** Chrome opens `Target.createTarget` tabs in the space the user is looking at. The server opens
  `about:blank`, checks where it landed, and closes it before loading anything if that space isn't allowed (or isn't
  the `space` asked for).
- **Closing.** Only tabs the agent opened in this server's lifetime, unless the user turns on "Let agents close any
  tab".

## Safety

- It never closes or crashes Orbit: every WebSocket goes through `guard.direct_connect` (refuses `Browser.close`,
  `Browser.crash`, `Browser.crashGpuProcess`, no proxies), and the token policy in the engine limits the methods.
- No cookies, passwords, Login Data or Web Data: no tool reads them; `read_page` leaves out form field values,
  `type` refuses password fields, history and pinned come from the existing read-only helpers.
- Page scripts run in an isolated world (`Page.createIsolatedWorld`), so a page can't tamper with them.
- Input events go to a tab only while it's visible; a background tab gets script clicks and value setting instead, so
  no queued click fires later when the user opens it.
- Output is redacted like `ardia exec` (the control token never appears).
- The connection is opened per call and dropped after 20 s idle, so Orbit's "controlling" bar (`CliControlBar`)
  shows while an agent works, and its Stop button turns the master switch off.
- Page content is untrusted: the server's instructions tell the agent to treat it as data.

## Testing

- `python -m unittest discover -s apps/cli/tests` (`tests/test_mcp.py`: a fake DevTools server with allowed, blocked
  and incognito contexts; tools in-process and over the MCP protocol; config editing).
- `pnpm -C apps/browser test` (`lib/agentSpaces.test.mjs`: what the app publishes).
- End to end: a hidden instance without `ARDIA_REMOTE_DEBUGGING_PORT` and with `"settings": {"cliControl": true}` in
  its `session.json`; allow a space with `acAgents.allow("<profile id>", true)` in the dev harness; then run
  `python -m ardia_cli mcp --data-dir <dir>` under an MCP client (`mcp.Client(StdioServerParameters(…))`).

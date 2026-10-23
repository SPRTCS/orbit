import sys

MCP_DESCRIPTION = """\
Run Orbit's MCP server on stdin/stdout, so AI agents (Claude Code, Claude Desktop, Codex, Cursor) can use the
tabs of the spaces the user opened to them in Orbit (Settings › Advanced › AI agents (MCP)).

Tools: list_spaces, list_tabs, open_tab, navigate, activate_tab, close_tab, read_page, find_in_page, click, type,
scroll, wait_for, screenshot, search_history, pinned.

It needs "Let the ardia command control Orbit" on. It connects only while it works (and 20 s after), never closes
Orbit, sees no private windows and never reads cookies, passwords or saved logins.
"""
INSTALL_DESCRIPTION = """\
Add Orbit's MCP server to an agent's config. Only the "orbit" entry changes, and the file is backed up first
(<file>.orbit-backup-<time>).

Targets and files (user level; --project uses the current directory):
  claude-code     ~/.claude.json                                                   ./.mcp.json
  claude-desktop  ~/Library/Application Support/Claude/claude_desktop_config.json
  cursor          ~/.cursor/mcp.json                                               ./.cursor/mcp.json
  codex           ~/.codex/config.toml
"""


def add_parser(commands, formatter) -> None:
    from ardia_cli.mcp_install import TARGETS

    mcp = commands.add_parser("mcp", help="run Orbit's MCP server for AI agents", description=MCP_DESCRIPTION, formatter_class=formatter)
    mcp.add_argument("--data-dir", metavar="DIR", help="Orbit's data dir (default: $ARDIA_DATA_DIR, else the installed Orbit's)")
    mcp.add_argument("--port", type=int, metavar="N", help="a plain DevTools server on 127.0.0.1:N (testing)")
    mcp.add_argument("--ws", metavar="URL", help="a browser WebSocket URL (testing)")
    sub = mcp.add_subparsers(dest="mcp_command", metavar="<command>")
    for name, remove in (("install", False), ("uninstall", True)):
        command = sub.add_parser(
            name,
            help=f"{'remove the server from' if remove else 'add the server to'} an agent's MCP config",
            description=INSTALL_DESCRIPTION,
            formatter_class=formatter,
        )
        command.add_argument("--target", action="append", choices=TARGETS, required=True, metavar="TARGET", help="claude-code, claude-desktop, cursor or codex; repeat for several")
        command.add_argument("--project", action="store_true", help="the current directory's project config (claude-code, cursor)")
        if not remove:
            command.add_argument("--data-dir", dest="install_data_dir", metavar="DIR", help="pin the server to this data dir")
        command.set_defaults(mcp_remove=remove)


def run(args, parser) -> int:
    if args.mcp_command in ("install", "uninstall"):
        from ardia_cli import mcp_install

        return mcp_install.run(args.target, args.project, getattr(args, "install_data_dir", None), args.mcp_remove)
    return serve(args)


def serve(args) -> int:
    import asyncio

    from ardia_cli import redact as redaction
    from ardia_cli.agent_browser import AgentBrowser
    from ardia_cli.agent_policy import default_data_root
    from ardia_cli.endpoint import explicit_data_root
    from ardia_cli.mcp_server import build_server

    err = sys.stderr = redaction.RedactingStream(sys.stderr)
    redaction.install_log_redaction()
    explicit = bool(args.port or args.ws)
    root = explicit_data_root(args.data_dir) if explicit else default_data_root(args.data_dir)
    data_dir = None if explicit else str(root)
    browser = AgentBrowser(ws=args.ws, port=args.port, data_dir=data_dir, root=root)
    server = build_server(browser, root)

    async def main():
        try:
            await server.run_stdio_async()
        finally:
            await browser.close()

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        return 130
    finally:
        err.drain()
    return 0

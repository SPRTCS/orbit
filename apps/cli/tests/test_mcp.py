import asyncio
import base64
import json
import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import agent_scripts, mcp_install
from ardia_cli.agent_browser import AgentBrowser, AgentError
from ardia_cli.agent_policy import POLICY_FILE, PolicyError, read_policy
from ardia_cli.redact import MASK, add_secret

SCRIPTS = {name: getattr(agent_scripts, name) for name in ("READ", "FIND", "LOCATE_CLICK", "CLICK_FALLBACK", "FOCUS_FIELD", "FIELD_STATE", "SET_VALUE_FALLBACK", "SUBMIT_FALLBACK", "SCROLL", "CHECK")}
ALLOWED = "CTX-ALLOWED"
BLOCKED = "CTX-BLOCKED"
INCOGNITO = "CTX-INCOGNITO"
TOKEN = "fake-control-token-0123456789abcdef"


class FakeBrowser:
    def __init__(self):
        self.targets = {
            "T-WORK": {"targetId": "T-WORK", "type": "page", "url": "https://work.test/", "title": "Work page", "browserContextId": ALLOWED},
            "T-PRIVATE": {"targetId": "T-PRIVATE", "type": "page", "url": "https://bank.test/", "title": "Bank", "browserContextId": BLOCKED},
            "T-INCOGNITO": {"targetId": "T-INCOGNITO", "type": "page", "url": "https://secret.test/", "title": "Secret", "browserContextId": INCOGNITO},
            "T-BLANK": {"targetId": "T-BLANK", "type": "page", "url": "about:blank", "title": "", "browserContextId": ALLOWED},
            "T-WORKER": {"targetId": "T-WORKER", "type": "service_worker", "url": "https://work.test/sw.js", "title": "", "browserContextId": ALLOWED},
        }
        self.new_context = ALLOWED
        self.calls: list[tuple[str, dict, str | None]] = []
        self.page_text = "Hello from the page"
        self.hidden = False
        self.counter = 0

    def handle(self, method, params, session):
        self.calls.append((method, params, session))
        if method == "Target.getTargets":
            return {"targetInfos": [dict(t) for t in self.targets.values()]}
        if method == "Target.getTargetInfo":
            target = self.targets.get(params.get("targetId"))
            return {"targetInfo": dict(target)} if target else {"__error": "No target with given id found"}
        if method == "Target.createTarget":
            self.counter += 1
            target_id = f"T-NEW-{self.counter}"
            self.targets[target_id] = {"targetId": target_id, "type": "page", "url": params["url"], "title": "", "browserContextId": self.new_context}
            return {"targetId": target_id}
        if method == "Target.closeTarget":
            return {"success": self.targets.pop(params["targetId"], None) is not None}
        if method == "Target.activateTarget":
            return {}
        if method == "Target.attachToTarget":
            return {"sessionId": f"S-{params['targetId']}"}
        target_id = session[2:] if session else None
        if method == "Page.navigate":
            self.targets[target_id]["url"] = params["url"]
            self.targets[target_id]["title"] = "Loaded"
            return {"frameId": "F"}
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "F"}}}
        if method == "Page.createIsolatedWorld":
            return {"executionContextId": 7}
        if method == "Page.captureScreenshot":
            return {"data": base64.b64encode(b"JPEG-BYTES").decode()}
        if method.startswith("Input."):
            return {}
        if method == "Runtime.evaluate":
            return {"result": {"type": "object", "value": self.evaluate(params["expression"], target_id)}}
        return {"__error": f"{method} not faked"}

    def evaluate(self, expression, target_id):
        if expression == agent_scripts.READY_STATE:
            return "complete"
        for name, script in SCRIPTS.items():
            if "ARGS" not in script:
                if expression == agent_scripts.wrap(script, {}):
                    return self.run(name, {}, target_id)
                continue
            head, tail = script.split("ARGS")
            head = "(() => {" + head
            tail = tail + "})()"
            if expression.startswith(head) and expression.endswith(tail):
                args = json.loads(expression[len(head) : len(expression) - len(tail)])
                return self.run(name, args, target_id)
        raise AssertionError("unknown script")

    def run(self, name, args, target_id):
        target = self.targets[target_id]
        if name == "READ":
            return {"title": target["title"], "url": target["url"], "content": self.page_text}
        if name == "FIND":
            return {"query": args["query"], "count": self.page_text.count(args["query"]), "matches": [self.page_text]}
        if name == "LOCATE_CLICK":
            return {"tag": "button", "text": args.get("text") or "Go", "x": 10, "y": 20, "hidden": self.hidden, "covered": None}
        if name == "CLICK_FALLBACK":
            return {"tag": "button", "text": "Go"}
        if name == "FOCUS_FIELD":
            return {"tag": "input", "text": "Search", "focused": True, "hidden": self.hidden}
        if name == "FIELD_STATE":
            return {"focused": True, "has": True, "length": len(args["text"])}
        if name in ("SET_VALUE_FALLBACK",):
            return {"ok": True}
        if name == "SUBMIT_FALLBACK":
            return {"submitted": True}
        if name == "SCROLL":
            return {"scroll_y": 100, "scroll_x": 0, "height": 1000, "viewport": 500, "at_bottom": False}
        if name == "CHECK":
            return {"found": (args.get("text") or "") in self.page_text}
        raise AssertionError(name)

    def methods(self):
        return [method for method, _, _ in self.calls]


class FakeServer:
    def __init__(self, browser: FakeBrowser):
        self.browser = browser
        self.server = None
        self.port = None

    async def start(self):
        import websockets

        async def serve(connection):
            async for raw in connection:
                message = json.loads(raw)
                result = self.browser.handle(message["method"], message.get("params") or {}, message.get("sessionId"))
                reply = {"id": message["id"]}
                if isinstance(result, dict) and "__error" in result:
                    reply["error"] = {"code": -32000, "message": result["__error"]}
                else:
                    reply["result"] = result
                if message.get("sessionId"):
                    reply["sessionId"] = message["sessionId"]
                await connection.send(json.dumps(reply))

        self.server = await websockets.serve(serve, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]
        return f"ws://127.0.0.1:{self.port}/devtools/browser/fake?token={TOKEN}"

    async def stop(self):
        self.server.close()
        await self.server.wait_closed()


def write_policy(root: Path, allowed=("work",), close_any=False, tabs=None):
    spaces = [
        {"id": "work", "name": "Work", "allowed": "work" in allowed, "sharesDataWith": [], "contexts": [ALLOWED] if "work" in allowed else []},
        {"id": "default", "name": "Personal", "allowed": "default" in allowed, "sharesDataWith": [], "contexts": [BLOCKED] if "default" in allowed else []},
        {"id": "incognito:w@default", "name": "Incognito", "allowed": True, "contexts": [INCOGNITO]},
    ]
    doc = {"version": 1, "allowed": list(allowed), "closeAnyTab": close_any, "spaces": spaces, "tabs": tabs or {"T-WORK": {"space": "work", "pinned": True}}}
    (root / POLICY_FILE).write_text(json.dumps(doc))


class AgentTools(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        write_policy(self.root)
        self.fake = FakeBrowser()
        self.server = FakeServer(self.fake)
        url = await self.server.start()
        self.browser = AgentBrowser(ws=url, root=self.root, idle=60)

    async def asyncTearDown(self):
        await self.browser.close()
        await self.server.stop()
        self.temp.cleanup()

    async def test_only_allowed_spaces_are_visible(self):
        tabs = await self.browser.list_tabs()
        self.assertEqual([t["id"] for t in tabs], ["T-WORK"])
        self.assertEqual(tabs[0]["space"], "Work")
        self.assertTrue(tabs[0]["pinned"])
        self.assertFalse(tabs[0]["opened_by_agent"])

    async def test_incognito_never_counts_even_if_listed(self):
        tabs = await self.browser.list_tabs()
        self.assertNotIn("T-INCOGNITO", [t["id"] for t in tabs])
        spaces = await self.browser.list_spaces()
        self.assertNotIn("Incognito", [s["name"] for s in spaces])

    async def test_nothing_allowed_is_a_clear_error(self):
        write_policy(self.root, allowed=())
        with self.assertRaisesRegex(AgentError, "No space is open to AI agents"):
            await self.browser.list_tabs()
        self.assertNotIn("Target.getTargets", self.fake.methods())

    async def test_tabs_of_other_spaces_cant_be_touched(self):
        for call in (
            self.browser.read_page("T-PRIVATE"),
            self.browser.click("T-PRIVATE", text="Pay"),
            self.browser.screenshot("T-PRIVATE"),
            self.browser.activate_tab("T-PRIVATE"),
            self.browser.close_tab("T-INCOGNITO"),
        ):
            with self.assertRaisesRegex(AgentError, "no tab"):
                await call
        sessions = {session for _, _, session in self.fake.calls if session}
        self.assertEqual(sessions, set())
        self.assertNotIn("Target.attachToTarget", self.fake.methods())

    async def test_disallowing_takes_effect_at_once(self):
        self.assertEqual(len(await self.browser.list_tabs()), 1)
        write_policy(self.root, allowed=())
        with self.assertRaises(AgentError):
            await self.browser.read_page("T-WORK")

    async def test_open_tab_in_an_allowed_space(self):
        tab = await self.browser.open_tab("https://example.com/")
        self.assertTrue(tab["opened_by_agent"])
        self.assertEqual(tab["space"], "Work")
        self.assertEqual(self.fake.targets[tab["id"]]["url"], "https://example.com/")
        create = next(p for m, p, _ in self.fake.calls if m == "Target.createTarget")
        self.assertEqual(create, {"url": "about:blank", "background": True})

    async def test_open_tab_that_lands_in_a_blocked_space_is_closed_before_loading(self):
        self.fake.new_context = BLOCKED
        with mock.patch("ardia_cli.agent_browser.CONTEXT_WAIT", 0.2):
            with self.assertRaisesRegex(AgentError, "isn't open to agents"):
                await self.browser.open_tab("https://example.com/")
        self.assertIn("Target.closeTarget", self.fake.methods())
        self.assertNotIn("Page.navigate", self.fake.methods())
        self.assertFalse(any(t["url"] == "https://example.com/" for t in self.fake.targets.values()))

    async def test_open_tab_refuses_other_schemes(self):
        for url in ("file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "ardia://history"):
            with self.assertRaisesRegex(AgentError, "http"):
                await self.browser.open_tab(url)
        self.assertNotIn("Target.createTarget", self.fake.methods())

    async def test_open_tab_in_a_named_space_that_isnt_allowed(self):
        with self.assertRaisesRegex(AgentError, "isn't open to AI agents"):
            await self.browser.open_tab("https://example.com/", space="Personal")

    async def test_close_only_what_the_agent_opened(self):
        with self.assertRaisesRegex(AgentError, "only the tabs they opened"):
            await self.browser.close_tab("T-WORK")
        self.assertIn("T-WORK", self.fake.targets)
        tab = await self.browser.open_tab("https://example.com/")
        self.assertTrue((await self.browser.close_tab(tab["id"]))["closed"])
        write_policy(self.root, close_any=True)
        self.assertTrue((await self.browser.close_tab("T-WORK"))["closed"])

    async def test_read_page_truncates_and_redacts(self):
        add_secret(TOKEN)
        self.fake.page_text = f"start {TOKEN} " + "x" * 5000
        page = await self.browser.read_page("T-WORK", "text", 300)
        self.assertTrue(page["truncated"])
        self.assertEqual(len(page["content"]), 300)
        self.assertNotIn(TOKEN, page["content"])
        self.assertIn(MASK, page["content"])
        world = next(p for m, p, _ in self.fake.calls if m == "Runtime.evaluate" and "contextId" in p)
        self.assertEqual(world["contextId"], 7)

    async def test_default_tab_needs_an_active_allowed_tab(self):
        with self.assertRaisesRegex(AgentError, "give a tab id"):
            await self.browser.read_page(None)

    async def test_click_uses_the_mouse_on_a_visible_tab(self):
        result = await self.browser.click("T-WORK", text="Go")
        self.assertEqual(result["how"], "mouse")
        mouse = [p["type"] for m, p, _ in self.fake.calls if m == "Input.dispatchMouseEvent"]
        self.assertEqual(mouse, ["mouseMoved", "mousePressed", "mouseReleased"])

    async def test_click_never_sends_input_to_a_hidden_tab(self):
        self.fake.hidden = True
        result = await self.browser.click("T-WORK", selector="button")
        self.assertEqual(result["how"], "script")
        self.assertFalse(any(m.startswith("Input.") for m in self.fake.methods()))

    async def test_type_and_submit(self):
        result = await self.browser.type_text("T-WORK", "hello", field="Search", submit=True)
        self.assertEqual(result["how"], "keyboard")
        self.assertTrue(result["submitted"])
        self.assertIn(("Input.insertText", {"text": "hello"}, "S-T-WORK"), self.fake.calls)
        keys = [p["key"] for m, p, _ in self.fake.calls if m == "Input.dispatchKeyEvent"]
        self.assertEqual(keys, ["Enter", "Enter"])

    async def test_wait_for_times_out_cleanly(self):
        found = await self.browser.wait_for("T-WORK", text="Hello", timeout=1)
        self.assertTrue(found["found"])
        missing = await self.browser.wait_for("T-WORK", text="never", timeout=0.3)
        self.assertFalse(missing["found"])

    async def test_connection_is_dropped_when_idle(self):
        self.browser.idle = 0.2
        await self.browser.list_tabs()
        self.assertIsNotNone(self.browser.cdp)
        await asyncio.sleep(1.5)
        self.assertIsNone(self.browser.cdp)
        self.assertEqual(len(await self.browser.list_tabs()), 1)

    async def test_never_sends_browser_close(self):
        await self.browser.list_tabs()
        await self.browser.open_tab("https://example.com/")
        self.assertFalse(any(m.startswith("Browser.") for m in self.fake.methods()))


class ThroughMcp(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        write_policy(self.root)
        self.fake = FakeBrowser()
        self.server = FakeServer(self.fake)
        url = await self.server.start()
        self.browser = AgentBrowser(ws=url, root=self.root, idle=60)

    async def asyncTearDown(self):
        await self.browser.close()
        await self.server.stop()
        self.temp.cleanup()

    async def test_tools_over_the_protocol(self):
        from mcp import Client

        from ardia_cli.mcp_server import build_server

        server = build_server(self.browser, self.root)
        async with Client(server) as client:
            names = {tool.name for tool in (await client.list_tools()).tools}
            self.assertEqual(
                names,
                {"list_spaces", "list_tabs", "open_tab", "navigate", "activate_tab", "close_tab", "read_page", "find_in_page", "click", "type", "scroll", "wait_for", "screenshot", "search_history", "pinned"},
            )
            tabs = await client.call_tool("list_tabs", {})
            self.assertFalse(tabs.is_error)
            self.assertEqual([t["id"] for t in json.loads(tabs.content[0].text)], ["T-WORK"])
            shot = await client.call_tool("screenshot", {"tab": "T-WORK"})
            self.assertFalse(shot.is_error)
            image = next(c for c in shot.content if c.type == "image")
            self.assertEqual(image.mime_type, "image/jpeg")
            self.assertEqual(base64.b64decode(image.data), b"JPEG-BYTES")
            refused = await client.call_tool("close_tab", {"tab": "T-WORK"})
            self.assertTrue(refused.is_error)
            self.assertIn("only the tabs they opened", refused.content[0].text)
            hidden = await client.call_tool("read_page", {"tab": "T-PRIVATE"})
            self.assertTrue(hidden.is_error)


class PolicyFile(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_missing_file_allows_nothing(self):
        self.assertEqual(read_policy(self.root).allowed, ())
        self.assertEqual(read_policy(None).allowed, ())

    def test_symlink_is_refused(self):
        real = self.root / "elsewhere.json"
        write_policy(self.root)
        (self.root / POLICY_FILE).rename(real)
        (self.root / POLICY_FILE).symlink_to(real)
        with self.assertRaisesRegex(PolicyError, "symbolic link"):
            read_policy(self.root)

    def test_garbage_allows_nothing(self):
        (self.root / POLICY_FILE).write_text("{not json")
        self.assertEqual(read_policy(self.root).allowed, ())
        (self.root / POLICY_FILE).write_text(json.dumps({"version": 2, "spaces": [{"id": "x", "allowed": True, "contexts": ["C"]}]}))
        self.assertEqual(read_policy(self.root).allowed, ())

    def test_incognito_entries_are_dropped(self):
        write_policy(self.root, allowed=("work", "default"))
        policy = read_policy(self.root)
        self.assertEqual({s.name for s in policy.allowed}, {"Work", "Personal"})
        self.assertIsNone(policy.space_of_context(INCOGNITO))


class Install(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.patch = mock.patch.object(Path, "home", return_value=self.home)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def quiet(self, *args):
        with mock.patch("builtins.print"):
            return mcp_install.run(*args)

    def test_claude_desktop_keeps_other_servers_and_backs_up(self):
        path = self.home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"mcpServers": {"other": {"command": "x"}}, "theme": "dark"}))
        self.assertEqual(self.quiet(["claude-desktop"], False, None, False), 0)
        data = json.loads(path.read_text())
        self.assertEqual(data["theme"], "dark")
        self.assertEqual(data["mcpServers"]["other"], {"command": "x"})
        entry = data["mcpServers"]["orbit"]
        self.assertIn("mcp", entry["args"])
        backups = list(path.parent.glob("claude_desktop_config.json.orbit-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text())["mcpServers"], {"other": {"command": "x"}})
        self.assertEqual(self.quiet(["claude-desktop"], False, None, True), 0)
        self.assertEqual(json.loads(path.read_text())["mcpServers"], {"other": {"command": "x"}})

    def test_claude_code_entry_is_stdio_and_pins_the_data_dir(self):
        self.assertEqual(self.quiet(["claude-code"], False, str(self.home / "data"), False), 0)
        entry = json.loads((self.home / ".claude.json").read_text())["mcpServers"]["orbit"]
        self.assertEqual(entry["type"], "stdio")
        self.assertEqual(entry["args"][-2:], ["--data-dir", str((self.home / "data").resolve())])

    def test_invalid_json_is_left_alone(self):
        path = self.home / ".cursor" / "mcp.json"
        path.parent.mkdir(parents=True)
        path.write_text("{oops")
        self.assertEqual(self.quiet(["cursor"], False, None, False), 1)
        self.assertEqual(path.read_text(), "{oops")
        self.assertEqual(list(path.parent.glob("*.orbit-backup-*")), [])

    def test_codex_toml_is_edited_in_place(self):
        path = self.home / ".codex" / "config.toml"
        path.parent.mkdir(parents=True)
        path.write_text('model = "x"\n\n[mcp_servers.orbit]\ncommand = "old"\nargs = []\n\n[mcp_servers.orbit.env]\nA = "1"\n\n[mcp_servers.other]\ncommand = "keep"\n')
        self.assertEqual(self.quiet(["codex"], False, None, False), 0)
        data = tomllib.loads(path.read_text())
        self.assertEqual(data["model"], "x")
        self.assertEqual(data["mcp_servers"]["other"], {"command": "keep"})
        self.assertNotEqual(data["mcp_servers"]["orbit"]["command"], "old")
        self.assertIn("mcp", data["mcp_servers"]["orbit"]["args"])
        self.assertEqual(self.quiet(["codex"], False, None, True), 0)
        data = tomllib.loads(path.read_text())
        self.assertNotIn("orbit", data["mcp_servers"])
        self.assertEqual(data["mcp_servers"]["other"], {"command": "keep"})

    def test_project_config(self):
        cwd = os.getcwd()
        os.chdir(self.home)
        try:
            self.assertEqual(self.quiet(["claude-code", "cursor"], True, None, False), 0)
            self.assertIn("orbit", json.loads((self.home / ".mcp.json").read_text())["mcpServers"])
            self.assertIn("orbit", json.loads((self.home / ".cursor" / "mcp.json").read_text())["mcpServers"])
            self.assertEqual(self.quiet(["codex"], True, None, False), 1)
        finally:
            os.chdir(cwd)

    def test_symlinked_config_is_refused(self):
        real = self.home / "real.json"
        real.write_text("{}")
        (self.home / ".cursor").mkdir()
        (self.home / ".cursor" / "mcp.json").symlink_to(real)
        self.assertEqual(self.quiet(["cursor"], False, None, False), 1)
        self.assertEqual(real.read_text(), "{}")


if __name__ == "__main__":
    unittest.main()

import asyncio
import base64
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from ardia_cli import agent_scripts as scripts
from ardia_cli.agent_policy import NOTHING_ALLOWED, Policy, PolicyError, Space, read_policy
from ardia_cli.cdp import Cdp, CdpError, ConnectionLost
from ardia_cli.endpoint import NOT_REACHABLE, Endpoint, EndpointError, resolve
from ardia_cli.redact import redact

PAGE_SCHEMES = ("http:", "https:", "about:", "data:", "blob:")
OPEN_SCHEMES = ("http", "https")
CONNECT_TIMEOUT = 10
ACTIVE_TIMEOUT = 3
IDLE_SECONDS = 20
LOAD_TIMEOUT = 20
CONTEXT_WAIT = 4
MAX_WAIT = 60
WORLD = "orbit-agent"


class AgentError(RuntimeError):
    pass


def _clean(text: str) -> str:
    return redact(text)


class AgentBrowser:
    def __init__(self, ws: str | None = None, port: int | None = None, data_dir: str | None = None, root: Path | None = None, idle: float = IDLE_SECONDS):
        self.ws = ws
        self.port = port
        self.data_dir = data_dir
        self.root = root
        self.idle = idle
        self.cdp: Cdp | None = None
        self.endpoint: Endpoint | None = None
        self.sessions: dict[str, str] = {}
        self.opened: set[str] = set()
        self.busy = 0
        self.last_used = 0.0
        self.connecting = asyncio.Lock()
        self.reaper: asyncio.Task | None = None

    def policy(self) -> Policy:
        try:
            return read_policy(self.root)
        except PolicyError as error:
            raise AgentError(str(error)) from None

    def allowed_policy(self) -> Policy:
        policy = self.policy()
        if not policy.allowed:
            raise AgentError(NOTHING_ALLOWED)
        return policy

    async def _connect(self) -> Cdp:
        async with self.connecting:
            if self.cdp is not None and not self.cdp.closed.is_set():
                return self.cdp
            await self._drop()
            try:
                endpoint = resolve(ws=self.ws, port=self.port, data_dir=self.data_dir)
            except EndpointError as error:
                raise AgentError(str(error)) from None
            cdp = Cdp(endpoint.ws)
            try:
                await cdp.open(CONNECT_TIMEOUT)
            except Exception as error:
                await cdp.close()
                detail = f" ({type(error).__name__})" if endpoint.explicit else ""
                raise AgentError(_clean(f"{NOT_REACHABLE}{detail}" if not endpoint.explicit else f"can't connect to {endpoint.source}{detail}")) from None
            cdp.listeners.append(self._on_event)
            self.cdp = cdp
            self.endpoint = endpoint
            if self.reaper is None or self.reaper.done():
                self.reaper = asyncio.ensure_future(self._reap())
            return cdp

    def _on_event(self, method, params, _session):
        if method == "Target.detachedFromTarget":
            session = params.get("sessionId")
            for target, known in list(self.sessions.items()):
                if known == session:
                    del self.sessions[target]
        elif method == "Target.targetDestroyed":
            self.sessions.pop(params.get("targetId"), None)

    async def _drop(self):
        cdp, self.cdp = self.cdp, None
        self.sessions.clear()
        if cdp is not None:
            await cdp.close()

    async def _reap(self):
        try:
            while self.cdp is not None:
                await asyncio.sleep(min(self.idle, 1.0))
                if self.busy == 0 and time.monotonic() - self.last_used >= self.idle:
                    async with self.connecting:
                        if self.busy == 0 and time.monotonic() - self.last_used >= self.idle:
                            await self._drop()
        except asyncio.CancelledError:
            pass

    async def close(self):
        if self.reaper is not None:
            self.reaper.cancel()
            await asyncio.gather(self.reaper, return_exceptions=True)
        await self._drop()

    @asynccontextmanager
    async def use(self):
        self.busy += 1
        try:
            cdp = await self._connect()
            try:
                yield cdp
            except ConnectionLost:
                await self._drop()
                raise AgentError(NOT_REACHABLE if not (self.endpoint and self.endpoint.explicit) else "lost the connection to the browser") from None
            except CdpError as error:
                raise AgentError(_clean(str(error))) from None
        finally:
            self.busy -= 1
            self.last_used = time.monotonic()

    async def _active_target(self) -> str | None:
        if not self.endpoint or not self.endpoint.active:
            return None
        url = self.endpoint.active

        def fetch():
            import urllib.request

            direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with direct.open(url, timeout=ACTIVE_TIMEOUT) as response:
                answer = json.loads(response.read(64 * 1024))
            target = answer.get("targetId") if isinstance(answer, dict) else None
            return target if isinstance(target, str) else None

        try:
            return await asyncio.wait_for(asyncio.to_thread(fetch), ACTIVE_TIMEOUT + 1)
        except Exception:
            return None

    async def _targets(self, cdp: Cdp, policy: Policy) -> list[tuple[dict, Space]]:
        infos = (await cdp.send("Target.getTargets")).get("targetInfos") or []
        active = await self._active_target()
        found = []
        for info in infos:
            if info.get("type") != "page" or not str(info.get("url", "")).startswith(PAGE_SCHEMES):
                continue
            target_id = info.get("targetId")
            if info.get("url") == "about:blank" and target_id not in self.opened and target_id != active:
                continue
            space = policy.space_of_target(target_id, info.get("browserContextId"))
            if space is None:
                continue
            found.append((dict(info, active=target_id == active), space))
        return found

    def _describe(self, info: dict, space: Space, policy: Policy) -> dict:
        target_id = info["targetId"]
        return {
            "id": target_id,
            "title": _clean(info.get("title") or ""),
            "url": _clean(info.get("url") or ""),
            "space": space.name,
            "pinned": policy.pinned(target_id),
            "active": bool(info.get("active")),
            "opened_by_agent": target_id in self.opened,
        }

    async def _tab(self, cdp: Cdp, policy: Policy, tab: str | None) -> tuple[dict, Space]:
        targets = await self._targets(cdp, policy)
        if tab:
            for info, space in targets:
                if info["targetId"] == tab:
                    return info, space
            raise AgentError(f"no tab {tab!r} in a space open to agents; call list_tabs for the current ids")
        for info, space in targets:
            if info.get("active"):
                return info, space
        raise AgentError("give a tab id from list_tabs: the tab the user is looking at isn't in a space open to agents (or Orbit shows New Tab)")

    async def _session(self, cdp: Cdp, target_id: str) -> str:
        session = self.sessions.get(target_id)
        if session:
            return session
        result = await cdp.send("Target.attachToTarget", {"targetId": target_id, "flatten": True})
        session = result.get("sessionId")
        if not isinstance(session, str):
            raise AgentError("couldn't attach to the tab")
        self.sessions[target_id] = session
        return session

    async def _world(self, cdp: Cdp, session: str) -> int:
        tree = await cdp.send("Page.getFrameTree", session=session)
        frame = ((tree.get("frameTree") or {}).get("frame") or {}).get("id")
        if not frame:
            raise AgentError("the tab has no page loaded")
        world = await cdp.send("Page.createIsolatedWorld", {"frameId": frame, "worldName": WORLD}, session=session)
        context = world.get("executionContextId")
        if not isinstance(context, int):
            raise AgentError("couldn't reach the page")
        return context

    async def _run(self, cdp: Cdp, session: str, script: str, args: dict, timeout: float = 15):
        context = await self._world(cdp, session)
        result = await cdp.send(
            "Runtime.evaluate",
            {"expression": scripts.wrap(script, args), "contextId": context, "returnByValue": True, "awaitPromise": True},
            session=session,
            timeout=timeout,
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            message = (details.get("exception") or {}).get("description") or details.get("text") or "script error"
            raise AgentError(_clean(f"the page script failed: {message.splitlines()[0]}"))
        value = (result.get("result") or {}).get("value")
        if isinstance(value, dict) and value.get("error"):
            raise AgentError(_clean(str(value["error"])))
        return value

    async def _wait_loaded(self, cdp: Cdp, session: str, timeout: float = LOAD_TIMEOUT) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                result = await cdp.send("Runtime.evaluate", {"expression": scripts.READY_STATE, "returnByValue": True}, session=session, timeout=5)
                if (result.get("result") or {}).get("value") == "complete":
                    return True
            except CdpError:
                pass
            await asyncio.sleep(0.2)
        return False

    async def list_spaces(self) -> list[dict]:
        policy = self.policy()
        rows = []
        for space in policy.spaces:
            row = {"name": space.name, "allowed": space.allowed}
            if space.shares_data_with:
                names = {s.id: s.name for s in policy.spaces}
                row["shares_data_with"] = [names.get(i, i) for i in space.shares_data_with]
            rows.append(row)
        if any(space.allowed for space in policy.spaces):
            async with self.use() as cdp:
                counts: dict[str, int] = {}
                for _, space in await self._targets(cdp, policy):
                    counts[space.name] = counts.get(space.name, 0) + 1
            for row in rows:
                if row["allowed"]:
                    row["open_tabs"] = counts.get(row["name"], 0)
        return rows

    async def list_tabs(self, space: str | None = None) -> list[dict]:
        policy = self.allowed_policy()
        wanted = self._space(policy, space)
        async with self.use() as cdp:
            targets = await self._targets(cdp, policy)
        return [self._describe(info, s, policy) for info, s in targets if wanted is None or s.id == wanted.id]

    def _space(self, policy: Policy, space: str | None) -> Space | None:
        if not space:
            return None
        try:
            return policy.find_space(space)
        except PolicyError as error:
            raise AgentError(str(error)) from None

    async def open_tab(self, url: str, space: str | None = None, background: bool = True) -> dict:
        parts = urlsplit(url.strip())
        if parts.scheme.lower() not in OPEN_SCHEMES or not parts.netloc:
            raise AgentError("open_tab takes an http:// or https:// URL")
        policy = self.allowed_policy()
        wanted = self._space(policy, space)
        async with self.use() as cdp:
            created = await cdp.send("Target.createTarget", {"url": "about:blank", "background": background})
            target_id = created.get("targetId")
            if not isinstance(target_id, str):
                raise AgentError("Orbit didn't open a tab")
            self.opened.add(target_id)
            landed = await self._landed_space(cdp, target_id)
            if landed is None or (wanted is not None and landed.id != wanted.id):
                self.opened.discard(target_id)
                await self._close_quietly(cdp, target_id)
                if landed is None:
                    raise AgentError(
                        "Orbit opens new tabs in the space the user is looking at, and that space isn't open to agents; "
                        "ask the user to switch to an allowed space, or use a tab from list_tabs"
                    )
                raise AgentError(f"Orbit opens new tabs in the space the user is looking at ({landed.name}), not {wanted.name}; ask the user to switch spaces")
            session = await self._session(cdp, target_id)
            await cdp.send("Page.navigate", {"url": url.strip()}, session=session)
            loaded = await self._wait_loaded(cdp, session)
            if not background:
                await cdp.send("Target.activateTarget", {"targetId": target_id})
            info = (await cdp.send("Target.getTargetInfo", {"targetId": target_id})).get("targetInfo") or {"targetId": target_id}
        row = self._describe(dict(info, active=not background), landed, self.policy())
        row["opened_by_agent"] = True
        row["loaded"] = loaded
        return row

    async def _landed_space(self, cdp: Cdp, target_id: str) -> Space | None:
        info = (await cdp.send("Target.getTargetInfo", {"targetId": target_id})).get("targetInfo") or {}
        context = info.get("browserContextId")
        deadline = time.monotonic() + CONTEXT_WAIT
        while True:
            space = self.policy().space_of_context(context)
            if space is not None or not context or time.monotonic() >= deadline:
                return space
            await asyncio.sleep(0.25)

    async def _close_quietly(self, cdp: Cdp, target_id: str):
        try:
            await cdp.send("Target.closeTarget", {"targetId": target_id})
        except (CdpError, ConnectionLost):
            pass

    async def activate_tab(self, tab: str) -> dict:
        policy = self.allowed_policy()
        async with self.use() as cdp:
            info, space = await self._tab(cdp, policy, tab)
            await cdp.send("Target.activateTarget", {"targetId": info["targetId"]})
        return dict(self._describe(info, space, policy), active=True)

    async def close_tab(self, tab: str) -> dict:
        policy = self.allowed_policy()
        async with self.use() as cdp:
            info, space = await self._tab(cdp, policy, tab)
            target_id = info["targetId"]
            if target_id not in self.opened and not policy.close_any_tab:
                raise AgentError("agents may close only the tabs they opened; the user can allow more in Orbit's Settings › Advanced › AI agents (MCP)")
            result = await cdp.send("Target.closeTarget", {"targetId": target_id})
            self.opened.discard(target_id)
            self.sessions.pop(target_id, None)
        return {"closed": result.get("success", True) is not False, "id": target_id, "space": space.name}

    async def navigate(self, tab: str, url: str) -> dict:
        parts = urlsplit(url.strip())
        if parts.scheme.lower() not in OPEN_SCHEMES or not parts.netloc:
            raise AgentError("navigate takes an http:// or https:// URL")
        policy = self.allowed_policy()
        async with self.use() as cdp:
            info, space = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            await cdp.send("Page.navigate", {"url": url.strip()}, session=session)
            loaded = await self._wait_loaded(cdp, session)
            fresh = (await cdp.send("Target.getTargetInfo", {"targetId": info["targetId"]})).get("targetInfo") or info
        return dict(self._describe(dict(fresh, active=info.get("active")), space, policy), loaded=loaded)

    async def read_page(self, tab: str | None, format: str = "markdown", max_chars: int = 20000) -> dict:
        if format not in ("text", "markdown"):
            raise AgentError("format is text or markdown")
        max_chars = max(200, min(int(max_chars), 200_000))
        policy = self.allowed_policy()
        async with self.use() as cdp:
            info, space = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            page = await self._run(cdp, session, scripts.READ, {"format": format, "max_chars": max_chars}, timeout=30) or {}
        content = _clean(str(page.get("content") or ""))
        truncated = len(content) > max_chars
        return {
            "id": info["targetId"],
            "title": _clean(str(page.get("title") or "")),
            "url": _clean(str(page.get("url") or info.get("url") or "")),
            "space": space.name,
            "format": format,
            "truncated": truncated,
            "content": content[:max_chars],
        }

    async def find_in_page(self, tab: str | None, query: str, limit: int = 20) -> dict:
        if not query:
            raise AgentError("give the text to find")
        policy = self.allowed_policy()
        async with self.use() as cdp:
            info, _ = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            found = await self._run(cdp, session, scripts.FIND, {"query": query, "limit": max(1, min(limit, 100)), "context": 60})
        found["matches"] = [_clean(m) for m in found.get("matches") or []]
        found["id"] = info["targetId"]
        return found

    async def click(self, tab: str | None, selector: str | None = None, text: str | None = None, index: int = 0) -> dict:
        if not selector and not text:
            raise AgentError("give a CSS selector or the visible text to click")
        policy = self.allowed_policy()
        args = {"selector": selector, "text": text, "index": max(0, index)}
        async with self.use() as cdp:
            info, _ = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            spot = await self._run(cdp, session, scripts.LOCATE_CLICK, args)
            how = "script" if spot.get("hidden") else "mouse"
            if how == "mouse":
                for kind, extra in (("mouseMoved", {}), ("mousePressed", {"button": "left", "buttons": 1, "clickCount": 1}), ("mouseReleased", {"button": "left", "buttons": 0, "clickCount": 1})):
                    await cdp.send("Input.dispatchMouseEvent", {"type": kind, "x": spot["x"], "y": spot["y"], **extra}, session=session, timeout=5)
            else:
                await self._run(cdp, session, scripts.CLICK_FALLBACK, args)
        result = {"clicked": {k: spot.get(k) for k in ("tag", "text", "href") if spot.get(k)}, "how": how, "id": info["targetId"]}
        if spot.get("covered"):
            result["warning"] = f"another element was on top of it: {spot['covered']}"
        return json.loads(_clean(json.dumps(result)))

    async def type_text(self, tab: str | None, text: str, selector: str | None = None, field: str | None = None, clear: bool = False, submit: bool = False) -> dict:
        policy = self.allowed_policy()
        args = {"selector": selector, "text": field, "clear": clear}
        async with self.use() as cdp:
            info, _ = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            target = await self._run(cdp, session, scripts.FOCUS_FIELD, args)
            keyboard = not target.get("hidden")
            how = "keyboard" if keyboard else "script"
            if keyboard:
                if clear:
                    await self._key(cdp, session, "Backspace", 8, commands=["deleteBackward"])
                if text:
                    await cdp.send("Input.insertText", {"text": text}, session=session, timeout=5)
                    state = await self._run(cdp, session, scripts.FIELD_STATE, {"text": text})
                    if not (state and state.get("has")):
                        how = "script"
                        await self._run(cdp, session, scripts.SET_VALUE_FALLBACK, {"text": text, "clear": False})
                if submit:
                    await self._key(cdp, session, "Enter", 13, text="\r")
                submitted = submit
            else:
                if text or clear:
                    await self._run(cdp, session, scripts.SET_VALUE_FALLBACK, {"text": text, "clear": clear})
                submitted = bool(submit and (await self._run(cdp, session, scripts.SUBMIT_FALLBACK, {}) or {}).get("submitted"))
        result = {"typed_into": {k: target.get(k) for k in ("tag", "text") if target.get(k)}, "how": how, "submitted": submitted, "id": info["targetId"]}
        return json.loads(_clean(json.dumps(result)))

    async def _key(self, cdp: Cdp, session: str, key: str, code: int, text: str | None = None, commands: list[str] | None = None):
        down = {"type": "keyDown", "key": key, "code": key, "windowsVirtualKeyCode": code}
        if text:
            down["text"] = text
        if commands:
            down["commands"] = commands
        await cdp.send("Input.dispatchKeyEvent", down, session=session, timeout=5)
        await cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": key, "windowsVirtualKeyCode": code}, session=session, timeout=5)

    async def scroll(self, tab: str | None, direction: str = "down", amount: int | None = None, selector: str | None = None, text: str | None = None) -> dict:
        if direction not in ("down", "up", "top", "bottom", "left", "right"):
            raise AgentError("direction is down, up, top, bottom, left or right")
        policy = self.allowed_policy()
        async with self.use() as cdp:
            info, _ = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            state = await self._run(cdp, session, scripts.SCROLL, {"direction": direction, "amount": amount, "selector": selector, "text": text})
        return dict(state, id=info["targetId"])

    async def wait_for(self, tab: str | None, selector: str | None = None, text: str | None = None, timeout: float = 10) -> dict:
        if not selector and not text:
            raise AgentError("give a CSS selector or text to wait for")
        timeout = max(0.1, min(float(timeout), MAX_WAIT))
        policy = self.allowed_policy()
        started = time.monotonic()
        async with self.use() as cdp:
            info, _ = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            while True:
                try:
                    state = await self._run(cdp, session, scripts.CHECK, {"selector": selector, "text": text}, timeout=5)
                except AgentError as error:
                    if "invalid CSS selector" in str(error):
                        raise
                    state = None
                if state and state.get("found"):
                    return json.loads(_clean(json.dumps({"found": True, "waited": round(time.monotonic() - started, 2), "element": state.get("element"), "id": info["targetId"]})))
                if time.monotonic() - started >= timeout:
                    return {"found": False, "waited": round(time.monotonic() - started, 2), "id": info["targetId"]}
                await asyncio.sleep(0.25)

    async def screenshot(self, tab: str | None, quality: int = 80) -> tuple[bytes, dict]:
        policy = self.allowed_policy()
        async with self.use() as cdp:
            info, space = await self._tab(cdp, policy, tab)
            session = await self._session(cdp, info["targetId"])
            try:
                shot = await cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": max(10, min(int(quality), 100))}, session=session, timeout=15)
            except AgentError:
                raise
            except CdpError as error:
                raise AgentError(f"couldn't capture the tab ({error}); a tab in the background may need activate_tab first") from None
        data = shot.get("data")
        if not isinstance(data, str):
            raise AgentError("the tab returned no picture; a tab in the background may need activate_tab first")
        return base64.b64decode(data), self._describe(info, space, policy)

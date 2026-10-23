import time
from pathlib import Path

from ardia_cli import browsing
from ardia_cli.agent_browser import AgentBrowser, AgentError
from ardia_cli.redact import redact

DEFAULT_PROFILE_ID = "default"


def _root(root: Path | None) -> Path:
    if root is None:
        raise AgentError("this needs Orbit's data dir: start the server with --data-dir DIR or set $ARDIA_DATA_DIR")
    return root


def allowed_folders(root: Path, browser: AgentBrowser) -> dict[str, str]:
    policy = browser.allowed_policy()
    session = browsing.read_session(root, time.monotonic() + browsing.HISTORY_BUDGET)
    profiles = session.get("profiles") or {}
    folders: dict[str, str] = {}
    for space in policy.allowed:
        entry = profiles.get(space.id)
        if not isinstance(entry, dict):
            continue
        data_id = entry.get("dataId") or space.id
        folder = "Default" if data_id == DEFAULT_PROFILE_ID else f"Profile {data_id}"
        folders[folder] = space.name if folder not in folders else f"{folders[folder]} / {space.name}"
    return folders


async def search_history(browser: AgentBrowser, root: Path | None, query: str, days: float, limit: int) -> list[dict]:
    root = _root(root)
    folders = allowed_folders(root, browser)
    words = [word for word in query.casefold().split() if word]
    rows: list[dict] = []
    for folder, name in folders.items():
        try:
            found = await browsing.run_bounded(browsing.history, root, days=days, limit=None, profile=folder)
        except browsing.BrowsingDataError as error:
            if str(error).startswith("no profile named"):
                continue
            raise AgentError(str(error)) from None
        for row in found:
            haystack = f"{row['title']} {row['url']}".casefold()
            if all(word in haystack for word in words):
                rows.append({"title": redact(row["title"]), "url": redact(row["url"]), "visits": row["visits"], "last_visit": row["last_visit"], "space": name})
    rows.sort(key=lambda row: row["last_visit"], reverse=True)
    return rows[:limit]


async def pinned(browser: AgentBrowser, root: Path | None) -> list[dict]:
    root = _root(root)
    policy = browser.allowed_policy()
    allowed = {space.name for space in policy.allowed}
    blocked = {space.name for space in policy.spaces if not space.allowed}
    try:
        rows = await browsing.run_bounded(browsing.pinned, root)
    except browsing.BrowsingDataError as error:
        raise AgentError(str(error)) from None
    return [
        {"title": redact(row["title"] or ""), "url": redact(row["url"] or ""), "kind": row["kind"], "folder": row["folder"], "space": row["profile"]}
        for row in rows
        if row["profile"] in allowed and row["profile"] not in blocked
    ]

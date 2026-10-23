import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

from ardia_cli.mcp_server import SERVER_NAME

CLI_HOME = Path(os.environ.get("ARDIA_CLI_HOME") or Path.home() / "Library" / "Application Support" / "Ardia" / "CLI")
TARGETS = ("claude-code", "claude-desktop", "cursor", "codex")
PROJECT_TARGETS = ("claude-code", "cursor")


class InstallError(RuntimeError):
    pass


def config_path(target: str, project: bool) -> Path:
    home = Path.home()
    if project:
        if target not in PROJECT_TARGETS:
            raise InstallError(f"{target} has no project config; leave out --project")
        return Path.cwd() / (".mcp.json" if target == "claude-code" else ".cursor/mcp.json")
    return {
        "claude-code": home / ".claude.json",
        "claude-desktop": home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json",
        "cursor": home / ".cursor" / "mcp.json",
        "codex": home / ".codex" / "config.toml",
    }[target]


def launch_command(data_dir: str | None) -> tuple[str, list[str], dict[str, str]]:
    package = Path(__file__).resolve().parent
    extra = ["--data-dir", str(Path(data_dir).expanduser().resolve())] if data_dir else []
    try:
        installed = package.is_relative_to(CLI_HOME.resolve())
    except OSError:
        installed = False
    if installed:
        launcher = shutil.which("ardia")
        stable = Path(launcher) if launcher else Path.home() / ".local" / "bin" / "ardia"
        return str(stable), ["mcp", *extra], {}
    return sys.executable, ["-m", "ardia_cli", "mcp", *extra], {"PYTHONPATH": str(package.parent)}


def server_entry(target: str, data_dir: str | None) -> dict:
    command, args, env = launch_command(data_dir)
    entry: dict = {"command": command, "args": args}
    if env:
        entry["env"] = env
    if target == "claude-code":
        entry = {"type": "stdio", **entry}
    return entry


def backup(path: Path) -> Path | None:
    if not path.exists():
        return None
    stamp = time.strftime("%Y%m%d-%H%M%S")
    copy = path.with_name(f"{path.name}.orbit-backup-{stamp}")
    n = 1
    while copy.exists():
        n += 1
        copy = path.with_name(f"{path.name}.orbit-backup-{stamp}-{n}")
    shutil.copy2(path, copy)
    return copy


def write_atomically(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, temp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.chmod(temp, mode)
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def _refuse_links(path: Path) -> None:
    if path.is_symlink():
        raise InstallError(f"{path} is a symbolic link; edit the file it points to by hand")


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
    except ValueError as error:
        raise InstallError(f"{path} isn't valid JSON ({error}); fix it first, nothing was changed") from None
    if not isinstance(data, dict):
        raise InstallError(f"{path} doesn't hold a JSON object; nothing was changed")
    return data


def update_json(path: Path, entry: dict | None) -> str:
    _refuse_links(path)
    data = _read_json(path)
    servers = data.get("mcpServers")
    if servers is not None and not isinstance(servers, dict):
        raise InstallError(f"{path} has an mcpServers that isn't an object; nothing was changed")
    servers = dict(servers or {})
    existed = SERVER_NAME in servers
    if entry is None:
        if not existed:
            return "not installed"
        del servers[SERVER_NAME]
    else:
        servers[SERVER_NAME] = entry
    data["mcpServers"] = servers
    backup(path)
    write_atomically(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return ("replaced" if existed else "added") if entry is not None else "removed"


_TABLE = re.compile(r"^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$")


def _is_ours(header: str) -> bool:
    name = header.replace('"', "").replace("'", "").replace(" ", "")
    return name == f"mcp_servers.{SERVER_NAME}" or name.startswith(f"mcp_servers.{SERVER_NAME}.")


def _toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def update_toml(path: Path, entry: dict | None) -> str:
    import tomllib

    _refuse_links(path)
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    try:
        tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise InstallError(f"{path} isn't valid TOML ({error}); fix it first, nothing was changed") from None
    kept: list[str] = []
    skipping = False
    existed = False
    for line in text.splitlines():
        table = _TABLE.match(line)
        if table:
            skipping = _is_ours(table.group(1))
            existed = existed or skipping
        if not skipping:
            kept.append(line)
    if entry is None and not existed:
        return "not installed"
    body = "\n".join(kept).rstrip()
    if entry is not None:
        block = [f"[mcp_servers.{SERVER_NAME}]", f"command = {_toml_string(entry['command'])}", "args = [" + ", ".join(_toml_string(a) for a in entry["args"]) + "]"]
        if entry.get("env"):
            block.append(f"\n[mcp_servers.{SERVER_NAME}.env]")
            block.extend(f"{key} = {_toml_string(value)}" for key, value in entry["env"].items())
        body = (body + "\n\n" if body else "") + "\n".join(block)
    result = body + "\n" if body else ""
    try:
        parsed = tomllib.loads(result)
    except tomllib.TOMLDecodeError as error:
        raise InstallError(f"couldn't update {path} safely ({error}); nothing was changed") from None
    if entry is not None and parsed.get("mcp_servers", {}).get(SERVER_NAME, {}).get("command") != entry["command"]:
        raise InstallError(f"couldn't update {path} safely; nothing was changed")
    backup(path)
    write_atomically(path, result)
    return ("replaced" if existed else "added") if entry is not None else "removed"


def apply(target: str, project: bool, data_dir: str | None, remove: bool = False) -> tuple[Path, str]:
    path = config_path(target, project)
    entry = None if remove else server_entry(target, data_dir)
    if target == "codex":
        if entry is not None:
            entry = {key: value for key, value in entry.items() if key != "type"}
        return path, update_toml(path, entry)
    return path, update_json(path, entry)


def run(targets: list[str], project: bool, data_dir: str | None, remove: bool) -> int:
    status = 0
    for target in dict.fromkeys(targets):
        try:
            path, outcome = apply(target, project, data_dir, remove)
        except (InstallError, OSError) as error:
            print(f"{target}: error {error}")
            status = 1
            continue
        print(f"{target}: {outcome} \"{SERVER_NAME}\" in {path}")
    if status == 0 and not remove:
        print("Restart the agent to load it. Then allow a space in Orbit: Settings › Advanced › AI agents (MCP).")
    return status

import errno
import json
import os
import stat
from dataclasses import dataclass, field
from pathlib import Path

from ardia_cli.endpoint import INSTALLED_DATA_DIR, explicit_data_root

POLICY_FILE = "agent-spaces.json"
MAX_POLICY_BYTES = 8 * 1024 * 1024
NOTHING_ALLOWED = (
    "No space is open to AI agents. In Orbit, open Settings › Advanced › AI agents (MCP) and turn on "
    "\"Allow AI agents\" for a space (with \"Let the orbit command control Orbit\" on)."
)


class PolicyError(RuntimeError):
    pass


@dataclass(frozen=True)
class Space:
    id: str
    name: str
    allowed: bool
    contexts: frozenset[str]
    shares_data_with: tuple[str, ...] = ()


@dataclass(frozen=True)
class Policy:
    spaces: tuple[Space, ...] = ()
    tabs: dict = field(default_factory=dict)
    close_any_tab: bool = False

    @property
    def allowed(self) -> tuple[Space, ...]:
        return tuple(space for space in self.spaces if space.allowed)

    def space_of_context(self, context: str | None) -> Space | None:
        if not context:
            return None
        owners = [space for space in self.allowed if context in space.contexts]
        if not owners:
            return None
        if len(owners) > 1:
            return Space(owners[0].id, " / ".join(space.name for space in owners), True, owners[0].contexts)
        return owners[0]

    def space_of_target(self, target_id: str, context: str | None) -> Space | None:
        by_context = self.space_of_context(context)
        if by_context is None:
            return None
        mapped = self.tabs.get(target_id)
        if isinstance(mapped, dict):
            exact = next((space for space in self.allowed if space.id == mapped.get("space") and context in space.contexts), None)
            if exact is not None:
                return exact
        return by_context

    def pinned(self, target_id: str) -> bool:
        mapped = self.tabs.get(target_id)
        return bool(isinstance(mapped, dict) and mapped.get("pinned") is True)

    def find_space(self, wanted: str) -> Space:
        key = wanted.strip().casefold()
        matches = [space for space in self.spaces if space.id.casefold() == key or space.name.casefold() == key]
        if not matches:
            known = ", ".join(space.name for space in self.spaces) or "none"
            raise PolicyError(f"no space named {wanted!r} (spaces: {known})")
        allowed = [space for space in matches if space.allowed]
        if not allowed:
            raise PolicyError(f"the space {matches[0].name!r} isn't open to AI agents; the user can allow it in Orbit's Settings › Advanced › AI agents (MCP)")
        return allowed[0]


def default_data_root(data_dir: str | None = None) -> Path:
    explicit = explicit_data_root(data_dir)
    if explicit is not None:
        return explicit
    return INSTALLED_DATA_DIR


def read_policy(root: Path | None) -> Policy:
    if root is None:
        return Policy()
    path = root / POLICY_FILE
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return Policy()
    except OSError as error:
        reason = "is a symbolic link" if error.errno == errno.ELOOP else error.strerror
        raise PolicyError(f"can't read {path.name} ({reason})") from None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise PolicyError(f"{path.name} isn't a regular file")
        if info.st_uid != os.getuid():
            raise PolicyError(f"{path.name} belongs to another user")
        chunks = []
        size = 0
        while chunk := os.read(fd, 1024 * 1024):
            size += len(chunk)
            if size > MAX_POLICY_BYTES:
                raise PolicyError(f"{path.name} is too big")
            chunks.append(chunk)
    finally:
        os.close(fd)
    try:
        doc = json.loads(b"".join(chunks))
    except ValueError:
        return Policy()
    return parse_policy(doc)


def parse_policy(doc) -> Policy:
    if not isinstance(doc, dict) or doc.get("version") != 1:
        return Policy()
    spaces = []
    for entry in doc.get("spaces") or []:
        if not isinstance(entry, dict):
            continue
        space_id = entry.get("id")
        name = entry.get("name")
        if not isinstance(space_id, str) or not space_id or space_id.startswith("incognito:"):
            continue
        contexts = frozenset(c for c in entry.get("contexts") or [] if isinstance(c, str) and c)
        partners = tuple(p for p in entry.get("sharesDataWith") or [] if isinstance(p, str))
        spaces.append(Space(space_id, name if isinstance(name, str) and name else space_id, entry.get("allowed") is True, contexts, partners))
    tabs = doc.get("tabs") if isinstance(doc.get("tabs"), dict) else {}
    return Policy(tuple(spaces), tabs, doc.get("closeAnyTab") is True)

"""Where the chat agent and the Whiteboard page meet, under ``<hermes home>/plugin-data/whiteboard/``.

- ``boards/<id>.json``: a copy of each board that the Whiteboard page writes while chat access is
  on, so the agent can read a board from any chat. The page owns these files: it rewrites one after
  every save and deletes them all when the person turns chat access off.
- ``inbox/<id>.json``: what the agent sent the page, a new board or a set of proposed changes. The
  page takes each entry and acknowledges it, which removes the file. Proposed changes then wait on
  the board until the person reviews them; nothing here writes to a board.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

BOARD_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ENTRY_ID = re.compile(r"^w[0-9a-f]{12}$")
_MAX_INBOX = 50


def data_dir() -> Path:
    try:
        from plugins.plugin_storage import plugin_data_dir
        return plugin_data_dir("whiteboard")
    except Exception:
        home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
        path = home / "plugin-data" / "whiteboard"
        path.mkdir(parents=True, exist_ok=True)
        return path


def hermes_home() -> Path:
    """The Hermes home folder this plugin's data lives in."""
    return data_dir().parent.parent


def _write_json(path: Path, value) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


class Boards:
    """The page's copies of its boards, plus whether the person lets chats see them."""

    def __init__(self, root: Path | None = None):
        self.dir = (root or data_dir()) / "boards"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.settings_path = self.dir.parent / "sharing.json"

    def sharing(self) -> dict:
        value = _read_json(self.settings_path)
        if not isinstance(value, dict):
            return {"known": False, "on": False}
        return {"known": True, "on": bool(value.get("on")), "at": value.get("at")}

    def set_sharing(self, on: bool) -> None:
        _write_json(self.settings_path, {"on": bool(on), "at": time.time()})
        if not on:
            self.prune([])

    def put(self, board: dict) -> bool:
        bid = str(board.get("id") or "")
        if not BOARD_ID.match(bid):
            return False
        _write_json(self.dir / f"{bid}.json", board)
        return True

    def get(self, bid: str) -> dict | None:
        if not BOARD_ID.match(bid or ""):
            return None
        value = _read_json(self.dir / f"{bid}.json")
        return value if isinstance(value, dict) else None

    def all(self) -> list[dict]:
        out = []
        for path in sorted(self.dir.glob("*.json")):
            value = _read_json(path)
            if isinstance(value, dict) and value.get("id"):
                out.append(value)
        out.sort(key=lambda b: -(b.get("updatedAt") or 0))
        return out

    def remove(self, bid: str) -> bool:
        if not BOARD_ID.match(bid or ""):
            return False
        path = self.dir / f"{bid}.json"
        existed = path.exists()
        path.unlink(missing_ok=True)
        return existed

    def prune(self, keep: list[str]) -> int:
        wanted = {b for b in keep if BOARD_ID.match(str(b))}
        removed = 0
        for path in self.dir.glob("*.json"):
            if path.stem not in wanted:
                path.unlink(missing_ok=True)
                removed += 1
        return removed

    def find(self, ref: str) -> dict | None:
        """A board by id, else by name (case-insensitive, exact before a unique prefix)."""
        ref = str(ref or "").strip()
        if not ref:
            return None
        hit = self.get(ref) if BOARD_ID.match(ref) else None
        if hit:
            return hit
        boards = self.all()
        low = ref.lower()
        for board in boards:
            if str(board.get("name", "")).strip().lower() == low:
                return board
        starts = [b for b in boards if str(b.get("name", "")).strip().lower().startswith(low)]
        return starts[0] if len(starts) == 1 else None


class Inbox:
    """Entries the agent sent the page, one JSON file each."""

    def __init__(self, root: Path | None = None):
        self.dir = (root or data_dir()) / "inbox"
        self.dir.mkdir(parents=True, exist_ok=True)

    def put(self, entry: dict) -> None:
        _write_json(self.dir / f"{entry['id']}.json", entry)
        for old in sorted(self.dir.glob("w*.json"), key=lambda p: p.stat().st_mtime)[:-_MAX_INBOX]:
            old.unlink(missing_ok=True)

    def list(self) -> list[dict]:
        out = []
        for path in sorted(self.dir.glob("w*.json"), key=lambda p: p.stat().st_mtime):
            value = _read_json(path)
            if isinstance(value, dict):
                out.append(value)
        return out

    def ack(self, entry_id: str) -> bool:
        if not ENTRY_ID.match(entry_id or ""):
            return False
        path = self.dir / f"{entry_id}.json"
        existed = path.exists()
        path.unlink(missing_ok=True)
        return existed

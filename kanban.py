"""Hermes Kanban for the Whiteboard page: list the boards, make cards from notes, read a board.

A card made here is parked: it lands in Blocked with no assignee, which Hermes leaves alone until a
person unblocks it on the Kanban board. Triage is not a parking place. Hermes reads Triage on its own,
splits a card into tasks and starts them (``kanban.auto_decompose``, on by default), so a card goes
there only when the person ticks "Let Hermes start on them".

Everything goes through the ``hermes kanban`` command, the documented way to reach Kanban from
outside it. This module runs that one command and nothing else: ``boards list``, ``create`` and
``list``, each with ``--json``. It never runs a shell, and no text from a note is used as a flag:
the title follows ``--`` and the body goes in on standard input.

Every function returns ``{"ok": True, ...}`` or ``{"ok": False, "error": "..."}`` and never raises.
"""

from __future__ import annotations

import json
import shutil
import subprocess

MAX_CARDS = 24
MAX_TITLE = 120
MAX_BODY = 4000
MAX_READ = 200
TIMEOUT = 20
#: The columns a board from Kanban is laid out in, in the order Kanban shows them.
STATUSES = ("triage", "todo", "ready", "running", "blocked", "review", "done")
UNAVAILABLE = "Hermes Kanban is not available in this Hermes."


def _hermes(args: list[str], stdin: str | None = None) -> tuple[int, str, str]:
    """Run ``hermes kanban <args>`` and give back its exit code, output and error text."""
    command = shutil.which("hermes")
    if not command:
        raise FileNotFoundError("hermes")
    done = subprocess.run([command, "kanban", *args], input=stdin, capture_output=True, text=True, timeout=TIMEOUT, check=False)  # noqa: S603
    return done.returncode, done.stdout, done.stderr


def _json(run, args: list[str], stdin: str | None = None):
    """The JSON a ``hermes kanban`` call printed. Raises ``RuntimeError`` with Kanban's own words."""
    code, out, err = run(args, stdin)
    if code != 0:
        raise RuntimeError(" ".join(str(err or out or "").split())[:200] or f"hermes kanban exited with {code}")
    return json.loads(out)


def _clean(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit].strip() if limit <= MAX_TITLE else str(value or "").strip()[:limit]


def _boards(run) -> list[dict]:
    """The boards that are not archived, as ``{"slug", "name", "current"}``."""
    listed = _json(run, ["boards", "list", "--json"])
    found = []
    for board in listed if isinstance(listed, list) else []:
        if isinstance(board, dict) and board.get("slug") and not board.get("archived"):
            found.append({"current": bool(board.get("is_current")), "name": str(board.get("name") or board["slug"]), "slug": str(board["slug"])})
    return found


def boards(run=None) -> dict:
    """The Kanban boards a card can go to, and which one is open in Kanban now."""
    try:
        found = _boards(run or _hermes)
    except (FileNotFoundError, OSError):
        return {"ok": False, "error": UNAVAILABLE}
    except Exception as exc:
        return {"ok": False, "error": f"Kanban could not list its boards: {exc}"}
    return {"ok": True, "boards": [{"name": board["name"], "slug": board["slug"]} for board in found], "current": next((board["slug"] for board in found if board["current"]), "")}


def create_cards(board, cards, run=None, start=False) -> dict:
    """Create one card per entry, parked in Blocked, or in Triage when ``start`` is true. ``cards`` are
    ``{"key", "title", "body"}``; ``key`` makes a second click return the card already made instead of
    a duplicate."""
    run = run or _hermes
    if not isinstance(cards, list) or not cards:
        return {"ok": False, "error": "There is nothing to send to Kanban."}
    if len(cards) > MAX_CARDS:
        return {"ok": False, "error": f"Send at most {MAX_CARDS} notes to Kanban at a time."}
    try:
        slug = next((entry["slug"] for entry in _boards(run) if entry["slug"] == str(board or "").strip()), None)
        if slug is None:
            return {"ok": False, "error": "That Kanban board does not exist any more."}
        made = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            title = _clean(card.get("title"), MAX_TITLE)
            if not title:
                continue
            key = _clean(card.get("key"), 100)
            args = ["--board", slug, "create", *(["--triage"] if start is True else ["--initial-status", "blocked"]),
                    "--created-by", "whiteboard", "--body-file", "-", "--json"]
            if key:
                args += ["--idempotency-key", f"whiteboard:{key}"]
            task = _json(run, [*args, "--", title], _clean(card.get("body"), MAX_BODY))
            task_id = str(task.get("id") or "") if isinstance(task, dict) else ""
            if not task_id:
                raise RuntimeError("Kanban did not say which card it made")
            made.append({"id": task_id, "key": key, "title": title})
        if not made:
            return {"ok": False, "error": "Those notes have no text to make a card from."}
        return {"ok": True, "board": slug, "cards": made, "started": start is True}
    except (FileNotFoundError, OSError):
        return {"ok": False, "error": UNAVAILABLE}
    except Exception as exc:
        return {"ok": False, "error": f"Kanban could not create the cards: {exc}"}


def read_board(board, run=None) -> dict:
    """The cards of one Kanban board, grouped by status, for laying out as a whiteboard."""
    run = run or _hermes
    try:
        entry = next((entry for entry in _boards(run) if entry["slug"] == str(board or "").strip()), None)
        if entry is None:
            return {"ok": False, "error": "That Kanban board does not exist any more."}
        tasks = _json(run, ["--board", entry["slug"], "list", "--json"])
        columns = {status: [] for status in STATUSES}
        for task in (tasks if isinstance(tasks, list) else [])[:MAX_READ]:
            if not isinstance(task, dict):
                continue
            status = str(task.get("status") or "")
            title = _clean(task.get("title"), MAX_TITLE)
            if status in columns and title:
                columns[status].append({"id": str(task.get("id") or ""), "title": title})
        return {"ok": True, "board": entry["slug"], "name": entry["name"], "columns": [{"status": status, "cards": found} for status, found in columns.items() if found]}
    except (FileNotFoundError, OSError):
        return {"ok": False, "error": UNAVAILABLE}
    except Exception as exc:
        return {"ok": False, "error": f"Kanban could not read that board: {exc}"}

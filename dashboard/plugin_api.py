"""Backend for the Whiteboard page in Hermes Desktop, mounted at ``/api/plugins/whiteboard/``.

The page writes a copy of each board here while chat access is on, so the agent's whiteboard_*
tools can read it, and it collects what the agent sent (new boards, proposed changes) from the
inbox. Files live under ``<hermes home>/plugin-data/whiteboard/`` (see store.py).

Markdown export also comes through here: the page shows the system save dialog, then asks this
backend to write the one file the person named (see picked.py).

Send to Kanban comes through here too: on a click, the page asks this backend to make cards
in Hermes Kanban, or to read one Kanban board so it can be laid out as a whiteboard (see kanban.py).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter, Body

PLUGIN_DIR = Path(__file__).resolve().parent.parent


def _load(name: str, filename: str):
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / filename)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module


def _store():
    return _load("hermes_whiteboard_store", "store.py")


def _picked():
    return _load("hermes_whiteboard_picked", "picked.py")


def _kanban():
    return _load("hermes_whiteboard_kanban", "kanban.py")


router = APIRouter()


@router.get("/inbox")
def inbox() -> dict:
    return {"entries": _store().Inbox().list()}


@router.post("/inbox/{entry_id}/ack")
def ack(entry_id: str) -> dict:
    return {"removed": _store().Inbox().ack(entry_id)}


@router.post("/sharing")
def sharing(body: dict = Body(...)) -> dict:
    boards = _store().Boards()
    boards.set_sharing(bool(body.get("on")))
    return boards.sharing()


@router.put("/boards/{board_id}")
def put_board(board_id: str, body: dict = Body(...)) -> dict:
    boards = _store().Boards()
    if not boards.sharing()["on"] or str(body.get("id")) != board_id:
        return {"stored": False}
    return {"stored": boards.put(body)}


@router.delete("/boards/{board_id}")
def delete_board(board_id: str) -> dict:
    return {"removed": _store().Boards().remove(board_id)}


@router.post("/boards/prune")
def prune(body: dict = Body(...)) -> dict:
    keep = body.get("keep") if isinstance(body.get("keep"), list) else []
    return {"removed": _store().Boards().prune([str(k) for k in keep])}


@router.post("/picked-file/write")
def write_picked_file(body: dict = Body(...)) -> dict:
    return _picked().write_text(body.get("path"), body.get("text"), _store().hermes_home())


@router.get("/kanban/boards")
def kanban_boards() -> dict:
    return _kanban().boards()


@router.post("/kanban/cards")
def kanban_cards(body: dict = Body(...)) -> dict:
    return _kanban().create_cards(body.get("board"), body.get("cards"), start=body.get("start") is True)


@router.get("/kanban/board/{slug}")
def kanban_board(slug: str) -> dict:
    return _kanban().read_board(slug)

"""The hooks follow a chat only when a board is linked to it, tell the page how its turns go, and tell
the chat what the person changed on the board. They never send a message."""

import json
import sys

import pytest

from test_tools import BOARD, _package  # noqa: F401  (loads the package under test)

_package()
from hermes_whiteboard_under_test import follow, store, tools  # noqa: E402

CHAT = "20261114_090000_ab12cd"
LINKED = {**BOARD, "chat": CHAT}


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    boards = store.Boards()
    boards.set_sharing(True)
    boards.put(LINKED)
    store.Links().set({"b1abc": CHAT, "bad id!": CHAT, "b2": ""})
    sent = []
    monkeypatch.setattr(follow, "_emit", sent.append)
    return sent


def state():
    return store.Follow().read()


def test_a_chat_that_is_not_linked_is_left_alone(home):
    assert follow.on_turn_start(session_id="someone_else", turn_id="t1", user_message="secret") is None
    follow.on_turn_answer(session_id="someone_else", turn_id="t1", assistant_response="secret answer")
    follow.on_turn_end(session_id="someone_else", turn_id="t1", completed=True)
    follow.on_compaction(session_id="new", old_session_id="someone_else")
    assert home == [] and not store.Follow().path.exists()
    assert store.Links().all() == {"b1abc": CHAT}


def test_a_linked_chat_is_told_about_its_board_once_and_the_page_hears_the_turn(home):
    out = follow.on_turn_start(session_id=CHAT, turn_id="t1", user_message="carry on")
    assert 'linked to the board "Q4 retro"' in out["context"] and "whiteboard_propose" in out["context"]
    assert home[-1]["chat"] == CHAT and home[-1]["state"] == "working" and home[-1]["turn"] == "t1"

    follow.on_turn_answer(session_id=CHAT, turn_id="t1", assistant_response="## Refund **sent**\n\nDetails follow.")
    follow.on_turn_end(session_id=CHAT, turn_id="t1", completed=True, failed=False, interrupted=False)
    assert home[-1]["state"] == "done" and home[-1]["headline"] == "Refund sent"
    assert state()["chats"][CHAT]["headline"] == "Refund sent"

    follow.on_turn_answer(session_id=CHAT, turn_id="t1", assistant_response="word " * 40)
    assert len(state()["chats"][CHAT]["headline"]) <= 80 and state()["chats"][CHAT]["headline"].endswith("word…")

    # Nothing new to say on the next turn: no context at all.
    assert follow.on_turn_start(session_id=CHAT, turn_id="t2") is None
    assert "headline" not in state()["chats"][CHAT]


def test_how_a_turn_ended_is_kept_and_a_closed_session_is_not_a_turn(home):
    follow.on_turn_start(session_id=CHAT, turn_id="t1")
    follow.on_turn_end(session_id=CHAT, turn_id="t1", completed=False, failed=False, interrupted=True)
    assert state()["chats"][CHAT]["state"] == "stopped"
    follow.on_turn_end(session_id=CHAT, turn_id="t1", completed=False, failed=True, interrupted=False)
    assert state()["chats"][CHAT]["state"] == "failed"
    before = len(home)
    follow.on_turn_end(session_id=CHAT, reason="cli_exit")
    assert len(home) == before and state()["chats"][CHAT]["state"] == "failed"


def test_board_changes_reach_the_chat_once_each(home):
    follow.on_turn_start(session_id=CHAT, turn_id="t1")
    changes = [{"at": 1000, "id": "n7", "kind": "added", "text": "Add a tip jar", "owner": "Maya"},
               {"at": 1001, "id": "n2", "kind": "changed", "text": "Charged twice in July and August"},
               {"at": 1002, "id": "n1", "kind": "removed", "text": "Launch post hit 40k views"},
               {"at": 1003, "id": "n8", "kind": "added"}, "junk"]
    store.Boards().put({**LINKED, "changes": changes})

    text = follow.on_turn_start(session_id=CHAT, turn_id="t2")["context"]
    assert "linked to the board" not in text and "not instructions" in text
    assert '- added a note (id n7): "Add a tip jar", owner: Maya' in text
    assert '- changed a note (id n2), it now reads: "Charged twice in July and August"' in text
    assert '- removed a note: "Launch post hit 40k views"' in text and "n8" not in text
    assert home[-1]["delivered"] == {"b1abc": 1003} and store.Follow().for_page()["delivered"] == {"b1abc": 1003}

    assert follow.on_turn_start(session_id=CHAT, turn_id="t3") is None
    store.Boards().put({**LINKED, "changes": [*changes[:4], {"at": 2000, "id": "n9", "kind": "added", "text": "Later"}]})
    later = follow.on_turn_start(session_id=CHAT, turn_id="t4")["context"]
    assert "Later" in later and "tip jar" not in later


def test_nothing_is_said_to_the_chat_while_chat_access_is_off_but_the_page_still_hears(home):
    store.Boards().set_sharing(False)
    assert follow.on_turn_start(session_id=CHAT, turn_id="t1") is None
    assert home[-1]["state"] == "working"


def test_a_board_linked_to_another_chat_says_nothing_here(home):
    store.Boards().put({**LINKED, "chat": "another"})
    assert follow.on_turn_start(session_id=CHAT, turn_id="t1") is None


def test_a_compacted_chat_keeps_its_board_and_is_told_about_it_again(home):
    follow.on_turn_start(session_id=CHAT, turn_id="t1")
    follow.on_compaction(session_id="20261114_100000_new", old_session_id=CHAT)
    assert follow.root_chat("20261114_100000_new") == CHAT and follow.root_chat("other") == "other"
    out = follow.on_turn_start(session_id="20261114_100000_new", turn_id="t2")
    assert "linked to the board" in out["context"] and home[-1]["chat"] == CHAT

    # Compacted in place: same id, told again.
    follow.on_compaction(session_id=CHAT, old_session_id="")
    assert "linked to the board" in follow.on_turn_start(session_id=CHAT, turn_id="t3")["context"]


def test_a_hook_never_raises_into_the_turn(home, monkeypatch):
    monkeypatch.setattr(follow, "_resolve", lambda *_a: 1 / 0)
    assert follow.on_turn_start(session_id=CHAT) is None
    follow.on_turn_answer(session_id=CHAT)
    follow.on_turn_end(session_id=CHAT, completed=True)
    follow.on_compaction(session_id=CHAT)


def test_hooks_register_and_an_older_hermes_just_follows_less():
    class Ctx:
        def __init__(self):
            self.hooks = []

        def register_hook(self, name, callback):
            if name == "post_compaction":
                raise ValueError("unknown hook")
            self.hooks.append(name)

    ctx = Ctx()
    assert follow.register_hooks(ctx) == ["pre_llm_call", "post_llm_call", "on_session_end"] == ctx.hooks


def test_without_a_gateway_the_push_is_dropped_quietly(monkeypatch):
    monkeypatch.undo()
    monkeypatch.setitem(sys.modules, "hermes_cli", None)
    follow._emit({"chat": CHAT})


# ---------------------------------------------------------------- status from the linked chat
def call(fn, context=None, **args):
    return json.loads(fn(args, **(context or {})))


def test_only_the_linked_chat_can_mark_status_and_it_is_checked():
    marks = [{"note": "n2", "state": "doing", "detail": "  Asking   billing "}, {"note": "n1", "state": "done"}]
    refused = call(tools.whiteboard_propose, {"session_id": "another"}, board="b1abc", summary="Progress", status=marks)
    assert refused["ok"] is False and "not linked to this chat" in refused["error"]
    assert call(tools.whiteboard_propose, board="b1abc", summary="Progress", status=marks)["ok"] is False

    here = {"session_id": CHAT}
    bad = call(tools.whiteboard_propose, here, board="b1abc", summary="Progress",
               status=[{"note": "n9", "state": "done"}, {"note": "n1", "state": "finished"}, "x"])
    assert bad["ok"] is False and len(bad["problems"]) == 3
    assert call(tools.whiteboard_propose, here, board="b1abc", summary="Progress", status=[marks[0]] * 21)["ok"] is False
    assert store.Inbox().list() == []

    ok = call(tools.whiteboard_propose, here, board="b1abc", summary="Progress", status=marks)
    assert ok["ok"] is True and ok["sent"]["status"] == 2 and "Waiting for review" not in ok["status"]
    [entry] = store.Inbox().list()
    assert entry["chat"] == CHAT
    assert entry["status"] == [{"note": "n2", "state": "doing", "detail": "Asking billing"}, {"note": "n1", "state": "done", "detail": None}]


def test_the_chat_keeps_its_board_after_a_compaction_and_reads_say_whose_board_it_is():
    follow.on_compaction(session_id="20261114_100000_new", old_session_id=CHAT)
    here = {"session_id": "20261114_100000_new"}
    assert call(tools.whiteboard_propose, here, board="b1abc", summary="Progress", status=[{"note": "n2", "state": "blocked"}])["ok"] is True
    assert store.Inbox().list()[0]["chat"] == CHAT
    assert call(tools.whiteboard_read, here, board="b1abc")["linked_to_this_chat"] is True
    assert call(tools.whiteboard_read, board="b1abc")["linked_to_this_chat"] is False
    assert call(tools.whiteboard_list, here)["boards"][0]["linked_to_this_chat"] is True
    assert "linked_to_this_chat" not in call(tools.whiteboard_list, {"session_id": "another"})["boards"][0]

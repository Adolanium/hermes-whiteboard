"""Whiteboard: think it through on a board, and Hermes lays it out, groups it and does the work.

The Desktop page (desktop/plugin.js) is the board. This package lets the agent work with it from
any chat:

- ``whiteboard_list`` / ``whiteboard_read``: read the person's boards (the page shares a copy while
  chat access is on; it starts off, and the person turns it on under Settings > Chats can read my
  boards);
- ``whiteboard_propose``: send new notes, groups and action items to a board. They wait on the board
  until the person accepts or skips each one, and accepted changes can be taken back;
- ``whiteboard_create``: open a new board from a plan worked out in the chat;
- the ``whiteboard:boards`` skill: how to work with a person's board without overstepping.
"""

from __future__ import annotations

from pathlib import Path

_SKILL = Path(__file__).resolve().parent / "skills" / "boards" / "SKILL.md"


def register(ctx):
    from .tools import register_tools

    register_tools(ctx)
    ctx.register_skill(
        "boards",
        _SKILL,
        description="Work with the person's Hermes Whiteboard boards from a chat: read a board, answer "
                    "questions about it, start a new board, and propose notes, groups or action items for "
                    "them to review.",
    )

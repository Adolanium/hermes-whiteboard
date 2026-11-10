"""Write the one file the person just named in a system save dialog.

The Whiteboard page opens the dialog through the Desktop SDK (``ctx.os.pickSavePath``) and sends
the chosen path to this backend through ``ctx.rest``, which is where the SDK says a picked path
belongs. The call is narrow on purpose: it writes Markdown and CSV only, and never inside Hermes' own home.

Every function returns ``{"ok": True, ...}`` or ``{"ok": False, "error": "..."}`` and never raises.
"""

from __future__ import annotations

from pathlib import Path

WRITE_SUFFIXES = (".md", ".csv")
MAX_WRITE_BYTES = 8 * 1024 * 1024


class _Refused(Exception):
    pass


def _protected(home: Path | None) -> list[Path]:
    """Hermes' home folder, and the root above it when the home is a profile."""
    if home is None:
        return []
    roots = [home.resolve()]
    if roots[0].parent.name == "profiles":
        roots.append(roots[0].parent.parent)
    return roots


def _checked(raw, home: Path | None) -> Path:
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw:
        raise _Refused("No file was picked.")
    path = Path(raw)
    if not path.is_absolute():
        raise _Refused("Whiteboard needs the full path of the picked file.")
    resolved = path.resolve()
    if path.suffix.lower() not in WRITE_SUFFIXES or resolved.suffix.lower() not in WRITE_SUFFIXES:
        raise _Refused("Whiteboard only writes .md and .csv files.")
    for root in _protected(home):
        if resolved == root or root in resolved.parents:
            raise _Refused("Whiteboard never writes files inside the Hermes home folder.")
    return resolved


def _problem(error: OSError) -> str:
    return error.strerror or error.__class__.__name__


def write_text(raw, text, home: Path | None = None) -> dict:
    """Write an export to the path the person named in the save dialog."""
    try:
        path = _checked(raw, home)
        if not isinstance(text, str):
            raise _Refused("There was nothing to write.")
        data = text.encode("utf-8", errors="replace")
        if len(data) > MAX_WRITE_BYTES:
            raise _Refused("That export is too large to write.")
        if path.is_dir():
            raise _Refused("That path is a folder, not a file.")
        if not path.parent.is_dir():
            raise _Refused("That folder does not exist.")
        path.write_bytes(data)
    except _Refused as refused:
        return {"ok": False, "error": str(refused)}
    except OSError as error:
        return {"ok": False, "error": f"Hermes could not write that file: {_problem(error)}."}
    return {"ok": True, "path": raw, "bytes": len(data)}

# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import math
import os
import struct
import zlib
from typing import Callable, Tuple

RGBA = Tuple[int, int, int, int]
DrawFn = Callable[[int, int, int], RGBA]


def _make_png(size: int, draw_fn: DrawFn) -> bytes:
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            r, g, b, a = draw_fn(x, y, size)
            row.extend((r, g, b, a))
        rows.append(bytes(row))
    raw: bytes = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc: int = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr: bytes = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def _rounded_alpha(x: int, y: int, size: int, radius: float) -> int:
    cx: float = min(max(x + 0.5, radius), size - radius)
    cy: float = min(max(y + 0.5, radius), size - radius)
    dist: float = math.hypot((x + 0.5) - cx, (y + 0.5) - cy)
    if dist <= radius - 0.5:
        return 255
    if dist >= radius + 0.5:
        return 0
    return int(255 * (radius + 0.5 - dist))


def _draw_chrome_ai(x: int, y: int, size: int) -> RGBA:
    alpha: int = _rounded_alpha(x, y, size, size * 0.22)
    if alpha == 0:
        return (0, 0, 0, 0)
    nx, ny = (x + 0.5) / size, (y + 0.5) / size
    r, g, b = 15, 23, 42
    if nx < 0.06 or nx > 0.94 or ny < 0.06 or ny > 0.94:
        r, g, b = 37, 99, 235
    if 0.19 <= nx <= 0.43 and abs(abs(ny - 0.5) - (0.43 - nx) * 0.95) < 0.058:
        r, g, b = 56, 189, 248
    if 0.57 <= nx <= 0.81 and abs(abs(ny - 0.5) - (nx - 0.57) * 0.95) < 0.058:
        r, g, b = 16, 185, 129
    if 0.43 <= nx <= 0.57 and 0.27 <= ny <= 0.73 and abs((nx - 0.5) + (ny - 0.5) * 0.28) < 0.035:
        r, g, b = 250, 204, 21
    return (r, g, b, alpha)


def _draw_break_guard(x: int, y: int, size: int) -> RGBA:
    alpha: int = _rounded_alpha(x, y, size, size * 0.22)
    if alpha == 0:
        return (0, 0, 0, 0)
    nx, ny = (x + 0.5) / size, (y + 0.5) / size
    r, g, b = 46, 16, 101
    dist_center: float = math.hypot(nx - 0.5, ny - 0.5)
    if 0.31 <= dist_center <= 0.38:
        r, g, b = 244, 63, 94
    d1: float = math.hypot(nx - 0.47, ny - 0.51)
    d2: float = math.hypot(nx - 0.56, ny - 0.46)
    if d1 <= 0.21 and d2 > 0.17:
        r, g, b = 253, 224, 71
    if math.hypot(nx - 0.66, ny - 0.35) <= 0.06:
        r, g, b = 56, 189, 248
    return (r, g, b, alpha)


def generate_all_icons(tools_dir: str) -> None:
    targets = [
        (os.path.join(tools_dir, "ChromeAI", "icons"), _draw_chrome_ai),
        (os.path.join(tools_dir, "CareBreakAI", "icons"), _draw_break_guard),
    ]
    for folder, fn in targets:
        os.makedirs(folder, exist_ok=True)
        for sz in (16, 48, 128):
            out_path: str = os.path.join(folder, f"icon{sz}.png")
            with open(out_path, "wb") as f_out:
                f_out.write(_make_png(sz, fn))


if __name__ == "__main__":
    base_tools: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    generate_all_icons(base_tools)

#!/usr/bin/env python3
"""Genera assets/logo.webp (400 px) y assets/favicon.png (64 px) desde un logo.

Uso: scripts/make-icons.py [ruta/al/logo.png]   (por defecto assets/logo-source.png)

Si la imagen no tiene transparencia, borra el fondo claro (blanco o el
patrón de cuadritos) conectado con los bordes, que se detiene en el
contorno oscuro del emblema. Requiere Pillow.
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(sys.argv[1] if len(sys.argv) > 1 else root / "assets" / "logo-source.png").convert("RGBA")
w, h = src.size
px = src.load()


def is_background(p):
    r, g, b, a = p
    return a == 0 or (min(r, g, b) > 170 and max(r, g, b) - min(r, g, b) < 24)


if src.getextrema()[3][0] == 255:  # sin transparencia: quitar el fondo
    seen = bytearray(w * h)
    queue = deque((x, y) for x in range(w) for y in (0, h - 1))
    queue.extend((x, y) for y in range(h) for x in (0, w - 1))
    while queue:
        x, y = queue.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        if not is_background(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

src = src.crop(src.getbbox())
out = root / "assets"
out.mkdir(exist_ok=True)
# logo.webp: se muestra a 200 px como máximo, así que 400 px cubre pantallas 2x.
for name, size in (("logo.webp", 400), ("favicon.png", 64)):
    img = src.copy()
    img.thumbnail((size, size), Image.LANCZOS)
    if name.endswith(".webp"):
        img.save(out / name, "WEBP", quality=86, method=6)
    else:
        img.save(out / name, optimize=True)
    print(out / name, img.size, (out / name).stat().st_size // 1024, "KB")

"""Builds the itch.io cover (marketing/cover-630x500.png) from a generated
painting in art-src/cover/ (git-ignored; prompt and seed in docs/itch-page.md):
scaled to 630 x 500 and stamped with the game's name the way the page's title
bar stamps it (a red double-bordered label, tilted 3 degrees). The title is
drawn here, not by the image model, so it is always spelled right and sharp.

  python3 tools/marketing/cover.py <source.jpg> [out.png]   (needs Pillow 10.1+)
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = (630, 500)
RED = (255, 94, 120)  # --grade-immortal, dark theme


def stamp(text: str, size: int) -> Image.Image:
    # Pillow's own built-in font (Aileron, public domain), thickened with a
    # stroke: portable, and no font licence to track in the shipped art.
    font = ImageFont.load_default(size)
    stroke = max(1, size // 16)
    spacing = round(size * 0.12)
    widths = [font.getbbox(ch, stroke_width=stroke)[2] for ch in text]
    w = sum(widths) + spacing * (len(text) - 1)
    asc, desc = font.getmetrics()
    pad, line = round(size * 0.45), max(3, size // 12)
    box = Image.new("RGBA", (w + 2 * pad, asc + desc + pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(box)
    bw, bh = box.size
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=line * 2, fill=(14, 16, 22, 215))
    for inset in (0, line * 2):
        d.rounded_rectangle(
            [inset, inset, bw - 1 - inset, bh - 1 - inset], radius=line, outline=RED, width=line
        )
    x = pad
    for ch, cw in zip(text, widths):
        d.text((x, pad // 2), ch, font=font, fill=RED, stroke_width=stroke, stroke_fill=RED)
        x += cw + spacing
    return box.rotate(3, resample=Image.BICUBIC, expand=True)


def build(src: Path, out: Path) -> None:
    art = Image.open(src).convert("RGB").resize(SIZE, Image.LANCZOS)
    title = stamp("OFFICE IMMORTAL", 44)
    art.paste(title, ((SIZE[0] - title.width) // 2, 14), title)
    # A plain PNG: no text chunks, no colour profile, nothing but pixels.
    Image.frombytes("RGB", art.size, art.tobytes()).save(out, optimize=True)


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2] if len(sys.argv) > 2 else "marketing/cover-630x500.png"))

"""Cleans generated art to its final pixel size and the shared palette.

Inputs: art-src/<id>.jpg (git-ignored generations, prompts in manifest.json).
The sources are not committed, so a rebuild needs them regenerated or copied in;
the shipped PNGs in src/assets/art are the record. Weapon icons are the
exception: they are drawn as SVG in tools/art/weapons.mjs (committed), and
`node tools/art/render-weapons.mjs` renders them into art-src/weapons/.
Outputs: src/assets/art/*.png (shipped).

  python3 tools/art/build.py               # build everything
  python3 tools/art/build.py <id>...       # build only these
  python3 tools/art/build.py icons:<id>... # rebuild only these icon columns,
                                           # keeping every other column of the
                                           # shipped atlas as it is

Sprites come out as a sheet of 4 rows (idle, attack, hit, death) by 4 frames;
hit uses the first 2. Each character has one generation per pose, made with the
idle pose as the reference image, all cleaned at one shared scale.

Manifest knobs (every one optional unless marked; unknown keys stop the build):

  sprite      id*, size*, face* ("left"/"right": the way it fights), poses*
              ({idle, attack[], hit[], death[]}, files under art-src/), seed,
              prompt (provenance only), lift ({pose: share of the frame it
              floats above the floor}), keep (smallest shape kept, as a share of
              the biggest; default 0.15), crop (true or [poses]: trailing parts
              run off the frame instead of shrinking the body), flip (the
              generation faces the other way), extra (palette colours for this
              asset only), recolor ({hex: hex} applied to the sheet), shadow
              (also drop dark magenta floor shadows), border (px of each source
              edge to clear), margin (px kept free round the frame).
  variant     id*, size*, base* (a sprite with poses: its poses rebuilt at this
              size), recolor, aura (glow colour), plus any sprite knob to override.
  background  id*, height*, seed, prompt, dim (brightness and saturation, default
              0.8), extra, trim_top (source rows dropped), blend (px of seam fade).
  icon        id*, then one of: sources* (one generation under art-src/ per
              item name, drawn smooth at full cell size; pair: each is one
              boot, drawn as a matching pair) or renders* (one transparent PNG
              under art-src/ per item name, e.g. from render-weapons.mjs: no
              cut-out, cropped to its shape and drawn smooth at full cell
              size), plus seed, prompt, source (provenance only).
              Atlas cells are icon_size x icon_scale px.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art-src"
OUT = ROOT / "src" / "assets" / "art"
MANIFEST = json.loads((Path(__file__).parent / "manifest.json").read_text())

# The one limited palette every asset is cleaned to.
PALETTE = [
    "1a1423", "3b2d4a", "5d4a6e",  # outline and shadow purples
    "2b2b33", "4a4a55", "6e6e7a", "9a9aa6", "c8c8d0", "f2f2f5",  # greys
    "f1c7a1", "e8a08a", "d9a06f", "a8693f", "6b3e26", "4a2f1f", "8a5a35",  # skin and browns
    "6e1b25", "b82e3a", "f05a5a",  # reds
    "e88a2a", "f5c542", "fff1a8",  # orange and gold
    "1f4d3a", "2f8a5a", "5fd08a", "b8f5c8",  # jade greens
    "1e2f5c", "2f5fb3", "5aa0f0", "a8d8ff",  # blues
    "6a3fa0", "b07ae0", "2a8a8f",  # qi purples and teal
]
# Neutral greys for backgrounds only: a dimmed office is mostly grey, and the
# shared palette's greys are too few for it (they would turn purple).
BG_GREYS = ["2e2e34", "3c3c43", "4f4f57", "62626a", "7c7c84", "93938f"]
# Colours one asset may add to the shared palette (its "extra" list). Kept
# per asset so a new colour never shifts art that was already approved.
EXTRAS = list(
    dict.fromkeys(
        [*BG_GREYS, *(c for a in MANIFEST["sprites"] + MANIFEST["backgrounds"] for c in a.get("extra", []))]
    )
)
OUTLINE = (0x1A, 0x14, 0x23, 255)
FLASH = (0xF2, 0xF2, 0xF5, 255)


def palette_image(colours: list[str]) -> Image.Image:
    flat = [int(c[i : i + 2], 16) for c in colours for i in (0, 2, 4)]
    p = Image.new("P", (1, 1))
    p.putpalette(flat + flat[:3] * (256 - len(colours)))
    return p


PAL = palette_image(PALETTE)
ALL = PALETTE + EXTRAS
FULL = palette_image(ALL)


def is_key(r: int, g: int, b: int) -> bool:
    """The magenta backdrop, JPEG fringe and glow blended into it included.

    Purples close to the backdrop (smoke, auras) go with it: prompts avoid them.
    """
    return (r > 140 and b > 140 and g < 130 and abs(r - b) < 100) or (
        r > 150 and b > g + 30 and b > 90
    )


def is_shadow(r: int, g: int, b: int) -> bool:
    """A dark magenta floor shadow the model drew in spite of the prompt."""
    return r > 80 and b > 80 and g < 70 and abs(r - b) < 70 and r > g * 2


def cut_out(img: Image.Image, keep: float = 0.15, shadow: bool = False, border: int = 0) -> Image.Image:
    """RGBA with the backdrop removed and only shapes over `keep` of the biggest kept."""
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()
    mask = Image.new("L", (w, h), 0)
    m = mask.load()
    for y in range(h):
        for x in range(w):
            if not (is_key(*px[x, y]) or (shadow and is_shadow(*px[x, y]))):
                m[x, y] = 255
    if border:
        # The model sometimes leaves a light strip along an edge: clear it.
        edge = Image.new("L", (w, h), 0)
        edge.paste(255, (border, border, w - border, h - border))
        mask = Image.composite(mask, edge, edge)
    # Erode the pink fringe by one pixel, then drop specks.
    mask = mask.filter(ImageFilter.MinFilter(3))
    mask = keep_big_shapes(mask, keep)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def keep_big_shapes(mask: Image.Image, share: float) -> Image.Image:
    w, h = mask.size
    m = mask.load()
    seen = bytearray(w * h)
    shapes = []
    for y0 in range(h):
        for x0 in range(w):
            if m[x0, y0] and not seen[y0 * w + x0]:
                stack, pts = [(x0, y0)], []
                seen[y0 * w + x0] = 1
                while stack:
                    x, y = stack.pop()
                    pts.append((x, y))
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < w and 0 <= ny < h and m[nx, ny] and not seen[ny * w + nx]:
                            seen[ny * w + nx] = 1
                            stack.append((nx, ny))
                shapes.append(pts)
    biggest = max((len(s) for s in shapes), default=0)
    out = Image.new("L", (w, h), 0)
    o = out.load()
    for s in shapes:
        if len(s) >= biggest * share:
            for x, y in s:
                o[x, y] = 255
    return out


def outline(img: Image.Image) -> Image.Image:
    """A 1 px dark outline just outside the shape."""
    w, h = img.size
    a = img.getchannel("A")
    grown = a.filter(ImageFilter.MaxFilter(3))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ring = Image.new("RGBA", (w, h), OUTLINE)
    out.paste(ring, (0, 0), grown)
    out.alpha_composite(img)
    return out


def shrink(shape: Image.Image, w: int, h: int, pal_image: Image.Image = PAL) -> Image.Image:
    """Shrinks a cut-out to w x h in palette colours.

    Each output pixel takes the most common palette colour of its source block
    (and is opaque when most of the block is), which keeps flat clusters where
    an average would blend neighbours into noise.
    """
    alpha = shape.getchannel("A").load()
    pal = shape.convert("RGB").quantize(palette=pal_image, dither=Image.Dither.NONE)
    idx = pal.load()
    colours = pal.getpalette()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    o = out.load()
    for ty in range(h):
        y0 = int(ty * shape.height / h)
        y1 = max(y0 + 1, int((ty + 1) * shape.height / h))
        for tx in range(w):
            x0 = int(tx * shape.width / w)
            x1 = max(x0 + 1, int((tx + 1) * shape.width / w))
            counts: dict[int, int] = {}
            solid = 0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    if alpha[x, y] >= 128:
                        solid += 1
                        counts[idx[x, y]] = counts.get(idx[x, y], 0) + 1
            if solid * 2 >= (x1 - x0) * (y1 - y0):
                i = max(counts, key=counts.get)
                o[tx, ty] = (colours[i * 3], colours[i * 3 + 1], colours[i * 3 + 2], 255)
    return out


def is_blade(r: int, g: int, b: int) -> bool:
    """Glowing weapon colours, left out when sizing and centring a body."""
    return g > r + 40 and g > b + 10


def body(cut: Image.Image) -> tuple[int, float]:
    """Body area in source pixels and its centre x, weapon left out."""
    px = cut.load()
    area, xs = 0, 0
    for y in range(cut.height):
        for x in range(cut.width):
            r, g, b, a = px[x, y]
            if a >= 128 and not is_blade(r, g, b):
                area += 1
                xs += x
    return area, xs / max(area, 1)


def frames_of(asset: dict) -> dict[str, list[Image.Image]]:
    """Every pose of a character, cleaned, on n x n canvases at one shared scale.

    Each generation draws the character at its own size, so each pose is scaled
    to the idle pose's body area, then lined up on the idle pose's body centre,
    feet on the floor (or `lift` of the frame above it).
    """
    n = asset["size"]
    poses = asset["poses"]
    lift = asset.get("lift", {})
    cuts = {}
    for name in {poses["idle"], *[f for k in ("attack", "hit", "death") for f in poses[k]]}:
        cut = cut_out(
            Image.open(SRC / name),
            asset.get("keep", 0.15),
            asset.get("shadow", False),
            asset.get("border", 0),
        )
        if asset.get("flip"):  # generated facing the other way
            cut = cut.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        cuts[name] = cut.crop(cut.getbbox())
    pal = palette_image(PALETTE + asset.get("extra", []))
    idle = cuts[poses["idle"]]
    room = n - 2 * asset.get("margin", 1)
    k = min(room / idle.width, room / idle.height)
    idle_area, idle_cx = body(idle)
    anchor = (n - round(idle.width * k)) // 2 + idle_cx * k
    out: dict[str, list[Image.Image]] = {}
    for row in ("idle", "attack", "hit", "death"):
        names = [poses["idle"]] if row == "idle" else poses[row]
        out[row] = []
        for name in names:
            cut = cuts[name]
            area, cx = body(cut)
            kp = k * (idle_area / area) ** 0.5
            crop = asset.get("crop", False)
            if crop is True or (isinstance(crop, list) and name in crop):
                # Trailing parts (cables, floor cracks) run off the frame edge
                # instead of shrinking the body: keep `room` px around its centre.
                # True crops every pose; a list crops only those poses.
                half = room / kp / 2
                left = int(max(0, min(cut.width - 2 * half, cx - half)))
                cut = cut.crop((left, 0, min(cut.width, left + int(2 * half)), cut.height))
                cx -= left
            # Never past the frame: a wide pose (lying down) shrinks to fit.
            kp = min(kp, room / cut.width, room / cut.height)
            small = shrink(cut, max(1, round(cut.width * kp)), max(1, round(cut.height * kp)), pal)
            x = round(anchor - cx * kp)
            m = asset.get("margin", 1)
            x = max(m, min(n - m - small.width, x))
            y = n - m - small.height - round(lift.get(name, 0) * n)
            canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
            canvas.paste(small, (x, max(m, y)))
            out[row].append(outline(canvas))
    return out


def shifted(img: Image.Image, dx: int, dy: int = 0) -> Image.Image:
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (dx, dy), img)
    return out


def breathe(img: Image.Image, dip: int) -> Image.Image:
    """Idle: the upper body sinks `dip` px while the feet stay put."""
    if not dip:
        return img.copy()
    n = img.height
    cut = n * 2 // 3
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img.crop((0, cut, n, n)), (0, cut))
    top = img.crop((0, 0, n, cut))
    out.alpha_composite(top, (0, dip))
    return out


def flashed(img: Image.Image) -> Image.Image:
    """Hit flash: the whole shape in the light colour, outline kept."""
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            if px[x, y][3] and px[x, y] != OUTLINE:
                px[x, y] = FLASH
    return out


def sheet(asset: dict) -> Image.Image:
    """Rows idle, attack, hit, death; 4 frames each (hit uses 2).

    Attack: the drawn poses, then back to idle. Hit: knocked back in a white
    flash, then the hurt pose easing forward. Death: the drawn poses, ending
    flat on the floor (the strip holds the last frame).
    """
    n = asset["size"]
    f = 1 if asset["face"] == "right" else -1  # the direction it fights in
    knock = max(2, n // 16)
    dip = max(1, n // 64)
    p = frames_of(asset)
    base = p["idle"][0]
    hurt = p["hit"][0]
    rows = [
        [breathe(base, d * dip) for d in (0, 1, 1, 0)],
        (p["attack"] + [base])[:4],
        [shifted(flashed(hurt), -f * knock), shifted(hurt, -f * knock // 2)],
        (p["death"] + p["death"][-1:] * 4)[:4],
    ]
    out = Image.new("RGBA", (n * 4, n * 4), (0, 0, 0, 0))
    for r, frames in enumerate(rows):
        for c, frame in enumerate(frames):
            out.paste(frame, (c * n, r * n))
    return out


def recolor(img: Image.Image, swap: dict[str, str]) -> Image.Image:
    """Swaps palette colours (hex to hex): an elite's or variant's colour scheme."""
    table = {tuple(int(a[i : i + 2], 16) for i in (0, 2, 4)): tuple(int(b[i : i + 2], 16) for i in (0, 2, 4)) for a, b in swap.items()}
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in table:
                px[x, y] = (*table[(r, g, b)], 255)
    return out


def aura(img: Image.Image, colour: str, frame: int) -> Image.Image:
    """A glow ring around the shape: solid 1 px, then a dithered 1 px that shifts each frame."""
    rgb = tuple(int(colour[i : i + 2], 16) for i in (0, 2, 4))
    a = img.getchannel("A")
    inner = a.filter(ImageFilter.MaxFilter(3))
    outer = inner.filter(ImageFilter.MaxFilter(3))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    po, pi, pa = out.load(), inner.load(), outer.load()
    for y in range(img.height):
        for x in range(img.width):
            if pi[x, y] or (pa[x, y] and (x + y + frame) % 2 == 0):
                po[x, y] = (*rgb, 255)
    out.alpha_composite(img)
    return out


def variant(asset: dict, base: dict) -> Image.Image:
    """An elite or variant: the base character's own poses rebuilt at this size, recoloured, with an aura."""
    merged = {**base, **{k: v for k, v in asset.items() if k not in ("id", "base")}}
    merged.setdefault("margin", 3 if "aura" in asset else 1)
    s = sheet(merged)
    if "recolor" in base:
        s = recolor(s, base["recolor"])
    if "recolor" in asset:
        s = recolor(s, asset["recolor"])
    if "aura" in asset:
        n = merged["size"]
        for r in range(4):
            for c in range(4):
                box = (c * n, r * n, (c + 1) * n, (r + 1) * n)
                frame = s.crop(box)
                if frame.getbbox():
                    s.paste(aura(frame, asset["aura"], c), box[:2])
    return s


def indexed(img: Image.Image) -> Image.Image:
    """The image in palette colours, with index len(ALL) as transparent."""
    a = img.getchannel("A")
    p = img.convert("RGB").quantize(palette=FULL, dither=Image.Dither.NONE)
    p.paste(len(ALL), mask=a.point(lambda v: 255 if v < 128 else 0))
    return p


def save(img: Image.Image, path: Path) -> None:
    """An indexed PNG: palette colours plus one transparent entry, the smallest file."""
    (img if img.mode == "P" else indexed(img)).save(path, optimize=True, transparency=len(ALL))


def seam_period(src: Image.Image, lo: float = 0.7, hi: float = 0.95, strip: int = 12) -> int:
    """The tile width at which the scene repeats best: the column band at the
    start compared against the band at each candidate width."""
    g = src.convert("L")
    w, h = g.size
    px = g.load()
    head = [[px[x, y] for y in range(0, h, 2)] for x in range(strip)]
    best, best_err = int(w * hi), float("inf")
    for p in range(int(w * lo), int(w * hi) - strip):
        err = 0
        for i in range(strip):
            col = head[i]
            err += sum(abs(col[j] - px[p + i, j * 2]) for j in range(len(col)))
            if err >= best_err:
                break
        if err < best_err:
            best, best_err = p, err
    return best


def background(bg: dict) -> Image.Image:
    """A zone's tiling layer: cut where the scene repeats, dimmed behind the
    fighters, cleaned to the palette.

    The tile is cut at the width where the scene's start lines up with itself
    best, then the last `blend` px fade into the start, so it repeats with no
    visible seam. `dim` darkens and desaturates it so sprites stay the brightest
    thing in the strip.
    """
    src = Image.open(SRC / f"{bg['id']}.jpg").convert("RGB")
    top = bg.get("trim_top", 0)  # source rows to drop (a ceiling band that won't tile)
    src = src.crop((0, top, src.width, src.height))
    w, h = src.size
    period = seam_period(src)
    o = bg.get("blend", 16)
    tile = src.crop((0, 0, period, h))
    for x in range(o):
        col = Image.blend(src.crop((period + x, 0, period + x + 1, h)), src.crop((x, 0, x + 1, h)), x / o)
        tile.paste(col, (x, 0))
    dim = bg.get("dim", 0.8)
    tile = ImageEnhance.Color(ImageEnhance.Brightness(tile).enhance(dim)).enhance(dim)
    height = bg["height"]
    width = round(period * height / h)
    return shrink(tile.convert("RGBA"), width, height, palette_image(PALETTE + BG_GREYS + bg.get("extra", [])))


def pair_of(boot: Image.Image) -> Image.Image:
    """A matching pair from one boot: a shaded copy behind, up and to the toe side."""
    w, h = boot.size
    dx, dy = int(w * 0.30), int(h * 0.07)
    back = ImageEnhance.Brightness(boot).enhance(0.8)
    back.putalpha(boot.getchannel("A"))
    out = Image.new("RGBA", (w + dx, h + dy), (0, 0, 0, 0))
    out.alpha_composite(back, (dx, 0))
    out.alpha_composite(boot, (0, dy))
    return out


def smooth_icon(path: Path, n: int, pair: bool, transparent: bool = False) -> Image.Image:
    """A generation cut out (or a render already on transparency) and fitted
    into n x n, smoothly: no palette, no pixel grid."""
    cut = Image.open(path).convert("RGBA") if transparent else cut_out(Image.open(path))
    cut = cut.crop(cut.getbbox())
    if pair:
        cut = pair_of(cut)
    k = min((n - 2) / cut.width, (n - 2) / cut.height)
    small = cut.resize((max(1, round(cut.width * k)), max(1, round(cut.height * k))), Image.LANCZOS)
    canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    canvas.paste(small, ((n - small.width) // 2, (n - small.height) // 2))
    return canvas


def icon_rows(e: dict) -> list:
    return e.get("sources") or e.get("renders") or []


def icon_atlas(columns: list[str] | None = None) -> Image.Image:
    """Every item type (columns, manifest order) in each of its names (rows, in
    the order loot.ts lists the names), in cells of icon_size x icon_scale px.

    With `columns`, only those item types are drawn and the other columns are
    left empty, for kept_columns() to fill from the shipped atlas.
    """
    n = MANIFEST["icon_size"]
    k = MANIFEST["icon_scale"]
    cell = n * k
    entries = MANIFEST["icons"]
    rows = max(len(icon_rows(e)) for e in entries)
    out = Image.new("RGBA", (cell * len(entries), cell * rows), (0, 0, 0, 0))

    for c, e in enumerate(entries):
        if columns is not None and e["id"] not in columns:
            continue
        if "renders" in e:
            for r, f in enumerate(e["renders"]):
                out.paste(smooth_icon(SRC / f, cell, False, transparent=True), (c * cell, r * cell))
        else:
            for r, f in enumerate(e["sources"]):
                out.paste(smooth_icon(SRC / f, cell, e.get("pair", False)), (c * cell, r * cell))
        # Every item name needs a visible icon: a blank cell means a bad source or cut-out.
        for r in range(len(icon_rows(e))):
            if out.crop((c * cell, r * cell, (c + 1) * cell, (r + 1) * cell)).getbbox() is None:
                sys.exit(f"icon {e['id']}: row {r} came out empty")
    return out


def kept_columns(columns: list[str]) -> Image.Image:
    """The atlas with only `columns` rebuilt: every other column is copied from
    the shipped icons.png index for index, so its pixels stay exactly as they
    were (quantizing them again could move a colour to a near one)."""
    cell = MANIFEST["icon_size"] * MANIFEST["icon_scale"]
    entries = MANIFEST["icons"]
    old = Image.open(OUT / "icons.png")
    out = indexed(icon_atlas(columns))
    if old.mode != "P" or old.getpalette() != out.getpalette() or old.info.get("transparency") != len(ALL):
        sys.exit("icons.png is not indexed to the current palette: rebuild the whole atlas")
    if old.width != out.width or old.height % cell:
        sys.exit(f"icons.png is {old.size}, not {len(entries)} columns of {cell} px cells")
    for c, e in enumerate(entries):
        if e["id"] in columns:
            continue
        # Rows past the old atlas stay empty; rows past the new one are dropped.
        h = min(old.height, out.height)
        out.paste(old.crop((c * cell, 0, (c + 1) * cell, h)), (c * cell, 0))
    return out


def paperdoll() -> Image.Image:
    """The figure behind the equipment slots: fitted to the doll box (w x h), feet on the floor."""
    d = MANIFEST["doll"]
    w, h = d["size"]
    cut = cut_out(Image.open(SRC / f"{d['id']}.jpg"))
    cut = cut.crop(cut.getbbox())
    k = min((w - 2) / cut.width, (h - 2) / cut.height)
    small = shrink(cut, max(1, round(cut.width * k)), max(1, round(cut.height * k)))
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(small, ((w - small.width) // 2, h - 1 - small.height))
    return outline(canvas)


KNOBS = {
    "sprite": {"id", "size", "face", "poses", "seed", "prompt", "lift", "keep", "crop", "flip",
               "extra", "recolor", "shadow", "border", "margin"},
    "variant": {"id", "size", "base", "recolor", "aura", "seed", "prompt", "lift", "keep", "crop",
                "flip", "extra", "shadow", "border", "margin"},
    "background": {"id", "height", "seed", "prompt", "dim", "extra", "trim_top", "blend"},
    "icon": {"id", "sources", "renders", "pair", "source", "seed", "prompt"},
}
REQUIRED = {
    "sprite": {"id", "size", "face", "poses"},
    "variant": {"id", "size", "base"},
    "background": {"id", "height"},
    "icon": {"id"},
}


def check_manifest(builds=lambda kind, name: True) -> None:
    """Stops the build on a typo'd knob, a missing one, a variant whose base has
    no poses, or a missing source for something `builds(kind, id)` will build."""
    errors = []
    by_id = {a["id"]: a for a in MANIFEST["sprites"]}
    entries = [("variant" if "base" in a else "sprite", a) for a in MANIFEST["sprites"]]
    entries += [("background", b) for b in MANIFEST["backgrounds"]]
    entries += [("icon", i) for i in MANIFEST["icons"]]
    for kind, e in entries:
        name = e.get("id", "?")
        for k in sorted(set(e) - KNOBS[kind]):
            errors.append(f"{kind} {name}: unknown knob {k!r}")
        for k in sorted(REQUIRED[kind] - set(e)):
            errors.append(f"{kind} {name}: missing {k!r}")
        if kind == "variant" and "poses" not in by_id.get(e["base"], {}):
            errors.append(f"variant {name}: base {e['base']!r} is not a sprite with poses")
        if kind == "icon":
            if len([k for k in ("sources", "renders") if k in e]) != 1:
                errors.append(f"icon {name}: needs exactly one of sources or renders")
            if "pair" in e and "sources" not in e:
                errors.append(f"icon {name}: pair only applies to sources")
            for f in [*e.get("sources", []), *e.get("renders", [])] if builds(kind, name) else []:
                if not (SRC / f).exists():
                    errors.append(f"icon {name}: source {f} missing")
        for f in [] if kind != "sprite" or not builds(kind, name) else [e["poses"]["idle"], *(p for r in ("attack", "hit", "death") for p in e["poses"][r])]:
            if not (SRC / f).exists():
                errors.append(f"sprite {name}: source {f} missing")
    if errors:
        sys.exit("manifest:\n  " + "\n  ".join(errors))


def main() -> None:
    only = sys.argv[1:]
    columns = [a.split(":", 1)[1] for a in only if a.startswith("icons:")]
    icon_ids = [i["id"] for i in MANIFEST["icons"]]
    for c in columns:
        if c not in icon_ids:
            sys.exit(f"icons:{c}: no such icon column (have {', '.join(icon_ids)})")

    # A variant is rebuilt from its base sprite's poses, so it needs their sources too.
    wanted = set(only) | {a["base"] for a in MANIFEST["sprites"] if "base" in a and a["id"] in only}

    def builds(kind: str, name: str) -> bool:
        if kind == "icon":
            return not only or "icons" in only or name in columns
        return not only or name in wanted

    check_manifest(builds)
    OUT.mkdir(parents=True, exist_ok=True)
    if not only or "paperdoll" in only:
        save(paperdoll(), OUT / "paperdoll.png")
    if not only or "icons" in only:
        save(icon_atlas(), OUT / "icons.png")
    elif columns:
        save(kept_columns(columns), OUT / "icons.png")
    for bg in MANIFEST["backgrounds"]:
        if (not only or bg["id"] in only) and (SRC / f"{bg['id']}.jpg").exists():
            save(background(bg), OUT / f"bg-{bg['id']}.png")
    by_id = {a["id"]: a for a in MANIFEST["sprites"]}
    for asset in MANIFEST["sprites"]:
        if only and asset["id"] not in only:
            continue
        if "base" in asset:
            save(variant(asset, by_id[asset["base"]]), OUT / f"{asset['id']}.png")
        else:
            s = sheet(asset)
            save(recolor(s, asset["recolor"]) if "recolor" in asset else s, OUT / f"{asset['id']}.png")


if __name__ == "__main__":
    main()

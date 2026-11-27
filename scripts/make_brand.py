#!/usr/bin/env python3
"""Regenerate favicon, touch icon, social card and web manifest into static/.
Run manually after changing the name or tagline:  python scripts/make_brand.py
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
BRAND = STATIC / "img" / "brand"
BRAND.mkdir(parents=True, exist_ok=True)

INK, PAPER, ACCENT = (28, 28, 30), (251, 251, 249), (10, 95, 209)

ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<style>.b{fill:#1c1c1e}.f{fill:#fbfbf9}.s{stroke:#fbfbf9}@media (prefers-color-scheme:dark){.b{fill:#f1f1ee}.f{fill:#0c0d10}.s{stroke:#0c0d10}}</style>
<rect class="b" width="32" height="32" rx="9"/>
<path class="s" d="M16 8 L11 17 L19.5 23" fill="none" stroke-width="2" stroke-linecap="round"/>
<circle class="f" cx="16" cy="8" r="1.8"/><circle class="f" cx="11" cy="17" r="2.4"/>
<circle cx="19.5" cy="23" r="3" fill="#2f86ff"/>
</svg>
"""


def mark(size: int, pad: float = 0.0, tile: bool = True) -> Image.Image:
    s = 8  # supersample
    S = size * s
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    inset = int(S * pad)
    box = S - 2 * inset
    if tile:
        d.rounded_rectangle([inset, inset, inset + box, inset + box], radius=int(box * 9 / 32), fill=INK)
    u = box / 32
    P = lambda x, y: (inset + x * u, inset + y * u)
    d.line([P(16, 8), P(11, 17), P(19.5, 23)], fill=PAPER, width=int(2 * u), joint="curve")
    for (x, y, r, c) in [(16, 8, 1.8, PAPER), (11, 17, 2.4, PAPER), (19.5, 23, 3, (47, 134, 255))]:
        cx, cy = P(x, y)
        d.ellipse([cx - r * u, cy - r * u, cx + r * u, cy + r * u], fill=c)
    return im.resize((size, size), Image.LANCZOS)


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def og_card(name: str, lines: list[str]) -> Image.Image:
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    # Double-pendulum trace on the right, as on the home page.
    t1, t2, w1, w2 = math.pi * 0.62, math.pi * 0.98, 0.0, 0.0
    g, L = 9.81, 1.0
    ox, oy, sc = 975, 315, 108
    pts = []
    h = 1 / 480
    for i in range(5200):
        def f(a, b, c, e):
            dd = a - b; den = 3 - math.cos(2 * dd)
            a1 = (-3 * g * math.sin(a) - g * math.sin(a - 2 * b) - 2 * math.sin(dd) * (e * e * L + c * c * L * math.cos(dd))) / (L * den)
            a2 = (2 * math.sin(dd) * (2 * c * c * L + 2 * g * math.cos(a) + e * e * L * math.cos(dd))) / (L * den)
            return c, e, a1, a2
        k1 = f(t1, t2, w1, w2)
        k2 = f(t1 + h / 2 * k1[0], t2 + h / 2 * k1[1], w1 + h / 2 * k1[2], w2 + h / 2 * k1[3])
        k3 = f(t1 + h / 2 * k2[0], t2 + h / 2 * k2[1], w1 + h / 2 * k2[2], w2 + h / 2 * k2[3])
        k4 = f(t1 + h * k3[0], t2 + h * k3[1], w1 + h * k3[2], w2 + h * k3[3])
        t1 += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); t2 += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        w1 += h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]); w2 += h / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])
        x1, y1 = ox + sc * math.sin(t1), oy + sc * math.cos(t1)
        pts.append((x1 + sc * math.sin(t2), y1 + sc * math.cos(t2)))
    n = len(pts)
    for i in range(1, n):
        a = i / n
        col = tuple(int(PAPER[k] + (ACCENT[k] - PAPER[k]) * (0.12 + 0.88 * a * a)) for k in range(3))
        d.line([pts[i - 1], pts[i]], fill=col, width=2 if a > 0.6 else 1)
    x1, y1 = ox + sc * math.sin(t1), oy + sc * math.cos(t1)
    x2, y2 = pts[-1]
    d.line([(ox, oy), (x1, y1), (x2, y2)], fill=INK, width=3)
    for (cx, cy, r, c) in [(ox, oy, 4, INK), (x1, y1, 8, INK), (x2, y2, 10, ACCENT)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)

    bold = font([str(STATIC / ".." / "scripts" / "fonts" / "InstrumentSerif-Regular.ttf"), "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"], 84)
    reg = font([str(STATIC / ".." / "scripts" / "fonts" / "GeistMono-Regular.ttf"), "/usr/share/fonts/opentype/inter/Inter-Medium.otf"], 28)
    im.paste(mark(56), (80, 80), mark(56))
    d.text((152, 90), name, font=reg, fill=INK)
    y = 205
    for i, line in enumerate(lines):
        d.text((80, y), line, font=bold, fill=INK if i < len(lines) - 1 else (107, 107, 112))
        y += 86
    d.text((80, 540), "mehedieh.github.io", font=reg, fill=(107, 107, 112))
    return im


if __name__ == "__main__":
    (BRAND / "icon.svg").write_text(ICON_SVG)
    mark(180, pad=0.1).convert("RGBA").save(BRAND / "apple-touch-icon.png")
    mark(512).save(BRAND / "icon-512.png")
    mark(192).save(BRAND / "icon-192.png")
    ico = mark(64)
    ico.save(STATIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    og_card("Mehedi Ackerman", ["Securing systems.", "Building software.", "Exploring the universe."]).save(BRAND / "og.png", optimize=True)
    # Maskable icons: full-bleed background, mark inside the 80% safe zone (Android crops to any shape).
    for size in (192, 512):
        bg = Image.new("RGBA", (size, size), INK + (255,))
        m = mark(int(size * 0.62), tile=False)
        # draw the mark's glyph without its own rounded tile: re-render on ink so the tile blends in
        bg.paste(m, ((size - m.size[0]) // 2, (size - m.size[1]) // 2), m)
        bg.save(BRAND / f"icon-maskable-{size}.png")
    mark(96).save(BRAND / "shortcut-96.png")

    shots = [s for s in ["screen-home.png", "screen-writing.png", "screen-wide.png"] if (BRAND / s).exists()]
    def shot(name):
        with Image.open(BRAND / name) as im:
            w, h = im.size
        return {"src": f"/img/brand/{name}", "sizes": f"{w}x{h}", "type": "image/png",
                "form_factor": "wide" if w > h else "narrow",
                "label": {"screen-home.png": "Home: security, software and physics",
                          "screen-writing.png": "Writing: notes and essays with search",
                          "screen-wide.png": "Projects on a wide screen"}[name]}

    manifest = {
        "id": "/",
        "name": "Mehedi Ackerman",
        "short_name": "Mehedi",
        "description": "Cybersecurity, software development and physics: projects, notes and essays.",
        "lang": "en", "dir": "ltr",
        "start_url": "/?source=pwa",
        "scope": "/",
        "display": "standalone",
        "display_override": ["standalone", "minimal-ui"],
        "orientation": "any",
        "background_color": "#fbfbf9",
        "theme_color": "#fbfbf9",
        "categories": ["education", "books"],
        "icons": [
            {"src": "/img/brand/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/img/brand/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/img/brand/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "/img/brand/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
        "shortcuts": [
            {"name": "Writing", "short_name": "Writing", "description": "Notes and essays", "url": "/writing/?source=pwa",
             "icons": [{"src": "/img/brand/shortcut-96.png", "sizes": "96x96", "type": "image/png"}]},
            {"name": "Projects", "short_name": "Projects", "description": "Apps and tools", "url": "/projects/?source=pwa",
             "icons": [{"src": "/img/brand/shortcut-96.png", "sizes": "96x96", "type": "image/png"}]},
            {"name": "Physics", "short_name": "Physics", "description": "Physics and the double pendulum", "url": "/physics/?source=pwa",
             "icons": [{"src": "/img/brand/shortcut-96.png", "sizes": "96x96", "type": "image/png"}]},
        ],
        "screenshots": [shot(s) for s in shots],
    }
    (STATIC / "site.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n")
    print("brand assets written")

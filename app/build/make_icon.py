"""Generate app/build/icon.png + icon.ico for HeyVoice.

Draws the same brand mark as app/src/components/brand.tsx (gradient rounded
tile + white waveform bars) at 1024px and exports:
  - icon.png  (512x512, used by the dev Electron window)
  - icon.ico  (multi-size, picked up by electron-builder for the installer)

Run:  backend\\.venv\\Scripts\\python.exe app\\build\\make_icon.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

S = 1024
GRID = 48.0            # design grid of the SVG mark
TILE_TOP = (0x6F, 0x72, 0xF5)
TILE_BOT = (0x8B, 0x5C, 0xF6)

OUT = Path(__file__).resolve().parent


def lerp(a: tuple, b: tuple, t) -> np.ndarray:
    a = np.array(a, dtype=np.float64)[None, None, :]
    b = np.array(b, dtype=np.float64)[None, None, :]
    return a + (b - a) * t[:, :, None]


def main() -> None:
    # diagonal gradient matching the SVG (8,4) -> (42,45) in a 48px grid
    y, x = np.mgrid[0:S, 0:S]
    gx = (x / S) * GRID
    gy = (y / S) * GRID
    t = ((gx - 8.0) * 34.0 + (gy - 4.0) * 41.0) / (34.0**2 + 41.0**2)
    t = np.clip(t, 0.0, 1.0)
    rgb = lerp(TILE_TOP, TILE_BOT, t).astype(np.uint8)

    # rounded tile
    tile = Image.fromarray(rgb, "RGB")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=round(13 / GRID * S), fill=255
    )
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(tile, (0, 0), mask)

    d = ImageDraw.Draw(img)
    k = S / GRID

    # inner hairline
    inset = round(0.5 * k)
    d.rounded_rectangle(
        [inset, inset, S - 1 - inset, S - 1 - inset],
        radius=round(12.5 / GRID * S),
        outline=(255, 255, 255, 46),
        width=max(2, round(k / 5)),
    )

    # waveform bars (x, y, height, alpha) from brand.tsx
    bars = [
        (11.8, 19, 10, 224),
        (21.6, 13, 22, 255),
        (31.4, 17, 14, 240),
    ]
    bw = round(4.8 * k)
    for bx, by, bh, alpha in bars:
        x0, y0 = round(bx * k), round(by * k)
        d.rounded_rectangle(
            [x0, y0, x0 + bw - 1, y0 + round(bh * k) - 1],
            radius=bw // 2,
            fill=(255, 255, 255, alpha),
        )

    img.resize((512, 512), Image.LANCZOS).save(OUT / "icon.png")
    img.save(
        OUT / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote {OUT / 'icon.png'} and {OUT / 'icon.ico'}")


if __name__ == "__main__":
    main()

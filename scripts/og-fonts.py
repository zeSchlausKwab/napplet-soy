"""Regenerate OG fonts and wrapping metrics from the repository's pinned fonts.

One-time authoring tool: run with Python + fonttools (not a server dependency).
The WOFF files come from @fontsource/fredoka and @fontsource/dm-sans 5.3.0.
Their SIL OFL licenses are retained alongside the generated assets.
"""
import json
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
assets = root / "packages/backend/assets"
for family, output in [("fredoka", "Fredoka-Bold.ttf"), ("dm-sans", "DMSans-Bold.ttf")]:
    font = TTFont(root / f"node_modules/@fontsource/{family}/files/{family}-latin-700-normal.woff")
    font.flavor = None
    font.save(assets / output)

metrics = {}
for weight, filename in [("regular", "DMSans.ttf"), ("bold", "DMSans-Bold.ttf")]:
    font = TTFont(assets / filename)
    units = font["head"].unitsPerEm
    metrics[weight] = {
        chr(code): round(font["hmtx"][glyph][0] / units, 4)
        for code, glyph in font.getBestCmap().items()
    }
(assets / "og-text-metrics.json").write_text(json.dumps(metrics, ensure_ascii=False) + "\n")
(assets / "Fredoka-OFL.txt").write_bytes((root / "apps/web/public/fonts/Fredoka-OFL.txt").read_bytes())

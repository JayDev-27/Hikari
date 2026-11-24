"""Flatten the visible PSD layers and key the painted speaking mouth for Iki."""
from pathlib import Path
import sys

from PIL import Image, ImageDraw
from psd_tools import PSDImage

psd = PSDImage.open(sys.argv[1])
out = Path(sys.argv[2])
psd.composite(force=True).save(out / "psd-recomposite.png")
mouth = next(layer.topil() for layer in psd.descendants() if layer.name == "Speaking mouth")

# These outlines follow the paint in the hidden 51×27 source patch. The frame
# includes a small skin margin below the opening for Iki's folding lower lip.
frame = Image.new("L", mouth.size)
ImageDraw.Draw(frame).polygon([
    (8, 11), (12, 8), (20, 7), (30, 6), (38, 6), (40, 9), (39, 13), (35, 17),
    (32, 21), (25, 23), (18, 22), (13, 18), (9, 15),
], fill=255)
cavity = Image.new("L", mouth.size)
ImageDraw.Draw(cavity).polygon([
    (13, 12), (17, 11), (24, 10), (30, 10), (35, 9), (36, 10), (34, 14),
    (32, 17), (27, 19), (23, 19), (18, 17), (15, 15),
], fill=255)
interior = mouth.copy()
interior.putalpha(cavity)
keyed = mouth.copy()
keyed.putalpha(frame)
keyed.paste((0, 255, 0, 255), mask=cavity)
for name, image in [("mouth-keyed", keyed), ("mouth-interior", interior)]:
    image.resize((306, 162), Image.Resampling.NEAREST).save(out / f"{name}.png")


"""Align Cheng Xiaoshi's visible PSD paint and key its speaking-mouth layer."""
from pathlib import Path
import sys

from PIL import Image, ImageDraw
from psd_tools import PSDImage

source, out = map(Path, sys.argv[1:])
psd = PSDImage.open(source)
if psd.size != (576, 1536):
    raise ValueError(f"Landmarks require Cheng Xiaoshi's 576×1536 PSD, got {psd.size}")

# The source chin around (288, 218) lands at the center of the 1100 px canvas.
picture = Image.new("RGBA", (1100, 4096))
visible = psd.composite(force=True).convert("RGBA")
picture.paste(visible.resize((1094, 2918), Image.Resampling.BICUBIC), (4, 46))
picture.putalpha(picture.getchannel("A").point(lambda value: 255 if value >= 250 else value))
picture.save(out / "picture.png")

mouth = next(layer.topil() for layer in psd.descendants() if layer.name == "Speaking mouth").convert("RGBA")
frame = Image.new("L", mouth.size)
ImageDraw.Draw(frame).polygon([(3, 10), (7, 5), (12, 3), (25, 3), (32, 5), (36, 10), (34, 15), (29, 19), (11, 19), (6, 16)], fill=255)
cavity = Image.new("L", mouth.size)
ImageDraw.Draw(cavity).polygon([(6, 11), (9, 7), (14, 6), (26, 6), (30, 7), (33, 11), (30, 14), (27, 17), (12, 17), (8, 14)], fill=255)
interior = mouth.copy()
interior.putalpha(cavity)
mouth.putalpha(frame)
mouth.paste((0, 255, 0, 255), mask=cavity)
for name, image in [("mouth-keyed", mouth), ("mouth-interior", interior)]:
    image.resize((234, 132), Image.Resampling.NEAREST).save(out / f"{name}.png")

neutral = picture.crop((520, 398, 580, 426))
width, height = neutral.size
alpha = Image.new("L", neutral.size)
alpha.putdata([min(255, 64 * min(x, y, width - 1 - x, height - 1 - y)) for y in range(height) for x in range(width)])
neutral.putalpha(alpha)
neutral.save(out / "closed-mouth.png")

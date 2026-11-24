"""Align Lu Guang's visible PSD composite and key his painted speaking mouth."""
from pathlib import Path
import sys

from PIL import Image, ImageDraw
from psd_tools import PSDImage

source, out = map(Path, sys.argv[1:])
psd = PSDImage.open(source)
if psd.size != (576, 1536):
    raise ValueError(f"Landmarks require Lu Guang's 576×1536 PSD, got {psd.size}")

# The source chin at about (285, 222) lands at (550, 468).
picture = Image.new("RGBA", (1100, 4096))
visible = psd.composite(force=True).convert("RGBA")
picture.paste(visible.resize((1094, 2918), Image.Resampling.BICUBIC), (8, 46))
picture.putalpha(picture.getchannel("A").point(lambda value: 255 if value >= 250 else value))
picture.save(out / "picture.png")

mouth = next(layer.topil() for layer in psd.descendants() if layer.name == "Speaking mouth").convert("RGBA")
frame = Image.new("L", mouth.size)
ImageDraw.Draw(frame).polygon([(6, 10), (10, 6), (16, 5), (26, 5), (32, 7), (36, 11),
                               (34, 15), (28, 18), (14, 18), (8, 15)], fill=255)
cavity = Image.new("L", mouth.size)
ImageDraw.Draw(cavity).polygon([(8, 11), (12, 7), (17, 6), (25, 6), (31, 8), (34, 11),
                                (32, 15), (27, 17), (15, 17), (10, 14)], fill=255)
interior = mouth.copy()
interior.putalpha(cavity)
mouth.putalpha(frame)
mouth.paste((0, 255, 0, 255), mask=cavity)
for name, image in [("mouth-keyed", mouth), ("mouth-interior", interior)]:
    image.resize((258, 138), Image.Resampling.NEAREST).save(out / f"{name}.png")

neutral = picture.crop((520, 402, 581, 441))
width, height = neutral.size
alpha = Image.new("L", neutral.size)
alpha.putdata([min(255, 64 * min(x, y, width - 1 - x, height - 1 - y))
               for y in range(height) for x in range(width)])
neutral.putalpha(alpha)
neutral.save(out / "closed-mouth.png")

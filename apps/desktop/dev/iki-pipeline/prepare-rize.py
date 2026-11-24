"""Align Rize's PSD, lift its spectacle frame, and key its painted mouth."""
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter
from psd_tools import PSDImage


def align(image):
    # Source (279, 249) → canvas (550, 544). Include the original hands and shoes.
    canvas = Image.new("RGBA", (1100, 4096))
    canvas.paste(image.convert("RGBA").resize((1064, 3300), Image.Resampling.BICUBIC), (-8, 46))
    canvas.putalpha(canvas.getchannel("A").point(lambda value: 255 if value >= 250 else value))
    return canvas


def polygon_mask(size, points):
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def separate_glasses(picture, landmarks, output):
    x0, y0, x1, y1 = landmarks["box"]
    patch = picture.crop((x0, y0, x1, y1))
    corridor = polygon_mask(patch.size, [(x - x0, y - y0) for x, y in landmarks["frame"]])
    # The opaque burgundy rim has a distinct red channel even at its darkest
    # edges. Restrict the selection to the measured frame to preserve lashes.
    red = Image.new("L", patch.size)
    red.putdata([255 if r > b + 13 and r > g + 16 and g < 101 else 0 for r, g, b, _ in patch.getdata()])
    rim = ImageChops.multiply(red, corridor)
    rim = ImageChops.multiply(rim.filter(ImageFilter.MaxFilter(5)), corridor)
    alpha = rim.filter(ImageFilter.GaussianBlur(0.65))
    glasses = patch.copy()
    glasses.putalpha(alpha)
    glasses.save(output / "glasses.png")

    # Replace the paint behind the lifted rim with nearby pixels. Give the
    # vertical samples priority along the lower rims and the bridge. At the
    # temples, extending the neighbouring columns keeps lash and hair edges.
    filled = patch.copy()
    mask = rim.filter(ImageFilter.MaxFilter(3))
    width, height = patch.size
    for y in range(height):
        for x in range(width):
            if not mask.getpixel((x, y)):
                continue
            samples = []
            for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
                for distance in range(1, 19):
                    xx, yy = x + dx * distance, y + dy * distance
                    if not (0 <= xx < width and 0 <= yy < height):
                        break
                    if not mask.getpixel((xx, yy)):
                        temple = x < 22 or x > width - 23
                        weight = (3 if bool(dx) == temple else 1) / distance**2
                        samples.append((weight, patch.getpixel((xx, yy))))
                        break
            if samples:
                weight_sum = sum(weight for weight, _ in samples)
                filled.putpixel((x, y), tuple(round(sum(weight * pixel[c] for weight, pixel in samples) / weight_sum) for c in range(4)))
    cut = picture.copy()
    cut.paste(filled, (x0, y0))
    cut.save(output / "cut-picture.png")


def prepare_mouth(psd, picture, output):
    mouth = next(layer.topil() for layer in psd.descendants() if layer.name == "Speaking mouth").convert("RGBA")
    frame = polygon_mask(mouth.size, [(12, 8), (18, 5), (31, 5), (43, 7), (45, 11), (41, 17), (34, 22), (25, 24), (18, 20), (13, 14)])
    cavity = polygon_mask(mouth.size, [(15, 10), (20, 9), (33, 9), (42, 10), (39, 15), (34, 18), (28, 19), (22, 18), (18, 15)])
    interior = mouth.copy()
    interior.putalpha(cavity)
    mouth.putalpha(frame)
    mouth.paste((0, 255, 0, 255), mask=cavity)
    for name, image in [("mouth-keyed", mouth), ("mouth-interior", interior)]:
        image.resize((336, 168), Image.Resampling.NEAREST).save(output / f"{name}.png")

    smile = picture.crop((502, 463, 598, 502))
    width, height = smile.size
    alpha = Image.new("L", smile.size)
    alpha.putdata([min(255, 64 * min(x, y, width - 1 - x, height - 1 - y)) for y in range(height) for x in range(width)])
    smile.putalpha(alpha)
    smile.save(output / "closed-smile.png")


def main():
    source, output, landmark_file = map(Path, sys.argv[1:])
    psd = PSDImage.open(source)
    if psd.size != (532, 1650):
        raise ValueError(f"Landmarks require Rize's 532×1650 PSD, got {psd.size}")
    picture = align(psd.composite(force=True))
    picture.save(output / "picture.png")
    glasses = json.loads(landmark_file.read_text())["glasses"]
    separate_glasses(picture, glasses, output)
    prepare_mouth(psd, picture, output)


if __name__ == "__main__":
    main()

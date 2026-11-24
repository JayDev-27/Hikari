"""Refine the boundaries between Reze's painted layers before meshing."""
from pathlib import Path
import sys
from PIL import Image

root = Path(sys.argv[1])
final = root / "final"


def trim_edge(image, points, x_range, direction):
    """Trace a soft edge inside the existing paint without adding coverage."""
    pixels = image.load()
    for (y0, x0), (y1, x1) in zip(points, points[1:]):
        for y in range(y0, y1):
            edge = x0 + (x1 - x0) * (y + 0.5 - y0) / (y1 - y0)
            for x in range(*x_range):
                r, g, b, a = pixels[x, y]
                coverage = min(1, max(0, 0.5 + direction * (x + 0.5 - edge) / 1.8))
                pixels[x, y] = (r, g, b, round(a * coverage))


arm = Image.open(final / "arm_R.png").convert("RGBA")
body = Image.open(final / "body.png").convert("RGBA")
# The arm and cloth already expose a gap on this side. Follow the shaded
# crease and the outer shoulder-seam line, removing the stepped matte.
trim_edge(arm, [
    (704, 352), (721, 346), (738, 335), (751, 325), (767, 323), (784, 321),
    (794, 319), (807, 323), (830, 326), (850, 327), (867, 330), (887, 335), (906, 345),
], (300, 370), -1)
trim_edge(body, [
    (711, 340), (727, 345), (747, 352), (762, 347), (784, 342), (805, 340),
    (829, 337), (849, 335), (870, 338), (888, 342), (910, 348), (932, 350),
], (300, 370), 1)
# Taper the lining of the opposite armhole where its backing meets the shirt.
trim_edge(body, [
    (674, 766), (691, 756), (708, 751), (724, 750), (740, 749), (756, 749),
    (770, 752), (785, 756),
], (730, 780), -1)

hair_back = Image.open(final / "hair_back.png").convert("RGBA")
lock = Image.open(final / "hair_side_R.png").convert("RGBA")
face = Image.open(final / "face.png").convert("RGBA")
short_lock = Image.open(final / "hair_side_L.png").convert("RGBA").load()
source = Image.open(root / "picture.png").convert("RGBA")
back, side, cheek, neck, picture = (image.load() for image in (hair_back, lock, face, body, source))

# The small painted strand beside the long lock's tip belongs to the lock.
fragment = (400, 503, 427, 539)
lock.alpha_composite(hair_back.crop(fragment), dest=fragment[:2])
hair_back.paste((0, 0, 0, 0), fragment)

# Continue the violet of the source lock underneath the opaque cheek and
# lock. The cutter's hidden fill here had inherited red from the skin edge.
for y in range(357, 476):
    pr, pg, pb, _ = picture[400, max(365, min(y, 420))]
    if pb < pr - 4 or pg < 20:
        pr, pg, pb = picture[397, 413][:3]
    for x in range(386, 482):
        r, g, b, a = back[x, y]
        if a and r - b > 7 and (cheek[x, y][3] >= 235 or side[x, y][3] >= 235):
            brightness = (r + 2 * g + b) / (pr + 2 * pg + pb)
            back[x, y] = tuple(min(255, round(c * brightness)) for c in (pr, pg, pb)) + (a,)

# Continue the tied hair behind the opaque neck. The continuation normally
# sits under the face, collar or short lock and keeps their contact covered
# when the head tilts far enough to lift the painted edge above the collar.
for y in range(459, 534):
    left = 591 + 0.030 * (y - 493) ** 2
    sample_y = max(467, min(y, 507))
    color = tuple(round(sum(picture[x, sample_y][c] for x in (638, 641, 644)) / 3)
                  for c in range(3))
    for x in range(590, 640):
        r, g, b, a = back[x, y]
        if max(neck[x, y][3], cheek[x, y][3], short_lock[x, y][3]) < 249 or a >= 230:
            continue
        alpha = round(255 * min(1, max(0, (x - left) / 7)))
        if alpha > a:
            back[x, y] = color + (alpha,)

# Extend the painted shadow on the neck up underneath the jaw. Average the
# sampled colours across adjacent columns so the old seam cannot show on a tilt.
columns = {}
for x in range(481, 616):
    covered = [y for y in range(444, 511) if cheek[x, y][3] >= 230]
    if not covered:
        continue
    edge = covered[-1]
    rows = [neck[x, edge + k][:3] for k in (2, 3, 4, 5)
            if neck[x, edge + k][3] >= 245 and neck[x, edge + k][0] >= 102]
    if rows:
        columns[x] = tuple(sum(c) / len(rows) for c in zip(*rows))
for x in columns:
    nearby = [columns[i] for i in range(x - 4, x + 5) if i in columns]
    color = tuple(round(sum(c) / len(nearby)) for c in zip(*nearby))
    for y in range(445, 506):
        alpha = neck[x, y][3]
        if alpha and cheek[x, y][3] >= 248:
            neck[x, y] = color + (alpha,)

for image, name in [(arm, "arm_R"), (body, "body"), (hair_back, "hair_back"), (lock, "hair_side_R")]:
    image.save(final / f"{name}.png")

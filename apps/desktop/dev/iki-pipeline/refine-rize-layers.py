"""Keep visible PSD paint and continue the bodice only under the long locks."""
from bisect import bisect_left
from pathlib import Path
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter


def region(size, points):
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


root = Path(sys.argv[1])
picture = Image.open(root / "picture.png").convert("RGBA")
original = Image.open(root / "layers/body.png").convert("RGBA")
body = Image.open(root / "final/body.png").convert("RGBA")

outline = region(picture.size, [
    (470, 519), (606, 519), (612, 576), (628, 607), (683, 617), (745, 642),
    (750, 723), (744, 840), (730, 960), (719, 1058), (334, 1058), (313, 945),
    (301, 832), (298, 734), (308, 646), (359, 624), (428, 616), (458, 600), (469, 568),
])
skin = region(picture.size, [
    (462, 518), (612, 518), (615, 577), (646, 607), (663, 632),
    (648, 690), (632, 752), (612, 788), (580, 810), (520, 811), (464, 782),
    (443, 743), (433, 689), (428, 633), (455, 602),
])
trim = region(picture.size, [
    (447, 762), (478, 770), (495, 795), (521, 805), (553, 811), (580, 799),
    (598, 779), (629, 765), (641, 807), (624, 823), (578, 837), (517, 837), (469, 823),
])
mask = Image.new("L", picture.size)
for name in ("hair_side_L", "hair_side_R", "hair_front"):
    part = Image.open(root / "cut" / f"{name}.png").convert("RGBA")
    mask = ImageChops.lighter(mask, part.getchannel("A"))

# The thin strand alongside the right lock crosses visible skin twice. Its
# lower sweep must travel with the lock. Verify against the PSD here so the
# cut's fill behind the strand cannot travel across the collarbone.
right_path = root / "final/hair_side_R.png"
left_path = root / "final/hair_side_L.png"
back_path = root / "final/hair_back.png"
right_lock = Image.open(right_path).convert("RGBA")
left_lock = Image.open(left_path).convert("RGBA")
back_hair = Image.open(back_path).convert("RGBA")
for y in range(617, 778):
    for x in range(447, 480):
        red, green, blue, alpha = picture.getpixel((x, y))
        plum = red < 169 and blue - green >= 4 and red - blue <= 40
        back_hair.putpixel((x, y), (0, 0, 0, 0))
        if plum and alpha > 200:
            right_lock.putpixel((x, y), (red, green, blue, alpha))
            mask.putpixel((x, y), alpha)
        elif red >= 169 and green >= 120 and alpha > 200:
            right_lock.putpixel((x, y), (0, 0, 0, 0))
            body.putpixel((x, y), (red, green, blue, alpha))
            mask.putpixel((x, y), 0)

# Keep each outer loop with its lock. These strips are air, original hair,
# and the shoulder bows in the PSD. The cutter's hidden shell fill can show
# through the air between the strands if it is left on the back layer.
for lock, (x0, y0, x1, y1), inner in (
    (right_lock, (247, 433, 362, 643), lambda x: x >= 344),
    (left_lock, (704, 417, 807, 640), lambda x: x <= 758),
):
    for y in range(y0, y1):
        for x in range(x0, x1):
            source = picture.getpixel((x, y))
            red, green, blue, alpha = source
            r, g, b, a = back_hair.getpixel((x, y))
            from_picture = abs(r-red) + abs(g-green) + abs(b-blue) <= 6
            hair = blue - green >= 4 and red - green >= 5 and -30 <= red - blue <= 40
            if a and alpha > 20 and hair and from_picture and lock.getpixel((x, y))[3] < alpha:
                lock.putpixel((x, y), source)
                mask.putpixel((x, y), alpha)
            if not (inner(x) and hair and alpha > 48):
                back_hair.putpixel((x, y), (0, 0, 0, 0))
right_lock.save(right_path)
left_lock.save(left_path)
back_hair.save(back_path)
soft_mask = mask.filter(ImageFilter.MaxFilter(3))

source_pixel = picture.load()
body_pixel = body.load()
cut_pixel = original.load()
hair_pixel = mask.load()
near_hair = soft_mask.load()
outline_pixel = outline.load()
skin_pixel = skin.load()
trim_pixel = trim.load()


def zone(x, y):
    if trim_pixel[x, y]:
        return 2
    return 1 if skin_pixel[x, y] else 0


def true_paint(pixel, source):
    return pixel[3] >= 200 and source[3] >= 250 and sum(abs(pixel[c] - source[c]) for c in range(3)) <= 3


rows = {}
for y in range(519, 1059):
    samples = [([], []), ([], []), ([], [])]
    for x in range(295, 756):
        c = source_pixel[x, y]
        if not true_paint(cut_pixel[x, y], c) or hair_pixel[x, y] > 80:
            continue
        body_pixel[x, y] = c
        kind = zone(x, y)
        matches = ((c[1] > 147 and c[2] >= c[0] - 17),
                   (c[0] > 160 and c[0] >= c[2] + 15),
                   (c[0] < 100 and c[2] > c[1] + 18))
        if matches[kind]:
            xs, colors = samples[kind]
            xs.append(x)
            colors.append(c)
    rows[y] = samples


def hidden_color(x, y, kind):
    nearest = []
    for yy in range(max(519, y - 14), min(1059, y + 15), 3):
        xs, colors = rows[yy][kind]
        index = bisect_left(xs, x)
        for i in (index - 1, index):
            if 0 <= i < len(xs):
                distance = (x - xs[i]) ** 2 + 6 * (y - yy) ** 2
                nearest.append((distance, colors[i]))
    if not nearest:
        return [(232, 231, 235, 255), (243, 221, 213, 255), (52, 53, 102, 255)][kind]
    picks = sorted(nearest)[:6]
    weights = [1 / (distance + 16) for distance, _ in picks]
    rgb = tuple(round(sum(w * c[i] for w, (_, c) in zip(weights, picks)) / sum(weights)) for i in range(3))
    return (*rgb, 255)


left, top, right, bottom = 295, 519, 756, 1059
patch_size = (right - left, bottom - top)
patches = [Image.new("RGBA", patch_size) for _ in range(3)]
patch_pixels = [img.load() for img in patches]
hidden = [[], [], []]
for y in range(top, bottom):
    for x in range(left, right):
        if not outline_pixel[x, y] or near_hair[x, y] < 190:
            continue
        source = source_pixel[x, y]
        if true_paint(cut_pixel[x, y], source) and hair_pixel[x, y] < 245:
            continue
        kind = zone(x, y)
        patch_pixels[kind][x - left, y - top] = hidden_color(x, y, kind)
        hidden[kind].append((x, y))

# Smooth the reconstructed paint within each material. Using coverage as the
# normalization keeps skin, navy trim and white cloth from bleeding together.
for kind, patch in enumerate(patches):
    for y, samples in rows.items():
        xs, colors = samples[kind]
        for x, color in zip(xs, colors):
            patch_pixels[kind][x - left, y - top] = color
    smoothed = patch.filter(ImageFilter.GaussianBlur(12)).load()
    for x, y in hidden[kind]:
        xx, yy = x - left, y - top
        r, g, b, a = smoothed[xx, yy]
        if a > 16:
            body_pixel[x, y] = tuple(min(255, round(c * 255 / a)) for c in (r, g, b)) + (255,)
        else:
            body_pixel[x, y] = patch_pixels[kind][xx, yy]
body.save(root / "final/body.png")

# A split inside opaque paint has no exterior fringe. Put back the original
# paint along that cut while keeping the cleanup on the arm's outer silhouette.
for side in ("L", "R"):
    path = root / "final" / f"arm_{side}.png"
    arm = Image.open(path).convert("RGBA")
    bare = Image.open(root / "layers" / f"arm_{side}.png").convert("RGBA")
    arm_pixel = arm.load()
    bare_pixel = bare.load()
    edge = original.getchannel("A").filter(ImageFilter.MaxFilter(7)).load()
    x0, y0, x1, y1 = bare.getbbox()
    for y in range(y0, y1):
        for x in range(x0, x1):
            if edge[x, y] > 220 and true_paint(bare_pixel[x, y], source_pixel[x, y]):
                arm_pixel[x, y] = bare_pixel[x, y]
    arm.save(path)

"""Restore narrow hair tips and shoulder paint after cutting Lu Guang."""
from pathlib import Path
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

root = Path(sys.argv[1])
final = root / "final"
picture = Image.open(root / "picture.png").convert("RGBA")
source = picture.load()
body = Image.open(final / "body.png").convert("RGBA")
face = Image.open(final / "face.png").convert("RGBA")
back = Image.open(final / "hair_back.png").convert("RGBA")
front = Image.open(final / "hair_front.png").convert("RGBA")

# Only the narrow painted lock belongs in front of each ear. Trim the
# pale fill that the cutter would otherwise expose below the scalp.
back_px = back.load()
for y in range(324, 399):
    for x in range(397, 696):
        if not back_px[x, y][3]:
            continue
        r, g, b, a = source[x, y]
        silver = a > 20 and r < b + 18 and b >= g - 6
        floor = 333 + 0.16 * min(65, abs(x - 550))
        if y > floor and not silver:
            back_px[x, y] = (0, 0, 0, 0)

tips = {
    "R": [(437, 326), (445, 329), (451, 337), (459, 348), (466, 357), (474, 369),
          (470, 370), (459, 362), (451, 355), (444, 346), (438, 336)],
    "L": [(657, 325), (660, 328), (655, 338), (650, 345), (641, 355), (633, 363),
          (622, 370), (621, 369), (628, 357), (637, 348), (643, 338), (649, 330)],
}
openings = {
    "R": [(454, 324), (466, 323), (484, 323), (503, 323), (515, 327), (525, 337),
          (519, 341), (510, 344), (495, 346), (480, 345), (468, 340), (459, 335)],
    "L": [(566, 337), (575, 329), (589, 324), (605, 322), (624, 322), (644, 322),
          (641, 328), (632, 334), (623, 340), (613, 345), (594, 346), (578, 343)],
}
face_px, front_px = face.load(), front.load()
for side in ("R", "L"):
    path = final / f"hair_side_{side}.png"
    lock = Image.open(path).convert("RGBA")
    lock_px = lock.load()
    tip = Image.new("1", picture.size)
    ImageDraw.Draw(tip).polygon(tips[side], fill=1)
    tip_px = tip.load()
    x0, y0, x1, y1 = tip.getbbox()
    # Fill under the original tip from the adjacent cheek or ear.
    for y in range(y0, y1):
        for x in range(x0, x1):
            if not tip_px[x, y]:
                continue
            lock_px[x, y] = source[x, y]
            sample = source[x + (11 if side == "R" else -11), y + 4]
            if face_px[x, y][3] > 0 and sample[3] > 220:
                face_px[x, y] = sample
    opening = Image.new("1", picture.size)
    ImageDraw.Draw(opening).polygon(openings[side], fill=1)
    open_px = opening.load()
    paths = [final / f"{role}_{side}.png" for role in ("eye", "iris", "lash", "lash_lower")]
    eyes = [Image.open(path).convert("RGBA") for path in paths]
    planes = [eye.load() for eye in eyes]
    x0, x1 = (453, 527) if side == "R" else (565, 644)
    for y in range(316, 351):
        for x in range(x0, x1):
            if open_px[x, y] or not any(plane[x, y][3] for plane in planes):
                continue
            for plane in planes:
                plane[x, y] = (0, 0, 0, 0)
            if tip_px[x, y]:
                continue
            r, g, b, a = source[x, y]
            if r < b + 18 and b >= g - 6 and r > 110:
                target = lock_px if (side == "R" and x <= 459 or side == "L" and x >= 637) else front_px
            else:
                target = face_px
            target[x, y] = (r, g, b, a)
    for eye_path, eye in zip(paths, eyes):
        eye.save(eye_path)
    lock.save(path)

# Continue the painted shadow under the jaw with a tapered top. The
# original neck below the contour stays on the body.
jaw = ((489, 432), (509, 448), (530, 463), (550, 469), (566, 467), (586, 453), (610, 431))
jaw_bottom = {x: round(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
              for (x0, y0), (x1, y1) in zip(jaw, jaw[1:]) for x in range(x0, x1 + 1)}
neck = body.load()
for x in range(486, 614):
    top = round(394 + 42 * ((x - 550) / 65) ** 2)
    bottom = jaw_bottom.get(x, 429)
    colors = [source[col, jaw_bottom[col] + dy]
              for col in range(max(489, x - 4), min(610, x + 4) + 1) for dy in (4, 6, 8)
              if 135 < source[col, jaw_bottom[col] + dy][0] < 211]
    if not colors:
        continue
    shade = tuple(round(sum(color[c] for color in colors) / len(colors)) for c in range(3))
    for y in range(394, bottom):
        if neck[x, y][3] == 0 and face_px[x, y][3] < 245:
            continue
        if y < top and neck[x, y] != source[x, y]:
            neck[x, y] = (0, 0, 0, 0)
        elif y >= top and (face_px[x, y][3] > 245 or neck[x, y] != source[x, y]):
            alpha = min(255, (y - top + 1) * 96)
            neck[x, y] = (*shade, alpha)

# Restore the opaque jacket paint where the two split layers touch.
split = {name: Image.open(root / "layers" / (name + ".png")).convert("RGBA") for name in ("body", "arm_L", "arm_R")}
arm_alpha = ImageChops.lighter(split["arm_L"].getchannel("A"), split["arm_R"].getchannel("A"))
for name, layer in (("body", body), *((arm, Image.open(final / (arm + ".png")).convert("RGBA"))
                                     for arm in ("arm_L", "arm_R"))):
    neighbor = arm_alpha if name == "body" else split["body"].getchannel("A")
    near = neighbor.filter(ImageFilter.MaxFilter(7)).load()
    layer_px, split_px = layer.load(), split[name].load()
    for y in range(719, 1004):
        for x in (*range(205, 309), *range(800, 900)):
            pixel = split_px[x, y]
            if pixel[3] == 255 and near[x, y] > 235 and pixel == source[x, y]:
                layer_px[x, y] = pixel
    layer.save(final / (name + ".png"))

for name, layer in (("face", face), ("hair_back", back), ("hair_front", front)):
    layer.save(final / (name + ".png"))

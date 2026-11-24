"""Restore Cheng Xiaoshi's eye contours and the paint at the sleeve cuts."""
from pathlib import Path
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

root = Path(sys.argv[1])
source = Image.open(root / "picture.png").convert("RGBA")
names = ("body", "arm_L", "arm_R")
split = {name: Image.open(root / "layers" / f"{name}.png").convert("RGBA") for name in names}
arms = ImageChops.lighter(split["arm_R"].getchannel("A"), split["arm_L"].getchannel("A"))
neighbors = {"body": arms, "arm_L": split["body"].getchannel("A"), "arm_R": split["body"].getchannel("A")}
source_pixel = source.load()
for name in names:
    path = root / "final" / f"{name}.png"
    layer = Image.open(path).convert("RGBA")
    cleaned = layer.load()
    original = split[name].load()
    beside_cut = neighbors[name].filter(ImageFilter.MaxFilter(9)).load()
    for y in range(575, 969):
        for x in range(237, 864):
            paint = original[x, y]
            if beside_cut[x, y] > 220 and paint == source_pixel[x, y] and paint[3] == 255:
                cleaned[x, y] = paint
    layer.save(path)

# The lids cross the dark bangs. Retain the moving eye only inside its drawn
# opening and put the touching strands and stationary creases back in place.
face_path = root / "final/face.png"
front_path = root / "final/hair_front.png"
face = Image.open(face_path).convert("RGBA")
front = Image.open(front_path).convert("RGBA")
openings = {
    "R": ([465, 309, 532, 342], [(466, 319), (473, 315), (486, 313), (502, 314), (517, 318),
                               (528, 326), (526, 332), (512, 337), (483, 337), (472, 331)]),
    "L": ([570, 310, 635, 341], [(570, 332), (581, 322), (591, 317), (605, 314), (625, 313),
                               (633, 315), (630, 321), (621, 330), (607, 337), (580, 338)]),
}
for side, ((x0, y0, x1, y1), outline) in openings.items():
    lock_path = root / "final" / f"hair_side_{side}.png"
    lock = Image.open(lock_path).convert("RGBA")
    paths = [root / "final" / f"{name}_{side}.png" for name in ("eye", "iris", "lash", "lash_lower")]
    planes = [Image.open(path).convert("RGBA") for path in paths]
    opening = Image.new("1", (x1 - x0 + 1, y1 - y0 + 1))
    ImageDraw.Draw(opening).polygon([(x - x0, y - y0) for x, y in outline], fill=1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if opening.getpixel((x - x0, y - y0)) or not any(plane.getpixel((x, y))[3] for plane in planes):
                continue
            for plane in planes:
                plane.putpixel((x, y), (0, 0, 0, 0))
            red, green, blue, alpha = source_pixel[x, y]
            if green < 114 and abs(red - blue) < 34:
                outer = x < 475 if side == "R" else x > 625
                part = lock if outer else front
            else:
                part = face
            part.putpixel((x, y), (red, green, blue, alpha))
    for path, plane in zip(paths, planes):
        plane.save(path)
    lock.save(lock_path)

# The cut leaves some of the original chin ink on the neck. Put that ink on
# the moving face and fill only the contour hidden underneath at rest.
body_path = root / "final/body.png"
body = Image.open(body_path).convert("RGBA")
neck = body.load()
for y in range(412, 468):
    for x in range(521, 585):
        paint = source_pixel[x, y]
        if neck[x, y] != paint or paint[0] > 112 or paint[3] < 220:
            continue
        face.putpixel((x, y), paint)

# Continue the painted neck shadow behind the jaw. Sample just below the
# source chin, mixing neighboring columns so the old contour cannot print
# through when the chin moves away from its resting position.
jaw = ((498, 419), (510, 432), (522, 444), (538, 459), (550, 464),
       (562, 460), (574, 449), (586, 436), (598, 424), (606, 415))
jaw_bottom = {
    x: round(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
    for (x0, y0), (x1, y1) in zip(jaw, jaw[1:])
    for x in range(x0, x1 + 1)
}
for x in range(498, 607):
    bottom = jaw_bottom[x]
    samples = [
        source_pixel[column, jaw_bottom[column] + dy]
        for column in range(max(498, x - 4), min(606, x + 4) + 1)
        for dy in (3, 5, 7)
        if source_pixel[column, jaw_bottom[column] + dy][0] > 135
    ]
    if not samples:
        continue
    shadow = [sum(pixel[c] for pixel in samples) / len(samples) for c in range(3)]
    for y in range(387, bottom + 3):
        red, green, blue, alpha = neck[x, y]
        if alpha < 230:
            continue
        coverage = min(1, (x - 497) / 5, (607 - x) / 5, (bottom + 3 - y) / 4)
        if y <= bottom and source_pixel[x, y][0] <= 112 and 521 <= x < 585:
            coverage = 1
        rgb = tuple(round(old + coverage * (sample - old)) for old, sample in zip((red, green, blue), shadow))
        neck[x, y] = (*rgb, alpha)

# Round the neck's hidden top so the lift and roll of the head do not expose
# the cutter's straight fill line. Extend only behind the opaque face paint.
for x in range(486, 616):
    top = round(387 + 25 * ((x - 550) / 65) ** 2)
    first = next((y for y in range(410, 428) if neck[x, y][3] > 245), None)
    if first is None:
        continue
    samples = [neck[x, first + dy] for dy in (3, 5, 7) if neck[x, first + dy][3] > 220]
    if not samples:
        continue
    color = tuple(round(sum(pixel[c] for pixel in samples) / len(samples)) for c in range(3)) + (255,)
    for y in range(top, first):
        if face.getpixel((x, y))[3] > 245 and neck[x, y][3] < 245:
            neck[x, y] = color
body.save(body_path)
face.save(face_path)
front.save(front_path)

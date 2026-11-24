"""Cut the reaching sleeve line, hand, and white flower from the offer artwork."""
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageDraw

source = Image.open(sys.argv[1]).convert("RGBA")
output = Path(sys.argv[2])
box = (107, 369, 333, 632)
# These outlines are in pixels on the 725×2170 offer reference. The source's
# alpha supplies the free outline of the shoulder and forearm. The mask cuts
# along the shirt seam, around the fingers, and between the petals and shirt.
arm = [
    (108, 372), (198, 372), (212, 377), (223, 384), (229, 392), (234, 401),
    (238, 412), (241, 425), (241, 433), (236, 450), (239, 461), (248, 476),
    (254, 489), (261, 504), (268, 513), (274, 518), (278, 524), (281, 536),
    (286, 541), (289, 548), (283, 555), (284, 560), (281, 566), (276, 572),
    (271, 578), (270, 586), (267, 591), (264, 597), (263, 602), (259, 609),
    (253, 614), (245, 621), (239, 625), (196, 627), (151, 627),
    (108, 593),
]
bloom = [
    (217, 439), (218, 434), (222, 430), (228, 425), (237, 425), (243, 428),
    (247, 421), (252, 416), (258, 412), (264, 412), (270, 410), (278, 412),
    (285, 417), (289, 424), (290, 431), (295, 429), (303, 427), (310, 429),
    (316, 431), (319, 436), (318, 441), (314, 447), (308, 453), (305, 459),
    (301, 464), (293, 468), (283, 471), (272, 472), (260, 470), (251, 469),
    (243, 465), (234, 461), (229, 455), (224, 450),
]
leaves_and_stem = [
    (235, 466), (244, 468), (251, 472), (257, 480), (262, 490), (265, 497),
    (265, 479), (262, 472), (260, 465), (275, 465), (273, 473), (271, 481),
    (270, 503), (275, 495), (280, 490), (285, 488), (289, 488), (295, 486),
    (303, 486), (310, 485), (307, 489), (302, 493), (297, 497), (292, 502),
    (284, 506), (277, 507), (269, 514), (268, 528), (263, 530), (262, 516),
    (257, 510), (253, 502), (248, 496), (245, 486), (241, 477),
]
supersampling = 4
left, top, right, bottom = box
width, height = right - left, bottom - top
mask = Image.new("L", (width * supersampling, height * supersampling))
draw = ImageDraw.Draw(mask)
for contour in (arm, bloom, leaves_and_stem):
    draw.polygon([((x - left) * supersampling, (y - top) * supersampling) for x, y in contour], fill=255)
cut = source.crop(box)
mask = mask.resize(cut.size, Image.Resampling.LANCZOS)
alpha = cut.getchannel("A").point(lambda a: 0 if a < 14 else 255 if a > 247 else a)
cut.putalpha(ImageChops.multiply(alpha, mask))
cut.save(output)

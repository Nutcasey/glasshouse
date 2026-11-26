import sys, os
from PIL import Image, ImageDraw, ImageFont
a, b, out = sys.argv[1:4]
steps = [s.split('=', 1) for s in sys.argv[4:]]
W, H, GAP, HEAD = 800, 450, 20, 52
f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 24)
fb = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 28)
sheet = Image.new('RGB', (W * 2 + GAP * 3, 60 + (H + HEAD) * len(steps)), (255, 255, 255))
d = ImageDraw.Draw(sheet)
d.text((GAP, 16), 'main (1005b9a6 + measuring)', fill=(0, 0, 0), font=fb)
d.text((GAP * 2 + W, 16), 'this branch', fill=(0, 0, 0), font=fb)
for i, (name, label) in enumerate(steps):
    y = 60 + i * (H + HEAD)
    d.text((GAP, y + 14), label, fill=(60, 60, 60), font=f)
    for j, src in enumerate((a, b)):
        sheet.paste(Image.open(os.path.join(src, name + '.jpg')).resize((W, H)), (GAP + j * (W + GAP), y + HEAD))
sheet.save(out, quality=82)
print(sheet.size, os.path.getsize(out))

import sys
import av
from PIL import Image, ImageDraw

container = av.open(sys.argv[1])
duration = container.duration / 1000000
print(f"duration_seconds={duration}")
sheet = Image.new("RGB", (1600, 1400), "white")
draw = ImageDraw.Draw(sheet)
last = -duration
count = 0
for frame in container.decode(video=0):
    if frame.time - last < max(duration / 8, 1):
        continue
    last = frame.time
    picture = frame.to_image()
    picture.thumbnail((395, 660))
    x, y = (count % 4) * 400, (count // 4) * 700
    sheet.paste(picture, (x, y + 30))
    draw.text((x + 5, y + 5), f"{frame.time:.1f} s", fill="black")
    count += 1
    if count == 8:
        break
sheet.save(sys.argv[2])

from pathlib import Path
import hashlib
import json
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
FONT = Path('/System/Library/Fonts/Supplemental/Arial.ttf')
BOLD = Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf')
COPY = {
    'de-DE': [
        ('Dein Web.\nIn deinem Orbit.', 'Die Adressleiste. Genau in Daumenreichweite.'),
        ('Mehr Seite.\nWeniger Leiste.', 'Beim Scrollen bleibt nur eine kleine Kapsel.'),
        ('Alle Tabs.\nEin klarer Blick.', 'Mit einer Geste zur visuellen Übersicht.'),
        ('Dein Mac.\nZum Mitnehmen.', 'Spaces, Pins & Ordner. Optional verschlüsselt synchronisiert.'),
        ('Dein Look.\nDein Gefühl.', 'Farben, Verläufe und Texturen nach deinem Geschmack.'),
        ('Ein Icon.\nGanz dein Stil.', 'Sieben Looks für deinen Home-Bildschirm.'),
    ],
    'en-US': [
        ('Your web.\nIn your orbit.', 'The address bar. Right where your thumb is.'),
        ('More page.\nLess chrome.', 'Scroll down. The bar becomes a tiny pill.'),
        ('Every tab.\nOne clear view.', 'A gesture away from your visual overview.'),
        ('Your Mac.\nTo go.', 'Spaces, pins & folders. Optional encrypted sync.'),
        ('Your look.\nYour feeling.', 'Colours, gradients and textures. Make it yours.'),
        ('An icon.\nAll your own.', 'Seven looks for your Home Screen.'),
    ],
}
IPAD = {
    'de-DE': [('Viel Raum.\nFür dein Web.', 'Eine anpassbare Seitenleiste. Drei Spalten für deine Pins.'), ('Deine Seite.\nIn voller Größe.', 'Blende die Seitenleiste aus. Gib dem Web mehr Raum.')],
    'en-US': [('Room to browse.\nSpace to think.', 'A resizable sidebar. Three columns for your pins.'), ('Your page.\nThe whole stage.', 'Hide the sidebar. Give the web more room.')],
}
FILES = ['01-browser', '02-pill', '03-tabs', '04-spaces', '05-theme', '06-icons']
PALETTES = [(108, 84, 219), (45, 115, 158), (117, 84, 198), (46, 130, 129), (159, 75, 132), (114, 98, 193)]

def font(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else FONT), int(size))

def background(width, height, accent):
    small = Image.new('RGB', (width // 4, height // 4))
    pixels = small.load()
    for y in range(small.height):
        for x in range(small.width):
            nx, ny = x / small.width, y / small.height
            glow = math.exp(-(((nx - .82) / .8) ** 2 + ((ny - .62) / .52) ** 2) * 2)
            second = math.exp(-(((nx - .05) / .5) ** 2 + ((ny - .1) / .5) ** 2) * 2)
            pixels[x, y] = tuple(int(13 + accent[c] * .27 * glow + (15, 13, 27)[c] * second) for c in range(3))
    return small.resize((width, height), Image.Resampling.BICUBIC).convert('RGBA')

def centered(draw, text, y, face, fill, width):
    box = draw.textbbox((0, 0), text, font=face)
    draw.text(((width - (box[2] - box[0])) / 2, y), text, font=face, fill=fill)

def render(device, locale, index):
    width, height = (1320, 2868) if device == 'iphone' else (2064, 2752)
    title, subtitle = COPY[locale][index]
    if device == 'ipad' and index < 2:
        title, subtitle = IPAD[locale][index]
    canvas = background(width, height, PALETTES[index])
    draw = ImageDraw.Draw(canvas)
    scale = width / 1320
    brand_y = 82 if device == 'iphone' else 70
    centered(draw, 'O R B I T', brand_y, font(37 * scale, True), '#C8B8FF', width)
    title_size = 113 if device == 'iphone' else 130
    title_y = 172 if device == 'iphone' else 165
    for line_number, line in enumerate(title.split('\n')):
        centered(draw, line, title_y + line_number * title_size * 1.06, font(title_size, True), '#FAF8FF', width)
    sub_size = 34 if device == 'iphone' else 42
    while draw.textlength(subtitle, font=font(sub_size)) > width - 140:
        sub_size -= 1
    centered(draw, subtitle, title_y + title_size * 2.23 + 27, font(sub_size), '#C5BDD4', width)
    shot = Image.open(ROOT / 'raw' / device / (FILES[index] + '.png')).convert('RGBA')
    target_width = 1000 if device == 'iphone' else 1608
    target_height = round(shot.height * target_width / shot.width)
    shot = shot.resize((target_width, target_height), Image.Resampling.LANCZOS)
    x = (width - target_width) // 2
    y = 610 if device == 'iphone' else 565
    radius = 80 if device == 'iphone' else 34
    shadow = Image.new('RGBA', canvas.size)
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x - 22, y - 22, x + target_width + 22, y + target_height + 22), radius=radius + 20, fill=(0, 0, 0, 180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(32))
    canvas.alpha_composite(shadow)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x - 13, y - 13, x + target_width + 13, y + target_height + 13), radius=radius + 13, fill='#13131A', outline='#55515F', width=3)
    mask = Image.new('L', shot.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, target_width - 1, target_height - 1), radius=radius, fill=255)
    canvas.paste(shot, (x, y), mask)
    output = ROOT / locale / device / (FILES[index] + '.png')
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert('RGB').save(output, optimize=True)
    return {'file': str(output.relative_to(ROOT)), 'width': width, 'height': height, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}

if __name__ == '__main__':
    manifest = []
    for locale in COPY:
        for device in ['iphone', 'ipad']:
            for index in range(6):
                if device == 'ipad' and index == 2:
                    continue
                manifest.append(render(device, locale, index))
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Rendered {len(manifest)} screenshots')

#!/usr/bin/env python3
# Draws the app icon (needs Pillow) and writes web/icons/icon-192.png, icon-512.png and the macOS
# icon "Claude Companion.app"/Contents/Resources/AppIcon.icns, and web/icons/app.ico for Windows. Run again only to change the icon.
import io, os, struct
from PIL import Image, ImageDraw

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ClaudeCompanion', 'web')


def draw(n):
    s = n * 4                                            # draw large, then scale down for clean edges
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = int(s * 0.06)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], int(s * 0.22), fill=(22, 23, 27, 255), outline=(48, 49, 57, 255), width=max(4, s // 128))
    c, r = s / 2, s * 0.27
    d.arc([c - r, c - r, c + r, c + r], start=40, end=320, fill=(226, 179, 69, 255), width=int(s * 0.075))
    x, y, k = c + r * 0.78, c - r * 0.02, s * 0.07     # four-point spark
    d.polygon([(x, y - k), (x + k * .28, y - k * .28), (x + k, y), (x + k * .28, y + k * .28), (x, y + k), (x - k * .28, y + k * .28), (x - k, y), (x - k * .28, y - k * .28)], fill=(236, 236, 238, 255))
    return im.resize((n, n), Image.LANCZOS)


def png(n):
    b = io.BytesIO(); draw(n).save(b, 'PNG', optimize=True); return b.getvalue()


if __name__ == '__main__':
    for n in (192, 512):
        with open(os.path.join(WEB, 'icons', f'icon-{n}.png'), 'wb') as f: f.write(png(n))
    # .icns: 'icns' + total length, then (type, length incl. 8-byte header, PNG data) per size
    parts = b''.join(t + struct.pack('>I', 8 + len(p)) + p for t, p in
                     ((t.encode(), png(n)) for t, n in (('ic11', 32), ('ic12', 64), ('ic07', 128), ('ic13', 256), ('ic08', 256), ('ic14', 512), ('ic09', 512), ('ic10', 1024))))
    with open(os.path.join(WEB, 'Claude Companion.app', 'Contents', 'Resources', 'AppIcon.icns'), 'wb') as f:
        f.write(b'icns' + struct.pack('>I', 8 + len(parts)) + parts)
    # Windows icon for the Start menu shortcut (server.ps1)
    draw(256).save(os.path.join(WEB, 'icons', 'app.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

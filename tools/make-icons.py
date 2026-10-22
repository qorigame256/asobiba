# ホーム画面に追加したときのアイコンを作る（2026-10-08。24回目の案）。python3 tools/make-icons.py（Pillow が要る）
# 橙の地に、クリーム色の盤と ○（青）・×（橙）のマルバツ。iPhone は角を自分で丸めるので、地は四角いまま塗りつぶす。
# 盤は真ん中の6割に収め、Android の「丸や角丸に切り抜く」アイコン（maskable）でも欠けないようにした。
from PIL import Image, ImageDraw
import os

BG = (217, 100, 58)       # --accent
BOARD = (247, 242, 233)   # --bg
LINE = (214, 200, 180)
O_COL = (47, 111, 179)    # --p1
X_COL = (217, 100, 58)    # --p0
SS = 4  # 大きく描いてから縮め、線のふちをなめらかにする

def icon(size):
    S = size * SS
    im = Image.new('RGB', (S, S), BG)
    d = ImageDraw.Draw(im)
    m = S * 0.2
    d.rounded_rectangle([m, m, S - m, S - m], radius=S * 0.08, fill=BOARD)
    cell = (S - 2 * m) / 3
    w = max(1, round(S * 0.018))
    for i in (1, 2):
        d.line([m + cell * i, m + S * 0.03, m + cell * i, S - m - S * 0.03], fill=LINE, width=w)
        d.line([m + S * 0.03, m + cell * i, S - m - S * 0.03, m + cell * i], fill=LINE, width=w)
    pw = max(1, round(S * 0.035))
    pad = cell * 0.22
    def at(cx, cy):
        return m + cell * cx, m + cell * cy
    for cx, cy in ((0, 0), (1, 1), (2, 2)):  # ○ がななめに3つ
        x, y = at(cx, cy)
        d.ellipse([x + pad, y + pad, x + cell - pad, y + cell - pad], outline=O_COL, width=pw)
    for cx, cy in ((2, 0), (0, 2)):  # ×
        x, y = at(cx, cy)
        d.line([x + pad, y + pad, x + cell - pad, y + cell - pad], fill=X_COL, width=pw)
        d.line([x + cell - pad, y + pad, x + pad, y + cell - pad], fill=X_COL, width=pw)
    return im.resize((size, size), Image.LANCZOS)

root = os.path.join(os.path.dirname(__file__), '..')
out = os.path.join(root, 'app', 'img')
for size, name in ((180, 'icon-180.png'), (192, 'icon-192.png'), (512, 'icon-512.png')):
    icon(size).save(os.path.join(out, name), optimize=True)
    print(name)

# App Store 版（2026-10-22）。アイコンは同じ絵の 1024 四方（Apple は透明を許さないので RGB のまま。角は iPhone が丸める）。
# 起動画面は、ホーム画面と同じクリーム色の地の真ん中に、角を丸めたアイコンを置く（字は入れない。Apple の勧め）。
# 2732 四方の絵を LaunchScreen.storyboard が画面いっぱいに広げて端を切るので、縦長の iPhone で見えるのは真ん中の幅およそ 1260 だけ。
# アイコンは幅 560（iPhone でおよそ画面の幅の4割）にした。地の色は storyboard の背景の色とそろえる。
assets = os.path.join(root, 'native', 'ios', 'App', 'App', 'Assets.xcassets')
icon(1024).save(os.path.join(assets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), optimize=True)
print('AppIcon-512@2x.png')
SPLASH, MARK = 2732, 560
splash = Image.new('RGB', (SPLASH, SPLASH), BOARD)
mask = Image.new('L', (MARK * SS, MARK * SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, MARK * SS - 1, MARK * SS - 1], radius=MARK * SS * 0.225, fill=255)
mask = mask.resize((MARK, MARK), Image.LANCZOS)
splash.paste(icon(MARK), ((SPLASH - MARK) // 2, (SPLASH - MARK) // 2), mask)
for name in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
    splash.save(os.path.join(assets, 'Splash.imageset', name), optimize=True)
    print(name)

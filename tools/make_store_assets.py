#!/usr/bin/env python3
"""
스토어 이미지 · 앱 아이콘을 게임 원본 그림 코드로 새로 만듭니다.

    python3 tools/make_store_assets.py

만들어지는 것
  store/icon-512.png                      Play 스토어 앱 아이콘 (512×512, 32-bit PNG)
  store/feature-graphic-1024x500.png      그래픽 이미지 (1024×500, 알파 없음)
  store/screenshots/01~06.png             휴대전화 스크린샷 (1080×1920, 알파 없음, 캡션 포함)
  store/screenshots/raw/*.png             캡션 없는 원본 화면
  android/app/src/main/res/mipmap-*/      런처 아이콘(적응형 전경·모노크롬·레거시·원형)

우주선·UFO·모선은 game.js의 그리기 함수를 그대로 써서 도트를 뽑고,
최근접 확대(nearest)로 키우기 때문에 흐려지지 않습니다.
"""
import asyncio, base64, io, json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / 'store'
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_single.py')], check=True, stdout=subprocess.DEVNULL)
from playwright.async_api import async_playwright

BG = '#15152D'

# ── 그리기 훅 (복사본에만 주입) ─────────────────────────────────────
HOOK = r"""
window.__art = {
  sprite: (o) => {
    const W = o.w || 64, H = o.h || 72;
    const keep = { mode, runDress, gold: { ...gold }, shipPaint, flame, tick, doll, hyperLeft, hyperEase, weaponLeft, magnetLeft, masked, invincible, dents, runTrophy, impactLeft, boss, orbs, trophies };
    low.width = W; low.height = H; ctx.setTransform(1 / PX, 0, 0, 1 / PX, 0, 0); ctx.clearRect(0, 0, W * PX, H * PX);
    mode = 'hangar'; runDress = {}; (o.dress || []).forEach((k) => (runDress[k] = true));
    if (o.gold) DRESS_KEYS.forEach((k) => (gold[k] = GOLD_PIECES));
    shipPaint = o.paint || 'basic'; flame = o.flame || 'basic'; tick = o.tick || 0; doll = !!o.doll;
    hyperLeft = 0; hyperEase = 0; weaponLeft = 0; magnetLeft = 0; masked = 0; invincible = 0; dents = []; impactLeft = 0;
    runTrophy = o.trophy || {}; trophies = 0;
    const cx = W * PX / 2 + (o.dx || 0), cy = H * PX / 2 + (o.dy || 0);
    if (o.kind === 'ufo') { mode = 'playing'; ufo(cx, cy, 0, false, { color: o.color || '#bca5eb', stun: 0, spin: 0, grace: 0, scene: true }); }
    else if (o.kind === 'boss') { orbs = []; boss = { x: cx, y: cy, P: PLANETS[o.planet || 0], claw: null, cracks: 0, dizzy: 0, flash: 0, t: 0 }; drawBoss(); }
    else if (o.kind === 'icon') { ctx.save(); ctx.translate(cx, cy); ctx.scale(o.s || 1, o.s || 1); drawIcon(ctx, o.icon); ctx.restore(); }
    else { if (o.mode) mode = o.mode; ship(cx, cy, o.t || 0); }
    const url = low.toDataURL();
    Object.assign(window.__keep = keep);
    ({ mode, runDress, shipPaint, flame, tick, doll, hyperLeft, hyperEase, weaponLeft, magnetLeft, masked, invincible, dents, runTrophy, impactLeft, boss, orbs, trophies } = keep);
    Object.assign(gold, keep.gold);
    labels = []; resize();
    return url;
  },
  // 스크린샷용 장면 준비
  go: () => { start(false); },
  ff: (n) => { for (let i = 0; i < n; i++) { invincible = 999; update(STEP); tick++; } },
  dress: (ks) => { ks.forEach((k) => (runDress[k] = true)); },
  weapon: (s) => { weaponLeft = s; },
  hyper: () => { hyperCharged = true; invincible = 0; activateHyper(); },
  boss: () => { spawnBoss(); for (let i = 0; i < 140; i++) { invincible = 999; update(STEP); tick++; } },
  setT: (t) => { elapsed = t; },
  stars: (v) => { stars = v; saveProgress(); },
  hold: () => { invincible = 999; },
  freeze: () => { window.__frozen = true; },
  die: () => { invincible = 0; lives = 0; die('운석에 부딪혔어요. 한 번 더?', playerX, playerY - 20, '운석'); },
  hangar: () => openHangar(),
  friend: (k) => { runFriends[k] = true; },
  dbg: () => ({ mode, elapsed, score, planetIdx, boss: !!boss }),
};
tips.tutorial = true; // 스크린샷은 연습 비행 없이 바로 본게임
"""


def png(data_url):
    return Image.open(io.BytesIO(base64.b64decode(data_url.split(',', 1)[1]))).convert('RGBA')


def crop(im):
    box = im.getbbox()
    return im.crop(box) if box else im


def up(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


async def sprites(b, url):
    pg = await (await b.new_context(viewport={'width': 400, 'height': 700})).new_page()
    await pg.goto(url); await pg.wait_for_timeout(300)
    S = {}
    async def get(name, **o):
        S[name] = crop(png(await pg.evaluate('(o)=>__art.sprite(o)', o)))
    await get('ship', w=48, h=56, dy=-6, mode='hangar')
    await get('ship_bunny', w=48, h=64, dy=4, dress=['rabbit'], mode='hangar')
    await get('ship_dressed', w=80, h=80, dress=['rabbit', 'crown', 'duck', 'chick', 'fish', 'disco', 'moustache', 'cat', 'diamond'], mode='hangar', tick=8)
    await get('ship_legend', w=120, h=128, gold=True, dress=['rabbit', 'crown', 'duck', 'chick', 'fish', 'disco', 'moustache', 'cat', 'diamond'], mode='hangar', tick=8, t=900)
    await get('ufo', w=64, h=56, kind='ufo')
    await get('ufo_pink', w=64, h=56, kind='ufo', color='#f6a9cf')
    await get('boss', w=110, h=60, dy=6, kind='boss')
    for k in ['f_bunny', 'f_chick', 'f_cat']:
        await get(k, w=28, h=28, kind='icon', icon=k)
    await pg.close()
    return S


# ── 아이콘 ─────────────────────────────────────────────────────────
def make_icons(S):
    ship = S['ship_bunny']
    def canvas(size, bg=True):
        return Image.new('RGBA', (size, size), BG if bg else (0, 0, 0, 0))
    def stars_on(im, unit, pts):
        from PIL import ImageDraw
        d = ImageDraw.Draw(im)
        for (x, y, big) in pts:
            X, Y = int(x * im.width), int(y * im.height)
            if big:
                c = '#ffe6aa'
                d.rectangle([X - unit, Y - 3 * unit, X + unit - 1, Y + 3 * unit - 1], fill=c)
                d.rectangle([X - 3 * unit, Y - unit, X + 3 * unit - 1, Y + unit - 1], fill=c)
            else:
                d.rectangle([X - unit, Y - unit, X + unit - 1, Y + unit - 1], fill='#d9d2f8')
    STARS = [(0.13, 0.16, 0), (0.84, 0.13, 0), (0.80, 0.30, 1), (0.10, 0.55, 0), (0.88, 0.62, 0), (0.20, 0.82, 0), (0.76, 0.88, 0), (0.62, 0.24, 0)]

    # Play 스토어 512: 꽉 찬 정사각형(모서리는 Play가 자동으로 둥글게)
    k = 512 * 0.80 / max(ship.width, ship.height)
    k = int(k)
    big = up(ship, k)
    ic = canvas(512); stars_on(ic, k // 2 or 1, STARS)
    ic.alpha_composite(big, ((512 - big.width) // 2, (512 - big.height) // 2 + 6))
    ic.save(STORE / 'icon-512.png')

    # 적응형 전경 432(108dp@xxxhdpi): 안전 영역 지름 66dp=264px 안에 기체
    def fg(size, safe):
        k = max(1, int(size * safe / max(ship.width, ship.height)))
        b2 = up(ship, k)
        im = canvas(size, False)
        im.alpha_composite(b2, ((size - b2.width) // 2, (size - b2.height) // 2))
        return im
    dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
    for d, m in dens.items():
        folder = RES / f'mipmap-{d}'; folder.mkdir(exist_ok=True)
        s108 = int(108 * m)
        f = fg(s108, 0.60)
        f.save(folder / 'ic_launcher_foreground.png')
        mono = Image.new('RGBA', f.size, (0, 0, 0, 0)); mono.putalpha(f.getchannel('A'))
        white = Image.new('RGBA', f.size, (255, 255, 255, 255)); white.putalpha(f.getchannel('A'))
        white.save(folder / 'ic_launcher_monochrome.png')
        s48 = int(48 * m)
        leg = canvas(s48)
        k2 = max(1, round(s48 * 0.78 / max(ship.width, ship.height)))
        sp = up(ship, k2) if k2 * max(ship.width, ship.height) <= s48 else ship.resize((int(ship.width * s48 * 0.78 / max(ship.size)), int(ship.height * s48 * 0.78 / max(ship.size))), Image.NEAREST)
        lg = leg.copy(); lg.alpha_composite(sp, ((s48 - sp.width) // 2, (s48 - sp.height) // 2))
        # 레거시 사각형: 둥근 모서리
        from PIL import ImageDraw
        mask = Image.new('L', (s48, s48), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, s48 - 1, s48 - 1], radius=int(s48 * 0.18), fill=255)
        out = Image.new('RGBA', (s48, s48), (0, 0, 0, 0)); out.paste(lg, (0, 0), mask); out.save(folder / 'ic_launcher.png')
        mask = Image.new('L', (s48, s48), 0); ImageDraw.Draw(mask).ellipse([0, 0, s48 - 1, s48 - 1], fill=255)
        out = Image.new('RGBA', (s48, s48), (0, 0, 0, 0)); out.paste(lg, (0, 0), mask); out.save(folder / 'ic_launcher_round.png')
    xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/neon_bg" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
'''
    for n in ['ic_launcher.xml', 'ic_launcher_round.xml']:
        (RES / 'mipmap-anydpi-v26' / n).write_text(xml, encoding='utf-8')


def b64(im):
    buf = io.BytesIO(); im.save(buf, 'PNG'); return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


FONT = "'NSN','Noto Sans CJK KR','Malgun Gothic',sans-serif"
TITLE = "'OnePop','NSN','Noto Sans CJK KR',sans-serif"
# 게임과 같은 글꼴(제목 = 원스토어 모바일 POP체 — 로고 사용 허용, 보조 = 나눔스퀘어 네오)
def _face(name, file, weight='400'):
    f = ROOT / 'web' / 'fonts' / file
    kind = 'woff2' if f.suffix == '.woff2' else 'woff'
    return f"@font-face{{font-family:'{name}';font-weight:{weight};src:url(data:font/{kind};base64,{base64.b64encode(f.read_bytes()).decode()}) format('{kind}')}}"
FACES = '<style>' + _face('OnePop', 'onemobilepop.woff') + _face('NSN', 'nsn-eb.woff2', '800') + _face('NSN', 'nsn-hv.woff2', '900') + '</style>'


async def feature(b, S):
    legend = up(S['ship_legend'], 5)
    ufo = up(S['ufo'], 3); ufo2 = up(S['ufo_pink'], 2)
    html = f"""<html><head>{FACES}</head><body style="margin:0">
<div id="c" style="width:1024px;height:500px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 74% 55%,#2a2056 0%,#15152d 62%);font-family:{FONT}">
  <canvas id="st" width="1024" height="500" style="position:absolute;inset:0"></canvas>
  <img src="{b64(legend)}" style="position:absolute;left:{735 - legend.width // 2}px;top:{262 - legend.height // 2}px;image-rendering:pixelated">
  <img src="{b64(ufo)}" style="position:absolute;left:880px;top:26px;image-rendering:pixelated">
  <img src="{b64(ufo2)}" style="position:absolute;left:470px;top:400px;image-rendering:pixelated;opacity:.9">
  <div style="position:absolute;left:64px;top:88px;color:#c9b5f4;font-size:22px;letter-spacing:4px;font-weight:800">귀여우면 잡혀가는 슈팅 게임</div>
  <div style="position:absolute;left:58px;top:128px;font-family:{TITLE};color:#ffe0f0;font-size:96px;line-height:1.05;text-shadow:0 6px 0 #b0508a">뽀짝<br><span style="color:#d9c8ff;text-shadow:0 6px 0 #5b43ad">우주 대탈출</span></div>
  <div style="position:absolute;left:64px;top:368px;color:#ffe6a0;font-size:28px;font-weight:900">한 손으로 피하고, 먹고, 꾸미자!</div>
</div>
<script>
const c=document.getElementById('st').getContext('2d');let s=7;const r=()=>(s=(s*16807)%2147483647)/2147483647;
for(let i=0;i<90;i++){{const x=Math.round(r()*1024/4)*4,y=Math.round(r()*500/4)*4;c.fillStyle=i%11?'rgba(217,210,248,'+(.3+r()*.5)+')':'#ffe6aa';const z=i%11?4:6;c.fillRect(x,y,z,z);}}
</script></body></html>"""
    pg = await (await b.new_context(viewport={'width': 1024, 'height': 500})).new_page()
    await pg.set_content(html); await pg.wait_for_timeout(400)
    raw = await pg.locator('#c').screenshot()
    Image.open(io.BytesIO(raw)).convert('RGB').save(STORE / 'feature-graphic-1024x500.png')
    await pg.close()


# ── 스크린샷 ──────────────────────────────────────────────────────
PROGRESS_SEED = None


async def shots(b, url):
    raw_dir = STORE / 'screenshots' / 'raw'; raw_dir.mkdir(parents=True, exist_ok=True)
    for f in (STORE / 'screenshots').glob('*.png'):
        f.unlink()
    async def ctx(storage=None):
        c = await b.new_context(viewport={'width': 540, 'height': 960}, device_scale_factor=2, has_touch=True)
        init = 'try{if(!sessionStorage.__seeded){localStorage.clear();' + ''.join(
            f'localStorage.setItem({json.dumps(k)},{json.dumps(v)});' for k, v in (storage or {}).items()) + 'sessionStorage.__seeded=1}}catch(e){}'
        await c.add_init_script(init)
        pg = await c.new_page()
        await pg.goto(url + '?app=1'); await pg.wait_for_timeout(500) # 앱 화면(꽉 찬 레이아웃)
        return pg
    out = {}
    tips_done = json.dumps({'tips': {k: True for k in ['hyper', 'mask', 'ufo', 'weapon', 'boss', 'first', 'item', 'gold', 'near', 'capture', 'loot', 'dent']}})

    # 01 시작 화면
    pg = await ctx({'neon-drift-best': '4820', 'neon-drift-score-version': '2'})
    await pg.wait_for_timeout(600)
    out['01'] = await pg.screenshot(); await pg.context.close()

    # 02 플레이: 꾸민 기체 + 별탄 + UFO
    pg = await ctx()
    await pg.evaluate('__art.go()'); await pg.wait_for_timeout(200)
    await pg.evaluate('()=>{__art.setT(32);__art.ff(60*9);__art.dress(["rabbit","crown","duck"]);__art.weapon(8);__art.ff(90)}')
    await pg.evaluate("()=>{document.getElementById('notice').textContent=''}")
    await pg.wait_for_timeout(350)
    out['02'] = await pg.screenshot(); await pg.context.close()

    # 03 하이퍼 드리프트
    pg = await ctx()
    await pg.evaluate('__art.go()'); await pg.wait_for_timeout(200)
    await pg.evaluate('()=>{__art.setT(40);__art.ff(60*6);__art.dress(["rabbit","chick","fish","cat"]);__art.hyper()}')
    await pg.wait_for_timeout(700)
    out['03'] = await pg.screenshot(); await pg.context.close()

    # 04 모선 보스
    pg = await ctx()
    await pg.evaluate('__art.go()'); await pg.wait_for_timeout(200)
    await pg.evaluate('()=>{__art.ff(60*5);__art.dress(["rabbit","crown","disco"]);__art.boss();__art.weapon(8);__art.ff(40)}')
    await pg.evaluate("()=>{document.getElementById('notice').textContent=''}")
    await pg.wait_for_timeout(400)
    out['04'] = await pg.screenshot(); await pg.context.close()

    # 05 상점
    pg = await ctx()
    await pg.evaluate('()=>{__art.stars(260)}')
    await pg.evaluate('__art.hangar()'); await pg.wait_for_timeout(600)
    out['05'] = await pg.screenshot(); await pg.context.close()

    # 06 결과 화면
    pg = await ctx({'neon-drift-best': '1800', 'neon-drift-score-version': '2'})
    await pg.evaluate('__art.go()'); await pg.wait_for_timeout(200)
    await pg.evaluate('()=>{__art.ff(60*58);__art.dress(["rabbit","duck"]);__art.die()}')
    await pg.wait_for_timeout(2600)
    out['06'] = await pg.screenshot(); await pg.context.close()

    for k, v in out.items():
        Image.open(io.BytesIO(v)).convert('RGB').save(raw_dir / f'{k}.png')
    return raw_dir


CAPTIONS = {
    '01': ('외계인은 귀여운 것부터', '잡아간다'),
    '02': ('한 손 드래그로', '운석 사이를 슝'),
    '03': ('게이지가 차면', '귀여움 폭주!'),
    '04': ('모선을 격파하고', '갇힌 친구 구출'),
    '05': ('★별조각으로', '상점에서 꾸미기'),
    '06': ('결과는 카톡으로', '친구에게 도전장'),
}


async def framed(b, raw_dir):
    pg = await (await b.new_context(viewport={'width': 1080, 'height': 1920})).new_page()
    for k, (a, bb) in CAPTIONS.items():
        shot = Image.open(raw_dir / f'{k}.png')
        html = f"""<html><head>{FACES}</head><body style="margin:0">
<div id="c" style="width:1080px;height:1920px;position:relative;overflow:hidden;background:linear-gradient(180deg,#2a2056 0%,#15152d 40%);font-family:{FONT}">
  <div style="position:absolute;top:96px;width:100%;text-align:center;color:#c9b5f4;font-size:54px;font-weight:800">{a}</div>
  <div style="position:absolute;top:166px;width:100%;text-align:center;font-family:{TITLE};color:#ffe0f0;font-size:104px;text-shadow:0 7px 0 #b0508a">{bb}</div>
  <img src="{b64(shot)}" style="position:absolute;left:150px;top:380px;width:780px;height:1387px;border-radius:44px;box-shadow:0 0 0 10px #3a2f6e,0 30px 60px #000a">
</div></body></html>"""
        await pg.set_content(html); await pg.wait_for_timeout(250)
        img = Image.open(io.BytesIO(await pg.locator('#c').screenshot())).convert('RGB')
        img.save(STORE / 'screenshots' / f'{k}.png')
    await pg.close()


async def main():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    i = html.rindex('})();')
    html = html[:i] + HOOK + html[i:]
    tmp = Path(tempfile.mkdtemp()) / 'art.html'; tmp.write_text(html, encoding='utf-8')
    url = tmp.as_uri()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        S = await sprites(b, url)
        dbg = Path(tempfile.gettempdir()) / 'nd-sprites'; dbg.mkdir(exist_ok=True)
        for k, v in S.items(): up(v, 4).save(dbg / f'{k}.png')
        make_icons(S)
        await feature(b, S)
        raw = await shots(b, url)
        await framed(b, raw)
        await b.close()
    print('완료: store/ 와 android 런처 아이콘을 새로 만들었습니다.')


asyncio.run(main())

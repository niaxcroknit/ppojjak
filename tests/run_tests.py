#!/usr/bin/env python3
"""
뽀짝 우주 대탈출 자동 검사.  수정 후 반드시 실행하세요.

    pip install playwright && python -m playwright install chromium   # 처음 한 번
    python3 tests/run_tests.py

검사 항목
  1. 로드·시작 시 콘솔 에러 없음
  2. 레트로 이동감 보존: 키보드 틱당 정확히 0/±4px, 드래그 틱당 최대 8px
  3. 근접 보너스가 운석 사망 직전에 나오지 않음
  4. 무적 상태 5분 연속 진행 — 에러 없음, 마지막 단계 도달
  5. 장식은 판 단위(게임오버면 날아감), 황금 각인(영구), 기체 색 구매, 예전 장식 값 환불
  6. 인형 포획 흐름(첫 포획은 계속, 두 번째는 종료)
  7. 안드로이드 뒤로가기(neonBack) 동작
  8. 화면 크기와 상관없이 운석 반응 시간이 같음(작은 화면이 더 어렵지 않음)
  9. 아이템·무기 캡슐을 먹는 순간 운석과 충분히 떨어져 있고, 바로 앞 줄 빈칸이 아이템 위치에 맞춰져 있음
 10. 하이퍼 드리프트: 게이지가 차면 자동 발동(템 유지), 무적 질주, 이동감 유지
 11. UFO 격퇴: 별탄 10발에 격퇴, 인형 되찾기, 다음 UFO 체력 +3
 12. 모선: 행성 끝에 등장 → 격퇴 시 친구 구출·다음 행성 / 시간 초과 시 도망
 13. 오늘의 코스: 같은 날이면 운석 줄·아이템 순서가 똑같음 (일반 판은 매번 다름)
 14. 카톡 공유: 결과 메시지·결과 링크·한 줄 다음 목표
 19. 앱: 자랑하기 = 결과 화면 자동 캡처 + 메시지 (Android PixelCopy)
 18. 친구가 결과 링크를 열면 기록 카드 → 도전 → 승부 결과, 조작된 링크 무시
 16. 하이퍼 돌진: 모선 들이받기 −8(0.6초 쿨다운), UFO는 박치기 한 방 격추, 하이퍼 중 위로 올라갈 수 있고 끝나면 원래 높이로
 17. 큰 알림·목표 안내: 하이퍼 충전 시 가운데 큰 알림, 시작 화면 목표 카드, 결과 화면 다음 목표
 20. 별탄 업그레이드: 캡슐마다 LV1→2→3(발사 수·왕별탄), 게임오버면 LV 초기화, 상점 연료통 +3초
 21. 연습 비행: 처음 한 판은 따라 하기 5단계(죽지 않음) → 그대로 본게임, 다시 보기 버튼
 15. 난이도·점수(v0.11): 게이지는 아이템으로도 참, 충돌 판정 22px, 첫 아이템 토끼 귀, 첫 모선 체력 30, 예전 최고 기록 초기화
"""
import asyncio, json, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_single.py')], check=True, stdout=subprocess.DEVNULL)

try:
    from playwright.async_api import async_playwright
except ImportError:
    sys.exit('playwright가 필요합니다: pip install playwright && python -m playwright install chromium')

# ── 테스트용 복사본: 내부 상태를 읽는 훅을 주입 (원본 파일은 건드리지 않음) ──
html = (ROOT / 'index.html').read_text(encoding='utf-8')
HOOK = """
window.__nd = {
  log: [],
  s: () => ({ x: playerX, y: playerY, tick, mode, elapsed, score, stage, doll }),
  ff: (n, inv) => { for (let i = 0; i < n; i++) { if (inv) invincible = 999; update(STEP); tick++; if (!inv && mode === 'over') break; } return { mode, elapsed, stage, score }; },
  idle: (maxTicks) => { for (let i = 0; i < maxTicks && mode !== 'over'; i++) { update(STEP); tick++; } return { mode, elapsed }; },
  collect: (k, r) => collect(k, !!r),
  setElapsed: (v) => { elapsed = v; },
  graze8: () => { for (let i = 0; i < 8; i++) graze(playerX, playerY); },
  stock: (m, l, d) => { masks = m; lives = l; doubleLeft = d; },
  hy: () => ({ masks, lives, doubleLeft, hyperLeft, hyperCharged, doll, refunds: pickups.filter((p) => p.refund).map((p) => p.type), mode }),
  setHyper: (v) => { hyperLeft = v; },
  skyTest: () => { obstacles = []; primaryGone = 5; tripT = 10; beatPlanFor = planetIdx; beatPlan = [7.5]; beatIdx = -1; invincible = 0; hyperLeft = 0; for (let i = 0; i < 3; i++) { obstacles = []; update(STEP); } return !!swirlOrb || flipOn(); },
  pebbleHit: () => { obstacles = []; invincible = 0; lives = 0; hyperLeft = 0; pebbles = [{ x: playerX + 4, y: playerY - 30, r: 8, vy: 200, vx: 0, spin: 0 }]; for (let i = 0; i < 20; i++) { obstacles = []; update(STEP); tick++; } return { mode, dents: dents.length, squish: !!squishText }; },
  pebbleCount: (sec) => { let seen = 0, made = 0; for (let i = 0; i < sec * 60; i++) { invincible = 999; const n = pebbleNo; update(STEP); tick++; if (pebbleNo > n) made++; } return made; },
  rowShapes: (n) => { const out = []; for (let i = 0; i < n; i++) { obstacles = []; row(1); const ys = new Set(obstacles.map((o) => o.y)), xs = obstacles.map((o) => o.x).sort((a, b) => a - b); let maxGap = 0; for (let j = 1; j < xs.length; j++) maxGap = Math.max(maxGap, xs[j] - xs[j - 1] - 34); maxGap = Math.max(maxGap, xs[0], width - xs[xs.length - 1] - 34); let minD = 999; for (let j = 1; j < xs.length; j++) minD = Math.min(minD, xs[j] - xs[j - 1]); out.push({ count: obstacles.length, rowsY: ys.size, maxGap, minD }); } obstacles = []; return out; },
  kill: () => { invincible = 0; hyperLeft = 0; lives = 0; die('rock', playerX, playerY); for (let i = 0; i < 120 && mode !== 'over'; i++) { obstacles = []; update(STEP); tick++; } return mode; },
  setDoll: (v) => { doll = v; },
  setStars: (v) => { stars = v; }, getStars: () => stars,
  trophy: () => ({ ...trophyCount }), coinsLeft: () => coins.length + loot.length, runStars: () => runStars,
  setGauge: (v) => { hyperGauge = v; },
  ffAtBoss: (n) => { for (let i = 0; i < n && boss; i++) { obstacles = []; orbs = []; bullets = []; weaponLeft = 0; weaponDrop = null; pickups = []; pebbles = []; if (boss.claw) boss.claw = null; playerX = targetX = S(boss.x); playerY = targetY = S(boss.y + 20); update(STEP); tick++; } return boss ? boss.hp : 0; },
  ffAtUfo: (n) => { obstacles = []; primaryStun = 0; if (alienPhase === 'recover') alienPhase = 'patrol'; for (let i = 0; i < n; i++) { obstacles = []; playerX = targetX = S(ufoX); playerY = targetY = S(ufoY); update(STEP); tick++; } return primaryHp; },
  ys: () => ({ y: playerY, minY: minY(), hyper: hyperLeft }),
  gauge: () => ({ hyperGauge, hyperCharged, hyperLeft, first: pickups.length ? pickups[0].type : '' }),
  rockAt: (dist) => { obstacles = [{ x: playerX + dist - 17, y: playerY - 17, w: 34, h: 34, speed: 0, spin: 0, vx: 0 }]; invincible = 0; lives = 0; },
  shoot: (n) => { for (let i = 0; i < n; i++) { obstacles = []; bullets.push({ x: ufoX, y: ufoY, life: 1 }); updateCombat(0); } },
  shootBoss: (n) => { for (let i = 0; i < n && boss; i++) { obstacles = []; bullets.push({ x: boss.x, y: boss.y, life: 1 }); updateCombat(0); } },
  skipTrip: () => { tripT = planet().len; },
  ffNoWeapon: (n) => { for (let i = 0; i < n; i++) { invincible = 999; weaponLeft = 0; weaponDrop = null; weaponPending = false; bullets = []; update(STEP); tick++; } },
  bs: () => ({ primaryHp, primaryMax, primaryGone, kills: runStats.kills, doll, boss: !!boss, bossHp: boss ? boss.hp : 0, bossEnter: boss ? boss.enter : 0,
    planetIdx, rescue: !!rescue, friends: { ...friends }, arrested: { ...arrested }, mode, share: shareText }),
  courseSig: (secs) => { const sig = []; for (let i = 0; i < secs * 60 && sig.length < 14; i++) { invincible = 999; confusedLeft = 999; const before = rowNumber; update(STEP); tick++;
      if (rowNumber !== before) sig.push(obstacles.filter((o) => o.y < -30).map((o) => Math.round(o.x)).sort((a, b) => a - b).join(',')); }
    return sig.join('|') + '#' + pickups.map((p) => p.type).join(','); },
  rockHere: () => { obstacles.push({ x: playerX - 17, y: playerY - 17, w: 34, h: 34, speed: 0, spin: 0, vx: 0 }); return obstacles.length; },
  ufoHere: () => { ufoX = playerX; ufoY = playerY; primaryStun = 0; alienPhase = 'patrol'; confusedLeft = 0; masked = 0; },
  rocksNear: () => obstacles.filter((o) => Math.hypot(o.x + 17 - playerX, o.y + 17 - playerY) < 30).length,
  cap: () => capture(),
  react: (t) => { elapsed = t; obstacles = []; pickups = []; confusedLeft = 999; invincible = 999; row(); const o = obstacles[0];
    while (o.y + 17 < 0) { update(STEP); elapsed = t; } let m = 0; while (o.y + 17 < playerY) { update(STEP); elapsed = t; m++; } return m / 60; },
  counts: () => ({ ...counts }), loadout: () => ({ ...runDress }), runFriends: () => ({ ...runFriends }), runTrophy: () => ({ ...runTrophy }),
  clearance: (secs) => { const res = []; for (let i = 0; i < secs * 60; i++) { invincible = 999; confusedLeft = 999; magnetLeft = 0;
    const objs = pickups.map((p) => p); if (weaponDrop) objs.push(weaponDrop);
    for (const o of objs) if (!o.__m && o.y >= playerY - 2) { o.__m = 1;
      let dy = 1e9; for (const r of obstacles) dy = Math.min(dy, Math.abs(r.y + 17 - o.y));
      const above = obstacles.filter((r) => r.y + 17 < o.y); let dx = 1e9;
      if (above.length) { const ry = Math.max(...above.map((r) => r.y)); for (const r of above) if (Math.abs(r.y - ry) < 1) dx = Math.min(dx, Math.abs(r.x + 17 - o.x)); }
      res.push([dy, dx]); }
    update(STEP); tick++;
    for (const p of pickups) if (Math.hypot(playerX - p.x, playerY - p.y) < 35) p.x = -999;
    if (weaponDrop && Math.hypot(weaponDrop.x - playerX, weaponDrop.y - playerY) < 40) weaponDrop.x = -999; }
    return res; },
  arm: () => armWeapon(),
  volley: () => { bullets = []; shotClock = 0; obstacles = []; if (weaponLeft <= 0) return []; updateCombat(0.0001); return bullets.map((b) => b.dmg || 1); },
  wp: () => ({ weaponLv, weaponLeft, perks: { ...perks } }),
  tut: () => (tut ? { step: tut.step, wait: tut.wait, passes: tut.passes } : null),
  tutGap: () => { const xs = [0, ...obstacles.filter((o) => o.tut && o.y < playerY).map((o) => o.x + 17).sort((a, b) => a - b), width]; let bi = 0; for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > xs[bi + 1] - xs[bi]) bi = i - 1; playerX = targetX = S((xs[bi] + xs[bi + 1]) / 2); return xs.length; },
  toPickup: () => { const p = pickups[0] || weaponDrop; if (p) { playerX = targetX = S(p.x); } return !!p; },
  toUfo: () => { playerX = targetX = S(ufoX); return primaryHp; },
  alien: () => ({ alienPhase, primaryGone, masks, ufoY }),
};
  // v0.17
window.__nd.flip = () => startFlip();
window.__nd.fl = () => ({ flipLeft, dir: dirY(), beat: beatState, orb: !!swirlOrb, phase: alienPhase, inv: invincible, y: playerY, revTop: revTop(), revBot: revBot(), minY: minY(), mode, gauge: hyperGauge, wp: weaponPending || !!weaponDrop });
window.__nd.setFlipLeft = (v) => { flipLeft = v; sync(); };
window.__nd.rowNow = () => { obstacles = []; row(1); return obstacles.map((o) => [o.y, o.speed]); };
window.__nd.fireNow = () => { bullets = []; weaponLeft = 5; weaponLv = Math.max(1, weaponLv); shotClock = 0; updateCombat(0.0001); return bullets.map((b) => b.dy || 1); };
window.__nd.beats = () => { planBeats(); return { plan: beatPlan.slice(), len: planet().len }; };
window.__nd.atBeat = (t) => { tripT = t; updateBeats(); return beatState; };
window.__nd.ffSafe = (n) => { for (let i = 0; i < n; i++) { obstacles = []; orbs = []; update(STEP); tick++; if (mode !== 'playing') break; } return { mode, flipLeft, inv: invincible }; };
window.__nd.orbAt = () => { swirlOrb = { x: playerX, y: playerY - 70, vx: 0, vy: 260, t: 0 }; invincible = 0; };
window.__nd.shootOrb = () => { swirlOrb = { x: playerX, y: playerY - 120, vx: 0, vy: 0, t: 0 }; bullets = [{ x: playerX, y: playerY - 112, vx: 0, life: 1, dy: 1 }]; updateCombat(0.0001); return !!swirlOrb; };
window.__nd.swirlSetup = () => { const b = beatPlan.at(0); tripT = b + 0.5; updateBeats(); primaryGone = 0; primaryStun = 0; alienPhase = 'patrol'; confusedLeft = 0; masked = 0; swirlOrb = null; return { b, beat: beatState, armed: swirlArmed }; };
window.__nd.points = (v) => { points = v; score = v; };
if (!/[?&]tut=1/.test(location.search)) tips.tutorial = true; // 다른 검사는 연습 비행 없이
"""
def inject(src, needle, extra):
    assert needle in src, '훅 위치를 찾지 못했습니다: ' + needle
    return src.replace(needle, needle + extra, 1)
i = html.rindex('})();')
html = html[:i] + HOOK + html[i:]
html = inject(html, 'function graze(x, y) {', "window.__nd&&__nd.log.push(['g',elapsed]);")
html = inject(html, 'function die(reason, x, y, why) {', "window.__nd&&__nd.log.push(['die',elapsed]);")
tmp = Path(tempfile.mkdtemp()) / 'test.html'
tmp.write_text(html, encoding='utf-8')
URL = tmp.as_uri()

results = []
def check(name, ok, detail=''):
    results.append(ok)
    print(('  PASS ' if ok else '  FAIL ') + name + (' — ' + detail if detail else ''))

async def page(browser, storage=None, **kw):
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, **kw)
    if storage is not None:
        await ctx.add_init_script('localStorage.clear();' + ''.join(
            f'localStorage.setItem({json.dumps(k)},{json.dumps(v)});' for k, v in storage.items()))
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    await pg.goto(URL)
    await pg.wait_for_timeout(300)
    return pg, errs

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        print('1. 로드')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(2500)
        check('콘솔 에러 없음', not errs, '; '.join(errs[:3]))

        print('2. 이동감')
        await pg.evaluate("()=>{window.__tr=[];const f=()=>{__tr.push(__nd.s());requestAnimationFrame(f)};f()}")
        await pg.keyboard.down('ArrowLeft'); await pg.keyboard.down('ArrowUp'); await pg.wait_for_timeout(350)
        await pg.keyboard.up('ArrowLeft'); await pg.keyboard.up('ArrowUp')
        await pg.keyboard.down('KeyD'); await pg.wait_for_timeout(250); await pg.keyboard.up('KeyD')
        key_tr = await pg.evaluate('__tr')
        await pg.evaluate('__tr=[]')
        await pg.mouse.move(195, 700); await pg.mouse.down(); await pg.mouse.move(340, 600, steps=4)
        await pg.wait_for_timeout(400); await pg.mouse.up()
        drag_tr = await pg.evaluate('__tr')
        def deltas(tr):
            out = set()
            for a, c in zip(tr, tr[1:]):
                if c['tick'] - a['tick'] == 1 and a['mode'] == c['mode'] == 'playing':
                    out.add((c['x'] - a['x'], c['y'] - a['y']))
            return out
        kd, dd = deltas(key_tr), deltas(drag_tr)
        check('키보드 틱당 0/±4px', bool(kd) and all(abs(dx) in (0, 4) and abs(dy) in (0, 4) for dx, dy in kd), str(sorted(kd)))
        check('드래그 틱당 최대 8px', bool(dd) and all(abs(dx) <= 8 and abs(dy) <= 8 for dx, dy in dd), str(sorted(dd)))
        await pg.context.close()

        print('3. 근접 보너스 타이밍')
        bad = deaths = 0
        for n in range(8):
            pg, errs = await page(b, {})
            await pg.click('#start')
            await pg.evaluate('__nd.idle(60*150)')
            log = await pg.evaluate('__nd.log')
            for ev in [l for l in log if l[0] == 'die']:
                deaths += 1
                if any(g[0] == 'g' and 0 <= ev[1] - g[1] < 0.3 for g in log): bad += 1
            await pg.context.close()
        check('사망 직전 0.3초 안에 근접 보너스 없음', bad == 0, f'운석 사망 {deaths}회 중 {bad}회')

        print('4. 긴 진행')
        pg, errs = await page(b, {})
        await pg.click('#start')
        r = None
        for _ in range(10): r = await pg.evaluate('__nd.ff(1800,true)')
        check('5분 진행 에러 없음', not errs, '; '.join(errs[:3]))
        check('마지막 단계(ENDLESS DRIFT) 도달', r['stage'] == 3, str(r))
        await pg.context.close()

        print('5. 장식 (판 단위) · 황금 각인 · 기체 색')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(1700)
        await pg.evaluate("__nd.collect('crown')")
        check('먹으면 이번 판 동안 장식이 달림', (await pg.evaluate('__nd.loadout()')).get('crown') is True)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        ng = await pg.text_content('#run-stats')
        check('게임오버: 장식이 날아갔다고 기록에 남김(접힌 곳)', '날아간 것' in ng and '장식' in ng, ng[-60:])
        await pg.click('#start'); await pg.wait_for_timeout(300)
        check('새 판은 장식 없이 시작', (await pg.evaluate('__nd.loadout()')) == {})
        await pg.evaluate('__nd.setElapsed(75)')
        for _ in range(3): await pg.evaluate("__nd.collect('rabbit')")
        await pg.click('#pause'); await pg.click('#hangar-open'); await pg.wait_for_timeout(200)
        check('깊은 궤도에서 3번: 황금 각인(영구 기록)', '황금 각인' in await pg.inner_text('#hangar-parts'))
        await pg.evaluate('__nd.setStars(50)')
        await pg.locator('#hangar-paints button').nth(1).click(); await pg.locator('#hangar-paints button').nth(1).click()
        check('기체 색: ★60 부족하면 안 됨', '더 모으면' in await pg.text_content('#hangar-msg'))
        await pg.evaluate('__nd.setStars(100)')
        await pg.locator('#hangar-paints button').nth(1).click()
        check('한 번 누르면 확인 단계', '한 번 더' in await pg.text_content('#hangar-msg'))
        await pg.locator('#hangar-paints button').nth(1).click()
        check('두 번 누르면 ★60에 구매', await pg.evaluate('__nd.getStars()') == 40)
        await pg.context.close()
        old = json.dumps({'found': {'crown': True}, 'observed': [], 'trophies': 0, 'loadout': {'crown': True}})
        pg, errs = await page(b, {'neon-drift-progress': old})
        st = await pg.evaluate('__nd.getStars()'); goal = await pg.text_content('#goal')
        check('예전에 열린 장식 값은 ★로 환불 + 안내', st == 30 and '돌려 드렸어요' in goal, str(st))
        await pg.context.close()
        print('6. 포획 흐름')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)')
        s1 = await pg.evaluate('__nd.s()')
        await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        s2 = await pg.evaluate('__nd.s()')
        check('첫 포획: 인형만 잃고 계속', s1['mode'] == 'playing' and s1['doll'] is False, str(s1))
        check('두 번째 포획: 종료', s2['mode'] == 'over', str(s2))
        await pg.click('#over-more')
        check('결과 화면 기록 표시(결과 보기를 누르면)', await pg.is_visible('#run-stats'))
        await pg.context.close()

        print('7. 뒤로가기')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(300)
        a = await pg.evaluate('neonBack()'); bb = await pg.evaluate('neonBack()')
        check('플레이 중 → 일시정지(true), 일시정지 중 → 종료 허용(false)', a is True and bb is False)
        await pg.context.close()

        print('8. 화면 크기별 반응 시간')
        times = {}
        for w, h in [(390, 844), (360, 740), (360, 640)]:
            ctx = await b.new_context(viewport={'width': w, 'height': h})
            pg = await ctx.new_page(); await pg.goto(URL + '?app=1'); await pg.wait_for_timeout(200)
            await pg.click('#start'); await pg.wait_for_timeout(50)
            times[f'{w}x{h}'] = (await pg.evaluate('__nd.react(30)'), await pg.evaluate('__nd.react(90)'))
            await ctx.close()
        ref = times['390x844']
        ok = all(abs(t[0] - ref[0]) / ref[0] < 0.06 and abs(t[1] - ref[1]) / ref[1] < 0.06 for t in times.values())
        check('작은 화면도 반응 시간 차이 6% 이내', ok, ', '.join(f'{k} {v[0]:.2f}s/{v[1]:.2f}s' for k, v in times.items()))

        print('9. 아이템 주변 여유')
        allr = []
        for _ in range(4):
            pg, errs = await page(b, {})
            await pg.click('#start')
            allr += await pg.evaluate('__nd.clearance(150)')
            await pg.context.close()
        dys = [r[0] for r in allr]; dxs = [r[1] for r in allr if r[1] < 1e8]
        check('먹는 순간 운석과 세로 60px 이상', min(dys) >= 60, f'{len(allr)}개, 최소 {min(dys):.0f}px')
        check('바로 앞 줄: 아이템 위치에서 가로 50px 안에 운석 없음', min(dxs) >= 50, f'최소 {min(dxs):.0f}px')

        print('10. 하이퍼 드리프트 (자동 발동)')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(1700)
        await pg.evaluate('__nd.stock(3, 2, 12)')
        await pg.evaluate('__nd.graze8()')
        h = await pg.evaluate('__nd.hy()')
        check('게이지가 차면 자동 발동', h['hyperLeft'] > 3.5 and h['hyperCharged'] is False, str(h))
        check('자동 발동이라 템은 안 잃음', h['masks'] == 3 and h['lives'] == 2 and h['doubleLeft'] > 0, str(h))
        await pg.evaluate('__nd.rockHere()'); await pg.evaluate('__nd.ff(3,false)')
        check('하이퍼 중 운석은 부서지고 계속 진행', (await pg.evaluate('__nd.hy()'))['mode'] == 'playing' and await pg.evaluate('__nd.rocksNear()') == 0)
        await pg.evaluate('__nd.ufoHere()'); await pg.evaluate('__nd.ff(3,false)')
        check('하이퍼 중 UFO에 잡히지 않음', (await pg.evaluate('__nd.hy()'))['mode'] == 'playing')
        await pg.evaluate('__nd.ff(60*4,false)')
        check('4초 뒤 종료', (await pg.evaluate('__nd.hy()'))['hyperLeft'] == 0)
        await pg.evaluate('__nd.setHyper(999)')
        await pg.evaluate("()=>{window.__tr=[];const f=()=>{__tr.push(__nd.s());requestAnimationFrame(f)};f()}")
        await pg.keyboard.down('ArrowRight'); await pg.keyboard.down('ArrowUp'); await pg.wait_for_timeout(300)
        await pg.keyboard.up('ArrowRight'); await pg.keyboard.up('ArrowUp')
        hd = deltas(await pg.evaluate('__tr'))
        check('하이퍼 중에도 이동은 틱당 0/±4px', bool(hd) and all(abs(dx) in (0, 4) and abs(dy) in (0, 4) for dx, dy in hd), str(sorted(hd)))
        check('하이퍼 진행 중 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()
        print('11. UFO 격퇴')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(1700)
        await pg.evaluate('__nd.setDoll(false)')
        await pg.evaluate('__nd.shoot(9)'); a = await pg.evaluate('__nd.bs()')
        check('9발까지는 버팀', a['primaryGone'] == 0 and a['primaryHp'] == 1, str(a['primaryHp']))
        await pg.evaluate('__nd.shoot(1)'); a = await pg.evaluate('__nd.bs()')
        check('10발째 격퇴', a['primaryGone'] > 0 and a['kills'] == 1)
        check('격퇴하면 뺏긴 인형을 되찾음', a['doll'] is True)
        check('다음 UFO 체력 13', a['primaryMax'] == 13)
        await pg.evaluate('__nd.ff(90,true)')
        check('격추하면 별조각 6개가 날아와 들어옴', await pg.evaluate('__nd.runStars()') >= 6 and await pg.evaluate('__nd.coinsLeft()') == 0, str(await pg.evaluate('__nd.runStars()')))
        check('주 UFO 격추 전리품: UFO 안테나', (await pg.evaluate('__nd.trophy()')).get('antenna') == 1)
        await pg.evaluate('__nd.ff(60*9,true)'); a = await pg.evaluate('__nd.bs()')
        check('잠시 뒤 새 UFO 재등장', a['primaryGone'] == 0 and a['primaryHp'] == 13)
        check('격퇴 중 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()

        print('12. 모선')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(1700)
        await pg.evaluate('__nd.skipTrip()'); await pg.evaluate('__nd.ff(2,true)')
        a = await pg.evaluate('__nd.bs()')
        check('행성 끝에서 모선 등장(첫 모선 체력 30)', a['boss'] is True and a['bossHp'] == 30)
        await pg.evaluate('__nd.ff(120,true)')
        check('모선 체력 바 표시', await pg.is_visible('#boss-bar'))
        await pg.evaluate('__nd.shootBoss(30)'); a = await pg.evaluate('__nd.bs()')
        check('별탄 30발에 모선 격퇴 → 구출 캡슐', a['boss'] is False and a['rescue'] is True)
        await pg.evaluate('__nd.ff(60*4,true)'); a = await pg.evaluate('__nd.bs()')
        check('친구 구출 + 다음 행성 + 현상수배 체포', a['friends'].get('f_bunny') is True and a['planetIdx'] == 1 and a['arrested'].get('boss0') is True, str(a['friends']))
        rs = await pg.evaluate('__nd.runStars()')
        check('모선 격추 보상: 별조각 30 + 구출 25 + 행성 5', rs >= 60, str(rs))
        check('모선 격추 전리품: 모선 코어', (await pg.evaluate('__nd.trophy()')).get('core') == 1)
        check('구한 친구는 이번 판에 동행', (await pg.evaluate('__nd.runFriends()')).get('f_bunny') is True)
        await pg.evaluate('__nd.ffNoWeapon(1)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        await pg.click('#start'); await pg.wait_for_timeout(200)
        check('게임오버 뒤 새 판: 친구·전리품 없이 다시 시작(기록은 유지)', await pg.evaluate('__nd.runFriends()') == {} and await pg.evaluate('__nd.runTrophy()') == {} and (await pg.evaluate('__nd.bs()'))['friends'].get('f_bunny') is True)
        check('모선전 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(1700)
        await pg.evaluate('__nd.skipTrip()'); await pg.evaluate('__nd.ffNoWeapon(60*50)'); a = await pg.evaluate('__nd.bs()')
        check('45초 안에 못 잡으면 모선이 도망 → 구출 없이 다음 행성', a['planetIdx'] >= 1 and not a['friends'].get('f_bunny'), str(a['planetIdx']))
        await pg.context.close()

        print('13. 오늘의 코스')
        sigs = []
        for daily in [True, True, False, False]:
            pg, errs = await page(b, {})
            await pg.click('#course-start' if daily else '#start'); await pg.wait_for_timeout(100)
            sigs.append(await pg.evaluate('__nd.courseSig(40)'))
            await pg.context.close()
        check('오늘의 코스: 두 번 해도 운석 줄·아이템 순서 동일', sigs[0] == sigs[1] and len(sigs[0]) > 50)
        check('일반 판: 매번 다른 배치', sigs[2] != sigs[3])

        print('14. 카톡 공유 · 결과 링크')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)')
        await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        a = await pg.evaluate('__nd.bs()')
        msg = a['share']
        check('공유 메시지: 점수·시간·행성·결과 링크(#r1.)', a['mode'] == 'over' and '점' in msg and '버팀' in msg and '네온 성운' in msg and '#r1.' in msg, msg.replace('\n', ' / '))
        ng = await pg.text_content('#next-goal')
        check('결과 화면 다음 목표는 한 줄', ng.count('\n') == 0 and len(ng) < 30, ng)
        await pg.click('#over-more'); await pg.click('#share'); await pg.wait_for_timeout(300)
        check('자랑하기: 채팅 미리보기 + 친구가 볼 카드', await pg.is_visible('#share-panel') and '뽀짝 우주 대탈출' in await pg.text_content('#share-preview') and (await pg.get_attribute('#share-card', 'src') or '').startswith('data:image/png'))
        await pg.click('#share-copy'); await pg.wait_for_timeout(300)
        check('메시지 복사 버튼 동작', '복사' in await pg.text_content('#share-copy'))
        tok = msg.split('#', 1)[1].strip()
        check('공유 중 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()
        print('19. 앱에서 자랑하기 = 결과 화면 캡처 + 메시지')
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.add_init_script("window.NeonAndroid={shareResult:(t)=>{window.__shared=t;},vibrate:()=>{}};")
        pg = await ctx.new_page(); await pg.goto(URL + '?app=1'); await pg.wait_for_timeout(300)
        await pg.click('#start'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)')
        await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        await pg.click('#over-more'); await pg.click('#share'); await pg.wait_for_timeout(200)
        shared = await pg.evaluate('window.__shared || ""')
        check('앱: 버튼 한 번에 캡처 공유 호출(결과 화면 그대로, 미리보기 창 없이)', '#r1.' in shared and not await pg.is_visible('#share-panel'), shared[:40])
        await ctx.close()
        print('18. 친구가 링크를 열면')
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '#' + tok); await pg.wait_for_timeout(600)
        check('친구의 기록 카드가 바로 열림', await pg.is_visible('#challenge') and (await pg.get_attribute('#challenge-card', 'src') or '').startswith('data:image/png'))
        await pg.click('#challenge-go'); await pg.wait_for_timeout(400)
        check('이 기록 깨기 → 친구 점수 목표 안내', '친구 기록' in (await pg.text_content('#notice') or ''), await pg.text_content('#notice'))
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        check('결과: 친구와 승부 결과 한 줄', '친구' in await pg.text_content('#next-goal'), await pg.text_content('#next-goal'))
        await ctx.close()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page()
        await pg.goto(URL + '#' + tok[:-1] + ('0' if tok[-1] != '0' else '1')); await pg.wait_for_timeout(500)
        check('조작된 링크는 무시', not await pg.is_visible('#challenge'))
        await ctx.close()
        check('링크 처리 에러 없음', not errs, '; '.join(errs[:3]))
        print('16. 하이퍼 돌진')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(1700)
        await pg.evaluate('__nd.skipTrip()'); await pg.evaluate('__nd.ff(130,true)')
        await pg.evaluate('__nd.setHyper(4)')
        h1 = await pg.evaluate('__nd.ffAtBoss(1)')
        h2 = await pg.evaluate('__nd.ffAtBoss(20)')
        h3 = await pg.evaluate('__nd.ffAtBoss(30)')
        check('모선 들이받기: 체력 −8', h1 == 22, str(h1))
        check('0.6초 안에는 다시 깎이지 않음', h2 == 22, str(h2))
        check('쿨다운이 지나면 다시 −8', h3 == 14, str(h3))
        check('들이받기 중 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(1700)
        await pg.evaluate('__nd.setHyper(4)')
        hp = await pg.evaluate('__nd.ffAtUfo(1)')
        st = await pg.evaluate('__nd.bs()')
        check('UFO 박치기 한 방 격추 (다음 UFO 체력 13)', st['kills'] == 1 and st['primaryGone'] > 0 and hp == 13, str((hp, st['kills'])))
        await pg.evaluate('__nd.setHyper(999)')
        await pg.keyboard.down('ArrowUp'); await pg.wait_for_timeout(1500); await pg.keyboard.up('ArrowUp')
        y = await pg.evaluate('__nd.ys()')
        check('하이퍼 중엔 평소보다 위로 올라감', y['y'] < y['minY'] - 40, str(y))
        await pg.evaluate('__nd.setHyper(0.02)'); await pg.evaluate('__nd.ff(120,true)')
        y = await pg.evaluate('__nd.ys()')
        check('하이퍼가 끝나면 원래 높이로 돌아옴', y['y'] >= y['minY'] and y['hyper'] == 0, str(y))
        await pg.context.close()

        print('17. 큰 알림 · 목표 안내')
        pg, errs = await page(b, {})
        goal = await pg.text_content('#goal')
        check('시작 화면에 목표 카드(친구 3명 구하기 + 다음 목표)', '친구 3명' in goal and '몽몽' in goal and '토토' in goal, goal)
        await pg.click('#start'); await pg.wait_for_timeout(600)
        sp = await pg.text_content('#splash')
        check('출발할 때 가운데 큰 알림: 누구를 구하러 가는지', await pg.is_visible('#splash') and '구출 작전' in sp and '{' not in sp, sp)
        await pg.wait_for_timeout(2600); await pg.evaluate('__nd.graze8()')
        sp = await pg.text_content('#splash')
        check('하이퍼 발동 시 가운데 큰 알림', await pg.is_visible('#splash') and '폭주' in sp, sp)
        await pg.evaluate('__nd.setHyper(0)')
        lv = await pg.text_content('#level')
        check('하단에 모선까지 남은 시간', '모선까지' in lv and '초' in lv, lv)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)')
        await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        ng = await pg.text_content('#next-goal')
        await pg.click('#over-more')
        check('결과 화면: 모선까지 몇 초 남았는지 다음 목표', await pg.is_visible('#next-goal') and '모선까지' in ng, ng)
        check('알림·목표 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()

        print('15. 난이도·점수')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(100)
        g = await pg.evaluate('__nd.gauge()')
        check('첫 아이템은 토끼 귀', g['first'] == 'rabbit', g['first'])
        await pg.wait_for_timeout(1700)
        await pg.evaluate('__nd.setGauge(0)')
        for k in ['diamond'] * 11: await pg.evaluate(f"__nd.collect('{k}')")
        g = await pg.evaluate('__nd.gauge()')
        check('아이템 11개: 게이지 11/12, 아직 충전 전', g['hyperGauge'] == 11 and not g['hyperCharged'], str(g))
        await pg.evaluate("__nd.collect('diamond')")
        check('12개째 하이퍼 자동 발동', (await pg.evaluate('__nd.gauge()'))['hyperLeft'] > 3)
        await pg.evaluate('__nd.setHyper(0)')
        await pg.evaluate('__nd.rockAt(24)'); await pg.evaluate('__nd.ff(1,false)')
        check('운석 중심이 24px 떨어져 있으면 안 부딪힘(그림 크기 판정)', (await pg.evaluate('__nd.bs()'))['mode'] == 'playing')
        await pg.evaluate('__nd.rockAt(16)'); await pg.evaluate('__nd.ff(60,false)')
        check('16px면 부딪힘', (await pg.evaluate('__nd.bs()'))['mode'] in ('dying', 'over'))
        await pg.context.close()
        pg, errs = await page(b, {'neon-drift-best': '5721'})
        msg = await pg.text_content('#message'); best = await pg.text_content('#best')
        check('예전 점수 기준 기록은 초기화하고 안내', best == '0000' and '새로 시작' in msg, best + ' / ' + msg)
        await pg.context.close()

        print('20. 별탄 업그레이드')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(300)
        await pg.evaluate('__nd.arm()'); v1 = await pg.evaluate('__nd.volley()')
        await pg.evaluate('__nd.arm()'); v2 = await pg.evaluate('__nd.volley()')
        sp = await pg.text_content('#splash')
        await pg.evaluate('__nd.arm()'); v3 = await pg.evaluate('__nd.volley()')
        await pg.evaluate('__nd.arm()'); w = await pg.evaluate('__nd.wp()')
        check('LV1 쌍발 2발', v1 == [1, 1], str(v1))
        check('LV2 4발(쌍발+대각선) + 가운데 큰 알림', len(v2) == 4 and 'LV2' in sp, str(v2) + ' ' + sp)
        check('LV3 5발 + 왕별탄 2배 피해', sorted(v3) == [1, 1, 1, 1, 2], str(v3))
        check('LV3에서 더 먹으면 MAX 유지 · 10초 재충전', w['weaponLv'] == 3 and abs(w['weaponLeft'] - 10) < 0.2, str(w))
        await pg.evaluate('__nd.setHyper(0)'); await pg.evaluate('__nd.ffNoWeapon(1)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        await pg.click('#start'); await pg.wait_for_timeout(200)
        check('게임오버 후 새 판은 LV0부터', (await pg.evaluate('__nd.wp()'))['weaponLv'] == 0)
        await pg.context.close()
        pg, errs = await page(b, {})
        await pg.evaluate('__nd.setStars(200)'); await pg.click('#hangar-open'); await pg.wait_for_timeout(200)
        await pg.click('#hangar-perks button'); await pg.click('#hangar-perks button')
        w = await pg.evaluate('__nd.wp()')
        check('상점: 별탄 연료통 ★150 구매(두 번 눌러 확정)', w['perks'].get('fuel') is True and await pg.evaluate('__nd.getStars()') == 50, str(w))
        await pg.click('#hangar-close'); await pg.click('#start'); await pg.wait_for_timeout(200)
        await pg.evaluate('__nd.arm()'); w = await pg.evaluate('__nd.wp()')
        check('연료통: 별탄 13초', abs(w['weaponLeft'] - 13) < 0.2, str(w))
        check('별탄 업그레이드 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()

        print('21. 연습 비행')
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL + '?tut=1'); await pg.wait_for_timeout(300)
        await pg.click('#start'); await pg.wait_for_timeout(200)
        t = await pg.evaluate('__nd.tut()')
        check('처음 시작하면 연습 비행 1/5 안내', t and t['step'] == 0 and await pg.is_visible('#coach') and '1/5' in await pg.text_content('#coach'), str(t))
        await pg.evaluate('__nd.ff(60*3,false)')
        check('가만히 있으면 다음 단계로 안 넘어감 · 운석 없음', (await pg.evaluate('__nd.tut()'))['step'] == 0 and await pg.evaluate('__nd.rocksNear()') == 0)
        await pg.keyboard.down('ArrowLeft'); await pg.wait_for_timeout(900); await pg.keyboard.up('ArrowLeft')
        await pg.evaluate('__nd.ff(90,false)')
        check('움직이면 2단계(운석 피하기)', (await pg.evaluate('__nd.tut()'))['step'] == 1)
        # 일부러 부딪혀도 죽지 않음
        for _ in range(240):
            await pg.evaluate('__nd.ff(1,false)')
            if await pg.evaluate('__nd.s().mode') != 'playing': break
        check('연습 중엔 운석에 부딪혀도 안 죽음', await pg.evaluate('__nd.s().mode') == 'playing')
        for _ in range(8):  # 실시간 프레임과 섞여 한 줄을 놓칠 수 있어 넉넉히
            for _ in range(160):
                await pg.evaluate('__nd.tutGap()'); await pg.evaluate('__nd.ff(1,false)')
            if (await pg.evaluate('__nd.tut()'))['step'] >= 2: break
        await pg.evaluate('__nd.ff(80,false)')
        check('빈칸으로 두 줄 통과하면 3단계(아이템)', (await pg.evaluate('__nd.tut()'))['step'] == 2, str(await pg.evaluate('__nd.tut()')))
        for _ in range(200):
            await pg.evaluate('__nd.toPickup()'); await pg.evaluate('__nd.ff(1,false)')
            if (await pg.evaluate('__nd.tut()'))['wait'] > 0: break
        await pg.evaluate('__nd.ff(80,false)')
        check('아이템 먹으면 4단계(위장) + 장식 달림', (await pg.evaluate('__nd.tut()'))['step'] == 3 and (await pg.evaluate('__nd.loadout()')).get('rabbit'))
        check('위장 버튼이 반짝이며 안내', 'tut-pulse' in (await pg.get_attribute('#mask', 'class')))
        for _ in range(400):
            await pg.evaluate('__nd.ff(1,false)')
            if (await pg.evaluate('__nd.alien()'))['alienPhase'] == 'aim': break
        await pg.click('#mask', force=True); await pg.evaluate('__nd.ff(80,false)')
        check('돌진 예고에 위장하면 5단계(별탄)', (await pg.evaluate('__nd.tut()'))['step'] == 4)
        for _ in range(300):
            await pg.evaluate('__nd.toPickup()'); await pg.evaluate('__nd.ff(1,false)')
            if (await pg.evaluate('__nd.wp()'))['weaponLeft'] > 0: break
        for _ in range(600):
            await pg.evaluate('__nd.toUfo()'); await pg.evaluate('__nd.ff(1,false)')
            if not await pg.evaluate('__nd.tut()') or (await pg.evaluate('__nd.tut()'))['wait'] > 0: break
        await pg.evaluate('__nd.ff(90,false)')
        st = await pg.evaluate('__nd.s()')
        prog = json.loads(await pg.evaluate("localStorage.getItem('neon-drift-progress')"))
        check('UFO 격추하면 연습 끝 → 그대로 본게임(0초부터)', await pg.evaluate('__nd.tut()') is None and st['mode'] == 'playing' and st['elapsed'] < 2 and prog['tips'].get('tutorial'), str(st))
        check('연습 끝 큰 알림', '진짜 비행' in (await pg.text_content('#splash') or ''), (await pg.text_content('#splash') or '') + ' | ' + (await pg.text_content('#notice') or ''))
        await pg.evaluate('__nd.ff(60*6,true)')
        check('본게임에서는 운석 줄이 내려옴', await pg.evaluate('__nd.s().elapsed') > 5)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        await pg.click('#start'); await pg.wait_for_timeout(200)
        check('두 번째 판부터는 연습 없이 시작', await pg.evaluate('__nd.tut()') is None)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        await pg.click('#over-more'); await pg.click('#tutorial-open'); await pg.wait_for_timeout(200)
        check('시작 화면 "연습 비행"으로 다시 보기', (await pg.evaluate('__nd.tut()') or {}).get('step') == 0)
        await pg.click('#coach-skip'); await pg.wait_for_timeout(100)
        check('건너뛰기 → 바로 본게임', await pg.evaluate('__nd.tut()') is None and not await pg.is_visible('#coach') and await pg.evaluate('__nd.s().mode') == 'playing')
        check('연습 비행 에러 없음', not errs, '; '.join(errs[:3]))
        await ctx.close()
        print('22. 역방향 비행')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(300)
        await pg.evaluate('__nd.ffSafe(60)')
        await pg.evaluate('__nd.flip()')
        f = await pg.evaluate('__nd.fl()')
        check('빙글 구슬 → 10초 역방향 + 전환 안전 시간', abs(f['flipLeft'] - 10) < 0.1 and f['dir'] == -1 and f['inv'] >= 1.4, str(f))
        sp = await pg.text_content('#splash')
        check('뒤집힐 때 가운데 큰 알림(조작은 그대로 안내)', '뒤집혔다' in sp and '조작은 그대로' in sp, sp)
        rows = await pg.evaluate('__nd.rowNow()')
        check('역방향: 운석 줄이 아래에서 위로', rows and all(y > 600 and v < 0 for y, v in rows), str(rows[:2]))
        dys = await pg.evaluate('__nd.fireNow()')
        check('역방향: 별탄은 아래로', dys and all(d == -1 for d in dys), str(dys))
        await pg.evaluate('__nd.ffSafe(80)')
        f = await pg.evaluate('__nd.fl()')
        check('기체가 화면 위쪽 항로로 이동(이동 속도는 그대로)', f['revTop'] <= f['y'] <= f['revBot'] and f['mode'] == 'playing', str(f))
        y0 = (await pg.evaluate('__nd.s()'))['y']
        await pg.keyboard.down('ArrowDown'); await pg.wait_for_timeout(250); await pg.keyboard.up('ArrowDown')
        y1 = (await pg.evaluate('__nd.s()'))['y']
        check('조작 방향은 그대로(아래 키 = 아래로)', y1 > y0, f'{y0}->{y1}')
        fb = await pg.text_content('#flip-banner')
        check('위쪽 안내: 거꾸로 비행 중', await pg.is_visible('#flip-banner') and '거꾸로' in fb, fb)
        await pg.evaluate('__nd.setFlipLeft(4.6)')
        fb = await pg.text_content('#flip-banner')
        check('복귀 5초 전부터 카운트다운(정방향 글자)', '정상 항로 복귀까지 5' in fb and 'warn' in (await pg.get_attribute('#flip-banner', 'class')), fb)
        await pg.evaluate('__nd.setFlipLeft(2.2)')
        check('카운트다운 3', '복귀까지 3' in await pg.text_content('#flip-banner'))
        r = await pg.evaluate('__nd.ffSafe(150)')
        f = await pg.evaluate('__nd.fl()')
        check('복귀: 정방향 + 안전 시간', f['dir'] == 1 and f['flipLeft'] == 0 and f['inv'] > 0 and f['mode'] == 'playing', str(f))
        check('복귀 알림', '정상 항로 복귀' in (await pg.text_content('#splash') or ''))
        await pg.evaluate('__nd.ffSafe(120)')
        f = await pg.evaluate('__nd.fl()')
        check('복귀 후 원래 높이로', f['y'] >= f['minY'], str(f))
        rows = await pg.evaluate('__nd.rowNow()')
        check('복귀 후 운석은 다시 위에서', rows and all(y < 0 and v > 0 for y, v in rows))
        await pg.evaluate('__nd.orbAt()'); await pg.evaluate('__nd.ffSafe(30)')
        check('빙글 구슬에 맞으면 뒤집힘', (await pg.evaluate('__nd.fl()'))['flipLeft'] > 9)
        await pg.evaluate('__nd.setFlipLeft(0.01)'); await pg.evaluate('__nd.ffSafe(100)')
        alive = await pg.evaluate('__nd.shootOrb()')
        check('빙글 구슬은 자동 별탄에 안 터짐(피해야 함)', alive is True)
        check('역방향 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()

        print('23. 몰림→반격 리듬 · 빙글 구슬 예고')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(300)
        bt = await pg.evaluate('__nd.beats()')
        plan, L = bt['plan'], bt['len']
        check('행성마다 몰리는 구간 1~3번, 시작 직후·모선 직전은 비움', 1 <= len(plan) <= 3 and plan[0] >= L * 0.18 - 0.01 and plan[-1] + 10 <= L * 0.92, str((plan, L)))
        check('몰리는 구간', await pg.evaluate(f'__nd.atBeat({plan[0] + 1})') == 'crunch')
        await pg.evaluate('__nd.setGauge(0)')
        check('반격 구간', await pg.evaluate(f'__nd.atBeat({plan[0] + 6.5})') == 'release')
        f = await pg.evaluate('__nd.fl()')
        check('반격 구간: 별탄 캡슐 + 폭주 게이지 +4', f['wp'] and f['gauge'] == 4, str(f))
        await pg.evaluate('__nd.atBeat(1)')
        st = await pg.evaluate('__nd.swirlSetup()')
        seen = {'swirl': False, 'orb': False}
        for _ in range(150):
            f = await pg.evaluate('__nd.ffSafe(1)')
            g = await pg.evaluate('__nd.fl()')
            if g['phase'] == 'swirl': seen['swirl'] = True
            if g['orb']: seen['orb'] = True; break
        check('몰리는 구간에 UFO가 예고(멈칫) 후 빙글 구슬 발사', seen['swirl'] and seen['orb'], str((st, seen)))
        check('리듬 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()

        print('24. 빠른 재시작 · 아까움 한 줄 · 신기록 돌파')
        pg, errs = await page(b, {'neon-drift-best': '60', 'neon-drift-score-version': '2'})
        await pg.click('#start'); await pg.wait_for_timeout(300)
        await pg.evaluate('__nd.points(70)'); await pg.evaluate('__nd.ffSafe(2)')
        check('플레이 중 최고 기록을 넘으면 "최고 기록 돌파!!"', '최고 기록 돌파' in (await pg.text_content('#splash') or ''))
        await pg.evaluate('__nd.kill()')
        cls = await pg.get_attribute('#panel', 'class')
        nl = await pg.text_content('#near-line')
        check('게임오버 → 짧은 결과 띠(아까움 한 줄)', 'quick' in cls and await pg.is_visible('#near-line') and '신기록' in nl, nl)
        check('긴 기록은 접혀 있음(결과 보기 버튼)', not await pg.is_visible('#run-stats') and await pg.is_visible('#over-more'))
        check('다시 버튼: 톡!', '톡' in await pg.text_content('#start'))
        await pg.wait_for_timeout(700)
        await pg.mouse.click(195, 260); await pg.wait_for_timeout(150)
        check('화면 아무 데나 톡 = 바로 다시', (await pg.evaluate('__nd.s()'))['mode'] == 'playing')
        await pg.evaluate('__nd.kill()')
        nl = await pg.text_content('#near-line')
        check('기록 못 깨면 "최고 기록까지 N점!" 또는 더 아까운 한 줄', any(k in nl for k in ['최고 기록까지', '모선까지', '폭주까지', '체력']), nl)
        await pg.mouse.click(195, 260)
        check('게임오버 직후 0.6초 안의 톡은 무시(실수 방지)', (await pg.evaluate('__nd.s()'))['mode'] == 'over')
        await pg.click('#over-more')
        check('결과 보기 → 전체 결과 + 카톡 자랑하기', await pg.is_visible('#run-stats') and await pg.is_visible('#share'))
        check('재시작 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()

        print('25. 하루 랭킹 (자유 비행 · 오늘의 코스)')
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page(); errs = []; sent = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        async def sb(route):
            req = route.request; body = json.loads(req.post_data or '{}'); sent.append((req.url.rsplit('/', 1)[-1], body, req.headers.get('apikey', '')))
            if req.url.endswith('submit_daily'):
                await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'best': body['p_score'], 'rank': 3, 'total': 10, 'gap': 120}))
            else:
                await route.fulfill(status=200, content_type='application/json', body=json.dumps({'day': body['p_day'], 'total': 3, 'me': {'rank': 2, 'score': 50, 'nick': '뽀짝왕', 'gap': 30},
                    'top': [{'rank': 1, 'nick': '고수', 'score': 80, 'secs': 9, 'mine': False}, {'rank': 2, 'nick': '뽀짝왕', 'score': 50, 'secs': 5, 'mine': True}, {'rank': 3, 'nick': '친구', 'score': 20, 'secs': 3, 'mine': False}]}))
        await pg.route('https://rbtodhdjwumkmlnpdmcm.supabase.co/**', sb)
        await pg.goto(URL); await pg.wait_for_timeout(300)
        await pg.click('#course-start'); await pg.wait_for_timeout(300)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)')
        check('처음엔 닉네임 입력 칸', await pg.is_visible('#nick-box') and '닉네임' in await pg.text_content('#rank-line'))
        await pg.fill('#nick-input', '뽀짝왕'); await pg.click('#nick-save'); await pg.wait_for_timeout(300)
        rl = await pg.text_content('#rank-line')
        sub = [x for x in sent if x[0] == 'submit_daily']
        check('닉네임 정하면 오늘 순위에 등록 → "오늘 3위 · 2위까지 120점"', '3위' in rl and '120점' in rl and sub and sub[-1][1]['p_nick'] == '뽀짝왕' and sub[-1][2].startswith('sb_publishable_'), rl)
        check('제출 값: 오늘 날짜 · 기기 ID · 점수 · 시간 · 코스 구분', sub and len(sub[-1][1]['p_device']) >= 8 and sub[-1][1]['p_secs'] >= 1 and len(sub[-1][1]['p_day']) == 10 and sub[-1][1]['p_kind'] == 'course', str(sub[-1][1] if sub else None))
        await pg.wait_for_timeout(700); await pg.click('#start'); await pg.wait_for_timeout(200)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)'); await pg.wait_for_timeout(300)
        check('다음 판부터는 닉네임 안 묻고 바로 등록 · 같은 코스로 다시', not await pg.is_visible('#nick-box') and len([x for x in sent if x[0] == 'submit_daily']) == 2)
        await pg.click('#rank-line'); await pg.wait_for_timeout(300)
        rows = await pg.locator('#board-list li').count()
        me = await pg.text_content('#board-me')
        check('순위 누르면 오늘 순위표(상위 + 내 순위)', await pg.is_visible('#board') and rows == 3 and '2위' in me and '30점' in me, me)
        check('내 줄 강조', 'mine' in (await pg.get_attribute('#board-list li:nth-child(2)', 'class')))
        check('방금 한 오늘의 코스 탭이 열림', 'on' in (await pg.get_attribute('#board-tab-course', 'class') or ''))
        await pg.click('#board-tab-free'); await pg.wait_for_timeout(300)
        bd = [x for x in sent if x[0] == 'daily_board']
        check('자유 비행 탭 → 자유 비행 순위 불러옴', bd and bd[-1][1]['p_kind'] == 'free' and 'on' in (await pg.get_attribute('#board-tab-free', 'class') or ''))
        await pg.click('#board-close')
        await ctx.close()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page(); sent.clear()
        await pg.route('https://rbtodhdjwumkmlnpdmcm.supabase.co/**', sb)
        await pg.goto(URL); await pg.evaluate("localStorage.setItem('neon-drift-nick','뽀짝왕')"); await pg.reload(); await pg.wait_for_timeout(300)
        await pg.click('#start'); await pg.wait_for_timeout(200)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)'); await pg.wait_for_timeout(400)
        sub = [x for x in sent if x[0] == 'submit_daily']
        check('일반 판도 자유 비행 순위에 바로 등록', sub and sub[-1][1]['p_kind'] == 'free' and '자유 비행' in await pg.text_content('#rank-line'), await pg.text_content('#rank-line'))
        await ctx.close()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page()
        await pg.route('https://rbtodhdjwumkmlnpdmcm.supabase.co/**', lambda r: r.abort())
        await pg.goto(URL); await pg.wait_for_timeout(300)
        await pg.evaluate("localStorage.setItem('neon-drift-nick','뽀짝왕')"); await pg.reload(); await pg.wait_for_timeout(300)
        await pg.click('#course-start'); await pg.wait_for_timeout(200)
        await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*4,false)'); await pg.evaluate('__nd.ff(60*4,true)'); await pg.evaluate('__nd.cap()'); await pg.evaluate('__nd.ff(60*5,false)'); await pg.wait_for_timeout(600)
        check('인터넷이 없으면 안내만 하고 게임은 그대로', '인터넷' in await pg.text_content('#rank-line'))
        await ctx.close()
        errs2 = []
        check('랭킹 에러 없음', not errs and not errs2, '; '.join((errs + errs2)[:3]))

        print('26. 깔끔한 운석 줄 · 부스러기 운석 · 하늘 빙글 구슬')
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(300)
        await pg.evaluate('__nd.setElapsed(20)')
        shapes = await pg.evaluate('__nd.rowShapes(40)')
        check('운석 줄은 한 줄로 반듯하게 정렬', all(r['rowsY'] == 1 for r in shapes), str(shapes[:3]))
        check('운석끼리 딱 붙지 않음(중심 간격 42px 이상)', all(r['minD'] >= 42 for r in shapes), str(min(r['minD'] for r in shapes)))
        check('어느 줄이든 기체가 지나갈 빈칸은 항상 있음', all(r['maxGap'] >= 46 for r in shapes), str(min(r['maxGap'] for r in shapes)))
        sky = await pg.evaluate('__nd.skyTest()')
        check('UFO가 없어도 몰림 때 하늘에서 빙글 구슬이 내려옴', sky)
        await pg.context.close()
        pg, errs = await page(b, {})
        await pg.click('#start'); await pg.wait_for_timeout(300)
        await pg.evaluate('__nd.setElapsed(20)')
        made = await pg.evaluate('__nd.pebbleCount(20)')
        check('부스러기 운석이 가끔 떨어짐(20초에 2~7개)', 2 <= made <= 7, str(made))
        hit = await pg.evaluate('__nd.pebbleHit()')
        check('부스러기에 맞아도 안 죽고 기체가 찌그러짐', hit['mode'] == 'playing' and hit['dents'] >= 1 and hit['squish'], str(hit))
        check('운석 줄 에러 없음', not errs, '; '.join(errs[:3]))
        await pg.context.close()
        await b.close()

    print(f'\n{sum(results)}/{len(results)} 통과')
    sys.exit(0 if all(results) else 1)

asyncio.run(main())

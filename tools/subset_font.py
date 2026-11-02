#!/usr/bin/env python3
"""
보조 글꼴(나눔스퀘어 네오 ExtraBold·Heavy, SIL OFL 1.1)을 게임에 쓰는 글자만 남겨 작게 만듭니다.
게임 문구(web/game.js, web/index.html)를 바꿨다면 한 번 실행하세요. 없는 글자는 기본 글꼴로 보여서 깨지지는 않습니다.
(제목 글꼴 원스토어 POP체는 라이선스상 수정 금지라 자르지 않고 원본 그대로 씁니다.)

    pip install fonttools brotli
    python3 tools/subset_font.py
"""
from pathlib import Path
from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
text = ''.join((ROOT / 'web' / f).read_text(encoding='utf-8') for f in ['game.js', 'index.html'])
chars = {c for c in text if '가' <= c <= '힣' or 'ㄱ' <= c <= 'ㆎ'}
chars |= {chr(i) for i in range(0x20, 0x7f)} | set('★☆♥♡…·—–↗✦✶×')
for src, out in [('NanumSquareNeo-dEb.ttf', 'nsn-eb.woff2'), ('NanumSquareNeo-eHv.ttf', 'nsn-hv.woff2')]:
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']; opts.name_IDs = ['*']; opts.notdef_outline = True
    font = subset.load_font(str(ROOT / 'tools' / 'fonts' / src), opts)
    s = subset.Subsetter(opts); s.populate(text=''.join(sorted(chars))); s.subset(font)
    dst = ROOT / 'web' / 'fonts' / out
    subset.save_font(font, str(dst), opts)
    print(f'{len(chars)}자 → {dst.relative_to(ROOT)} {dst.stat().st_size // 1024}KB')

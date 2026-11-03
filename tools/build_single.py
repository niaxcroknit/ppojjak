#!/usr/bin/env python3
"""web/ 원본을 하나로 합쳐 저장소 맨 위 index.html(GitHub Pages 첫 화면 = 게임)을 만듭니다.  사용법: python3 tools/build_single.py"""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
web = root / 'web'
html = (web / 'index.html').read_text(encoding='utf-8')
css = (web / 'style.css').read_text(encoding='utf-8')
js = (web / 'game.js').read_text(encoding='utf-8')
link = '<link rel="stylesheet" href="style.css">'
script = '<script src="game.js"></script>'
assert link in html and script in html, 'index.html의 style.css / game.js 참조를 찾지 못했습니다'
# 글꼴 파일(url('fonts/…'))은 한 파일 버전에서는 data URI로 넣습니다.
import base64, re
def _inline(m):
    f = web / m.group(1)
    mime = 'font/woff2' if f.suffix == '.woff2' else 'font/woff'
    return "url('data:" + mime + ";base64," + base64.b64encode(f.read_bytes()).decode() + "')"
css = re.sub(r"url\('(fonts/[^']+\.woff2?)'\)", _inline, css)
html = html.replace(link, '<style>\n' + css + '</style>').replace(script, '<script>\n' + js.replace('</script', '<\\/script') + '</script>')
out = root / 'index.html'
out.write_text(html, encoding='utf-8')
# 아이콘·매니페스트는 페이지가 상대 경로로 부르므로 index.html 옆(저장소 맨 위)에도 둡니다.
import shutil
shutil.copytree(web / 'icons', root / 'icons', dirs_exist_ok=True)
shutil.copy2(web / 'manifest.webmanifest', root / 'manifest.webmanifest')
print('built', out, len(html), 'bytes')

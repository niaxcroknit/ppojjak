#!/usr/bin/env python3
"""
Android Studio에서 'Open' 한 번이면 되는 독립 프로젝트 zip을 만듭니다 (단단·단디와 같은 방식).

    python3 tools/make_android_zip.py   →  dist/ppojjak-android-studio.zip

- android/ 를 ppojjak/ 폴더로 복사하고, web/ 게임 파일(글꼴 포함)을 app/src/main/assets/ 안에 넣습니다.
- 그래서 폴더를 어디로 옮겨도 화면이 하얗게 나오지 않습니다(원본 저장소는 web/ 하나만 고치면 됨).
"""
import re, shutil, subprocess, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_single.py')], check=True, stdout=subprocess.DEVNULL)
dist = ROOT / 'dist'; work = dist / 'ppojjak'
shutil.rmtree(work, ignore_errors=True); work.parent.mkdir(exist_ok=True)
shutil.copytree(ROOT / 'android', work, ignore=shutil.ignore_patterns('build', '.gradle', 'local.properties', '*.iml', '.idea'))
assets = work / 'app' / 'src' / 'main' / 'assets'
assets.mkdir(parents=True, exist_ok=True)
for f in ['index.html', 'style.css', 'game.js']:
    shutil.copy2(ROOT / 'web' / f, assets / f)
shutil.copytree(ROOT / 'web' / 'fonts', assets / 'fonts')
g = work / 'app' / 'build.gradle'
s = g.read_text(encoding='utf-8')
s2 = re.sub(r"\n\s*// 게임 원본은 저장소 루트의 web/ 폴더 하나뿐입니다.*?\n\s*sourceSets \{ main \{ assets\.srcDirs = \['\.\./\.\./web'\] \} \}\n",
            "\n    // 게임 파일은 app/src/main/assets/ 안에 들어 있어요(index.html · style.css · game.js · fonts/).\n", s, flags=re.S)
assert s2 != s, 'assets.srcDirs 줄을 찾지 못했습니다'
g.write_text(s2, encoding='utf-8')
(work / '먼저-읽어주세요.txt').write_text('''뽀짝 우주 대탈출 — Android Studio 프로젝트

1. 이 zip을 풀면 나오는 ppojjak 폴더를 Android Studio에서 Open 하세요 (New Project 아님).
2. 아래쪽 Gradle Sync가 끝날 때까지 기다리세요 (처음엔 5~10분).
   - "Project update recommended (AGP 업그레이드)" 알림은 닫아도 돼요.
3. 폰을 USB로 연결하고 ▶ 를 누르면 폰에 설치돼요.
4. 스토어용 파일: Build > Generate Signed App Bundle or APK > Android App Bundle
   결과: app/release/app-release.aab

앱 ID: com.ppojjak.spaceescape (이미 Play에 등록됨 — 바꾸지 마세요) · 버전 코드는 올릴 때마다 app/build.gradle에서 1씩 올리기
''', encoding='utf-8')
out = dist / 'ppojjak-android-studio.zip'
out.unlink(missing_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(work.rglob('*')):
        info = zipfile.ZipInfo.from_file(p, p.relative_to(dist))
        if p.is_file():
            if p.name == 'gradlew': info.external_attr = 0o100755 << 16
            z.writestr(info, p.read_bytes(), zipfile.ZIP_DEFLATED)
print('완료:', out.relative_to(ROOT), out.stat().st_size // 1024, 'KB')

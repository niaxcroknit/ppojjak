(() => {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // 1. 레트로 렌더링 · 이동 상수  (사용자 지정 이동감 — 값과 방식을 바꾸지 마세요)
  // ═══════════════════════════════════════════════════════════════
  // 게임 화면을 낮은 해상도(low)에 그린 뒤 도트가 보이도록 확대합니다.
  // 로직은 60Hz 고정 틱으로 돌고, 기체는 틱마다 정수 픽셀만큼만 움직입니다.
  const canvas = document.getElementById('game'), view = canvas.getContext('2d');
  const low = document.createElement('canvas'), ctx = low.getContext('2d');
  const PX = 2; // 도트 1칸의 CSS 픽셀 크기
  const STEP = 1 / 60; // 고정 로직 틱
  const KEY_SPEED = 4; // 키보드: 틱당 4px (초당 240px), 대각선도 축마다 4px (옛 게임 방식)
  const DRAG_SPEED = 8; // 드래그: 손가락 목표를 쫓는 최대 속도, 틱당 8px
  const S = (v) => Math.round(v / PX) * PX; // 도트 격자에 맞추기

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = (v, m) => ((v % m) + m) % m;

  // 앱(WebView)에서는 https://app.local/?app=1 로 열려 화면을 꽉 채웁니다.
  const APP = /[?&]app=1\b/.test(location.search);
  // 움직임 줄이기를 켠 사용자: 화면 섬광·흔들림을 끕니다.
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // 도트 게임이라 3배 해상도는 낭비 — 화면 해상도는 최대 2배로 제한(저사양 폰 프레임 개선)
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const DEBUG = /[?&]debug=1\b/.test(location.search); // 밸런스 확인용 판 기록 패널
  if (APP) document.documentElement.classList.add('app');

  // 오래된 WebView 대비: roundRect가 없으면 직접 구현
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. 데이터
  // ═══════════════════════════════════════════════════════════════
  const KEY_BEST = 'neon-drift-best', KEY_PROGRESS = 'neon-drift-progress', KEY_SOUND = 'neon-drift-sound';
  const KEY_HAPTIC = 'neon-drift-haptic', KEY_DAILY = 'neon-drift-daily', KEY_RUNS = 'neon-drift-runs';
  // 장식 해금: 같은 아이템을 UNLOCK_AT번 먹으면 장식이 열립니다.
  // 황금 장식: GOLD_FROM초(METEOR RUSH) 이후에 먹은 것만 황금 조각이 되고, GOLD_PIECES개면 황금.
  // 실기기 기록(?debug=1)에서 70초 도달이 드물면 GOLD_FROM을 36(DEEP ORBIT)으로 낮추세요.
  const UNLOCK_AT = 3, GOLD_PIECES = 3, GOLD_FROM = 70;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const tastes = [
    { type: 'animal', icon: 'paw', name: '동물 취향' },
    { type: 'shiny', icon: 'sparkle', name: '반짝이 취향' },
    { type: 'odd', icon: 'swirl', name: '독특한 취향' },
  ];
  // 오늘의 미션 — 날짜로 하나가 정해지고, 한 판 안에서 달성하면 완료
  const MISSIONS = [
    { id: 'near10', text: '한 판에 근접 회피 10번', goal: 10, stat: 'near' },
    { id: 'item6', text: '한 판에 아이템 6개 먹기', goal: 6, stat: 'items' },
    { id: 'time45', text: '45초 버티기', goal: 45, stat: 'time' },
    { id: 'ufo3', text: '별탄으로 UFO 3번 맞히기', goal: 3, stat: 'ufoHits' },
    { id: 'time70', text: '70초 버티기 (깊은 궤도)', goal: 70, stat: 'time' },
    { id: 'rock15', text: '별탄으로 운석 15개 부수기', goal: 15, stat: 'rocks' },
    { id: 'mask2', text: '한 판에 가면 2번 쓰기', goal: 2, stat: 'masks' },
    { id: 'combo5', text: '근접 회피 5연속', goal: 5, stat: 'combo' },
    { id: 'hyper1', text: '하이퍼 드리프트 1번 발동', goal: 1, stat: 'hypers' },
    { id: 'kill1', text: '별탄으로 UFO 1대 격퇴', goal: 1, stat: 'kills' },
    { id: 'boss1', text: '모선 1대 격퇴', goal: 1, stat: 'bosses' },
  ];
  // 아이템 효과는 고정입니다. 아이콘은 이모지 대신 drawIcon()의 도트 그림을 씁니다.
  const items = {
    rabbit: { group: 'animal', name: '토끼 귀', effect: '목숨 +1', note: '목숨 +1 · 최대 2개' },
    cat: { group: 'animal', name: '고양이 방울', effect: '자석 8초', note: '8초 동안 가까운 아이템을 끌어와요' },
    chick: { group: 'animal', name: '병아리 모자', effect: '운석 감속 6초', note: '6초 동안 운석 속도 45% 감소' },
    crown: { group: 'shiny', name: '왕관', effect: '점수 ×2 · 12초', note: '12초 동안 생존 점수 2배' },
    diamond: { group: 'shiny', name: '다이아', effect: '즉시 +150점', note: '줍는 즉시 150점 보너스' },
    disco: { group: 'shiny', name: '미러볼', effect: '주변 운석 제거', note: '주변 운석을 없애고 개당 +10점' },
    moustache: { group: 'odd', name: '콧수염 안경', effect: 'UFO 혼란 4초', note: '추격 초기화 + 4초 동안 UFO 혼란' },
    duck: { group: 'odd', name: '고무 오리', effect: '가면 +2', note: '위장용 가면 +2 · 최대 3개' },
    fish: { group: 'odd', name: '물고기 인형', effect: '인형 복구', note: '빼앗긴 인형 복구 · 이미 있다면 +100점' },
    mask: { group: 'supply', name: '위장 가면', effect: '가면 +1', note: '탭해서 쓰는 가면 +1 · 위장 4초' },
  };
  const DRESS_KEYS = Object.keys(items).filter((k) => k !== 'mask');
  const STAGES = [
    { at: 0, name: 'LOW ORBIT' },
    { at: 36, name: 'DEEP ORBIT' },
    { at: 70, name: 'METEOR RUSH' },
    { at: 120, name: 'ENDLESS DRIFT' },
  ];
  const HUD_BAND = 150; // 상단 HUD 가독성 띠의 높이(CSS px)
  // 화면 크기 보정: 운석·아이템·UFO 속도를 '위에서 기체까지의 거리'에 비례시켜
  // 작은 화면에서도 반응 시간이 같게 합니다. 기준은 세로 약 800px 플레이 영역(큰 휴대폰 앱 화면), 그보다 큰 화면은 그대로.
  // 기체 이동(틱당 4/8px)은 보정하지 않습니다 — 레트로 이동감 유지.
  const REF_DIST = 700;
  // ★별조각(v0.13): 목표를 이루면 받는 상금. 꾸미기 상점에서 장식·기체 색·불꽃 색을 삽니다.
  // 수입 — UFO 격추·모선 격추는 별조각이 튀어나와 기체로 빨려 들어옴(STAR_*는 개수, 1개 = 1★).
  const STAR_UFO = 6, STAR_VISITOR = 4, STAR_BOSS = 20, STAR_ARREST = 10, STAR_RESCUE = 25, STAR_RESCUE_AGAIN = 10, STAR_PLANET = 5, STAR_MISSION = 20, STAR_PER_SEC = 1 / 5;
  const PRICE = { animal: 20, shiny: 30, odd: 40 }; // 장식 가격(취향 그룹별)
  // 전리품: 상점에서 못 사고 격추해야만 떨어지는 아이템. 처음 먹으면 전용 장식이 바로 달립니다.
  const TROPHIES = {
    antenna: { name: 'UFO 안테나', from: '주 UFO 격추', effect: '하이퍼 게이지 +4', chance: 1 },
    saucer: { name: '접시 조각', from: '추가 UFO 격추', effect: '별탄 5초', chance: 0.4 },
    core: { name: '모선 코어', from: '모선 격추', effect: '하이퍼 게이지 가득', chance: 1 },
  };
  const TROPHY_KEYS = Object.keys(TROPHIES);
  const PAINTS = {
    basic: { name: '기본 라벤더', price: 0, body: '#f4ecff', wing: '#b1a0ed', dent: '#9b89c5', win: '#8be2dd' },
    mint: { name: '민트 소다', price: 60, body: '#e6fff6', wing: '#6fd4b8', dent: '#56b39a', win: '#a5f8d5' },
    sunset: { name: '노을 복숭아', price: 60, body: '#fff0e0', wing: '#f4a07a', dent: '#d98462', win: '#ffd36b' },
    berry: { name: '블루베리', price: 80, body: '#eee6ff', wing: '#7d6bd6', dent: '#6656b8', win: '#c9b5f4' },
    galaxy: { name: '한밤 은하', price: 120, body: '#3a3160', wing: '#f6d47a', dent: '#d1b25f', win: '#a5f8d5' },
  };
  const FLAMES = {
    basic: { name: '기본 불꽃', price: 0, out: '#ffba8c', core: '#fff4b6' },
    ice: { name: '얼음 불꽃', price: 50, out: '#7fc2ff', core: '#e2f6ff' },
    candy: { name: '사탕 불꽃', price: 50, out: '#ff8fb8', core: '#ffe0f0' },
    leaf: { name: '새싹 불꽃', price: 50, out: '#7fe3a8', core: '#e6fff6' },
  };
  // v0.17.3 순위표 꾸미기(★로 사는 것). 서버에는 짧은 코드(n=..;b=..;f=..)만 보내고, 그릴 때는 이 목록에 있는 것만 씀
  const NICK_COLORS = {
    basic: { name: '기본 하양', price: 0, c: '#f4ebff' }, mint: { name: '민트', price: 40, c: '#a5f8d5' }, peach: { name: '복숭아', price: 40, c: '#ffc69a' },
    pink: { name: '딸기 우유', price: 60, c: '#ff9cc4' }, sky: { name: '하늘', price: 60, c: '#9fd4ff' }, gold: { name: '반짝 금색', price: 120, c: '#ffd76a' },
  };
  const BADGES = {
    none: { name: '없음', price: 0 }, rabbit: { name: '토끼 귀', price: 50 }, duck: { name: '고무 오리', price: 50 }, chick: { name: '병아리', price: 60 },
    rocket: { name: '로켓', price: 70 }, crown: { name: '왕관', price: 100 }, diamond: { name: '다이아', price: 130 },
  };
  const FRAMES = {
    basic: { name: '기본', price: 0, bg: '#2a2548' }, galaxy: { name: '한밤 은하', price: 80, bg: 'linear-gradient(90deg,#2b2266,#3d2a74 55%,#1f3a5c)' },
    sunset: { name: '노을', price: 80, bg: 'linear-gradient(90deg,#4a2a46,#6a3b45 60%,#7a5136)' }, mint: { name: '민트 젤리', price: 80, bg: 'linear-gradient(90deg,#1f4740,#2b5c50)' },
    candy: { name: '사탕 줄무늬', price: 100, bg: 'repeating-linear-gradient(135deg,#4b2a4f 0 10px,#5d3363 10px 20px)' }, gold: { name: '황금 테두리', price: 150, bg: 'linear-gradient(90deg,#4a3a1c,#5e4a22)' },
  };
  const DECO_TABLES = { nickc: NICK_COLORS, badge: BADGES, frame: FRAMES };
  const DECO_DEFAULT = { nickc: 'basic', badge: 'none', frame: 'basic' };
  // 점수표 (v0.11): 버틴 시간(초당 10점)이 점수의 절반쯤 되도록 보너스를 낮췄습니다.
  const PTS = { item: 10, diamond: 60, overflow: 20, fish: 40, discoRock: 3, ufoHit: 1, ufoKill: 60, visitorKill: 40,
    starRock: 3, bossHit: 1, boss: 250, rescueAgain: 100, smash: 5, orb: 1, mission: 100 };
  // 피버 게이지: 근접 회피 +3, 아이템 +1, UFO 격퇴 +2(모선 +4). 끊겨도 줄지 않음. HYPER_GAUGE가 차면 충전.
  const HYPER_GAUGE = 12, GAUGE_NEAR = 3, GAUGE_ITEM = 1, GAUGE_KILL = 2, GAUGE_BOSS = 4;
  // 판정: 운석 충돌 반경(기체 그림 크기에 맞춤). 근접 회피 범위는 46px 그대로라 스치기 보너스가 더 자주 나옵니다.
  const HIT_R = 22;
  // 하이퍼 드리프트(피버): 게이지가 차면 충전 → 버튼으로 발동, HYPER_TIME초 무적 질주.
  // 대가로 가면·목숨·켜진 효과를 모두 떨어뜨리고, 끝날 때 최대 HYPER_REFUND개를 다시 떨어뜨려 만회 기회를 줍니다.
  // 행성 여정: 행성마다 len초를 버티면 모선(보스) 등장. 3개 이후에는 회차가 올라가며 반복(체력 +50%씩).
  const PLANETS = [
    { name: '네온 성운', len: 45, bg: '#15152d', rock: '#b397c1', rockDark: '#8c729f', rockLite: '#ddc8e5', mover: '#97c5ba', pl: '#625386', pl2: '#8371a6',
      boss: { short: '몽몽', subj: '몽몽이', obj: '몽몽을', name: '털뭉치 집착러 몽몽', hp: 30, color: '#f4b3cc', attack: 'claw', hint: '동물 취향 · 긴 집게팔' }, friend: 'f_bunny' },
    { name: '별사탕 행성', len: 50, bg: '#24132c', rock: '#e8a6c8', rockDark: '#c27aa3', rockLite: '#ffe0f0', mover: '#a5f8d5', pl: '#a8577f', pl2: '#d17aa6',
      boss: { short: '쭈쭈', subj: '쭈쭈가', obj: '쭈쭈를', name: '반짝이 수집가 쭈쭈', hp: 55, color: '#f6d47a', attack: 'orbs', hint: '반짝이 취향 · 반짝이 탄' }, friend: 'f_chick' },
    { name: '얼음 행성', len: 55, bg: '#0f1f33', rock: '#9fd3ea', rockDark: '#6aa7c4', rockLite: '#e2f6ff', mover: '#f6d47a', pl: '#3f6f8f', pl2: '#6aa7c4',
      boss: { short: '꾸꾸', subj: '꾸꾸가', obj: '꾸꾸를', name: '이상한 거 좋아하는 꾸꾸', hp: 70, color: '#a5f8d5', attack: 'both', hint: '독특한 취향 · 집게 + 탄' }, friend: 'f_cat' },
  ];
  const FRIENDS = { f_bunny: { name: '토끼 토토', obj: '토토를' }, f_chick: { name: '병아리 삐약이', obj: '삐약이를' }, f_cat: { name: '고양이 냥냥', obj: '냥냥이를' } };
  const FRIEND_KEYS = Object.keys(FRIENDS);
  // UFO 체력: 주 UFO는 처음 10, 격퇴할 때마다 다음 UFO +3. 추가 UFO는 6. 하이퍼로 들이받으면 3.
  const UFO_HP = 10, UFO_HP_STEP = 3, VISITOR_HP = 6, UFO_RESPAWN = 8, BOSS_TIME = 45;
  // 결과 공유 문구에 들어가는 게임 주소 = GitHub Pages(저장소 맨 위 index.html). 친구가 누르면 바로 게임 + 도전 카드가 열려요.
  const SHARE_URL = 'https://niaxcroknit.github.io/ppojjak/';
  // 하이퍼 돌진: 하이퍼 중엔 기체가 HYPER_TOP 높이까지 올라갈 수 있어 모선·UFO를 들이받습니다(이동 속도는 그대로).
  // (v0.16) 작은 UFO는 박치기 한 방에 격추, 모선은 −8 (0.6초에 한 번)
  const RAM_BOSS = 8, RAM_COOLDOWN = 0.6;
  // 별탄(v0.16): 한 판 안에서 캡슐을 먹을 때마다 LV가 오르고(최대 3) 게임오버면 LV1부터.
  // LV1 쌍발 · LV2 쌍발+양옆 대각선 · LV3 + 가운데 왕별탄(2배 피해)
  const WEAPON_TIME = 10, WEAPON_MAX = 3;
  // 영구 업그레이드(★로 사면 계속 남음)
  const PERKS = { fuel: { name: '별탄 연료통', note: '별탄 지속 +3초', price: 150, bonus: 3 } };
  // 게이지가 차면 자동 발동(v0.13). 템을 잃는 대가는 자동 발동에선 꺼 둠 — 켜려면 HYPER_COST = true.
  const HYPER_COST = false;
  const HYPER_TIME = 4, HYPER_MUL = 2.4, HYPER_EASE = 0.5, HYPER_REFUND = 2;
  // ═══ v0.17 손맛 · 재도전 ═══
  // 몰림→반격 리듬: 행성마다 1~3번 '몰리는 구간'(CRUNCH초, 운석 줄이 촘촘) 뒤에 '반격 구간'(RELEASE초, 별탄 캡슐 + 게이지).
  const CRUNCH = 6, RELEASE = 4, CRUNCH_ROW = 0.8, RELEASE_ROW = 1.35, RELEASE_GAUGE = 4;
  // 역방향 비행: 몰리는 구간마다 주 UFO가 '빙글 구슬'을 한 번 쏨(예고 있음). 맞으면 FLIP_TIME초 거꾸로, 마지막 FLIP_WARN초는 복귀 카운트다운.
  // 조작 방향은 그대로, 글자·버튼도 그대로. 전환·복귀 때 운석 정리 + FLIP_SAFE초 무적. (10초는 테스트용 초기값)
  const FLIP_TIME = 10, FLIP_WARN = 5, FLIP_SAFE = 1.5, FLIP_SPIN = 0.36, ORB_SPEED = 210;
  // 하루 랭킹(오늘의 코스) — Supabase. 공개(publishable) 키라 노출돼도 됨: 테이블은 막혀 있고 검증 함수로만 제출·조회.
  const SB_URL = 'https://rbtodhdjwumkmlnpdmcm.supabase.co', SB_KEY = 'sb_publishable_kjtwpZzY9oQBFQV0AkcrFw_x88bLvyG';
  const KEY_NICK = 'neon-drift-nick', KEY_DEVICE = 'neon-drift-device';
  const pace = () => clamp((height - 95) / REF_DIST, 0.55, 1);

  // ═══════════════════════════════════════════════════════════════
  // 3. 상태
  // ═══════════════════════════════════════════════════════════════
  // 화면 · 모드
  let width = 400, height = 700, surfaceReady = false, tick = 0, acc = 0, last = 0, labels = [];
  let mode = 'ready'; // ready | playing | capture | paused | over | book | hangar
  let pausedFrom = 'playing', bookFrom = 'ready', hangarFrom = 'ready', resumeLeft = 0;
  let sound = store.get(KEY_SOUND) === '1', audio = null, best = 0;
  let haptic = store.get(KEY_HAPTIC) !== '0';
  // 다음 판에도 남는 진행 데이터
  let found = {}, observed = [], trophies = 0, loadout = {}, counts = {}, gold = {}, tips = {};
  let friends = {}, reached = 0, arrested = {};
  let trophyCount = {}, trophyOn = {}; // 전리품 '기록'(영구) — 장착은 판 단위 runTrophy
  // v0.14 로그라이트: 판에서 먹은 장식 · 전리품 · 구한 친구는 그 판에만. 게임오버면 날아감.
  let runDress = {}, runTrophy = {}, runFriends = {};
  let refunded14 = false, refundNote = 0;
  let perks = {}; // 영구 업그레이드
  let stars = 0, owned = {}, skins = { paint: { basic: true }, flame: { basic: true }, nickc: { basic: true }, badge: { none: true }, frame: { basic: true } }, shipPaint = 'basic', flame = 'basic', deco = { ...DECO_DEFAULT }; // 별조각 · 산 장식 · 산 색 // 구한 친구 · 도착한 가장 먼 행성 · 체포한 보스
  let daily = { date: '', best: 0, done: false, streak: 0, lastDone: '' };
  // 입력
  const keys = new Set();
  let dragging = false, activePointer = null, previousPointer = 0, previousPointerY = 0;
  let pointerStart = 0, pointerDistance = 0, lastDragEnd = -1e9;
  // 한 판 동안의 상태 — resetRun()에서 모두 초기화
  let playerX = 200, playerY = 565, targetX = 200, targetY = 565;
  let elapsed, score, points, spawn, rowNumber, stage, obstacles, particles, sparkles;
  let pickups, itemClock, itemIndex, itemBag, lastItem;
  let lives, masks, masked, invincible, charm, charmLeft, doubleLeft, magnetLeft, slowLeft, confusedLeft, doll;
  let taste, tasteClock, chase, toastLeft = 0;
  let ufoX = 200, ufoY = 190, alienPhase, alienClock, dashX, dashY, dashVX, dashVY;
  let primaryStun, primarySpin, primaryNear; // primaryNear: { armed, cd }
  let visitors, visitorSpawn, nearCombo, nearClock;
  let dents, impactLeft, impactSide, bolts, pebbles = [], pebbleClock = 0, pebbleNo = 0, dentHeal = 0, squishLeft = 0, squishText = null, weaponLeft, weaponAt, weaponDrop, shotClock, bullets, weaponLv = 0;
  let tut = null; // 연습 비행(튜토리얼) 진행 상태
  let sceneTime = 0, sceneX = 0, sceneY = 0, sceneReturn = 'playing', captureBy = null;
  let dressLost = 0, trophyLost = false, lastDress = [], lastTrophy = [], card = null;
  let dyingLeft = 0, dieReason = '', deathFx = null, runStats, cause = '';
  let midDrop = null, forceGap = null, weaponPending = false; // 줄 사이 아이템 배치
  let hitStop = 0, shake = 0; // 들이받을 때 짧은 정지 · 화면 흔들림
  let flipLeft = 0, flipSpin = 0, swirlOrb = null, swirlArmed = false, revScroll = 0; // 역방향 비행
  let beatPlan = [], beatPlanFor = -1, beatState = 'calm', beatIdx = -1; // 몰림→반격 리듬
  let bestBroken = false, overAt = 0, runBest = 0; // 재도전
  let hyperGauge = 0, hyperCharged = false, hyperLeft = 0, hyperEase = 0, hyperLost = [], spills = [], bgBoost = 0;
  let primaryHp = 10, primaryMax = 10, primaryGone = 0, primaryFlash = 0, escapes = [];
  let planetIdx = 0, tripT = 0, boss = null, orbs = [], rescue = null, bossSupply = 0, trail = [];
  let loot = [], runStars = 0, coins = [], confetti = [], booms = [], celebrate = 0, flashT = 0;
  let course = false, courseSeed = 0, bagNo = 0; // 오늘의 코스(모두 같은 운석 배치)
  // 게임 진행에 영향을 주는 난수. 오늘의 코스에서는 (날짜, 줄 번호, 용도)로만 정해져서
  // 누가 하든 같은 순서의 운석 줄·아이템이 나옵니다. 그 외(이펙트 등)는 Math.random 그대로.
  function rnd(a, b) {
    if (!course) return Math.random();
    let h = (courseSeed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function seedOf(text) { let h = 2166136261; for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  function resetRun() {
    runStars = 0;
    runStats = { near: 0, combo: 0, items: 0, finds: 0, unlocks: 0, ufoHits: 0, rocks: 0, masks: 0, hypers: 0, smashed: 0, kills: 0, bosses: 0, rescued: 0 };
    captureBy = null; dyingLeft = 0; deathFx = null; cause = '';
    midDrop = null; forceGap = null; weaponPending = false;
    loot = []; coins = []; confetti = []; booms = [];
    runDress = {}; runTrophy = {}; runFriends = {}; lastDress = []; lastTrophy = []; card = null; celebrate = 0; flashT = 0;
    hyperGauge = 0; hyperCharged = false; hyperLeft = 0; hyperEase = 0; hyperLost = []; spills = [];
    primaryHp = primaryMax = UFO_HP; primaryGone = 0; primaryFlash = 0; escapes = [];
    planetIdx = 0; tripT = 0; boss = null; orbs = []; rescue = null; bossSupply = 0; trail = [];
    elapsed = score = points = spawn = rowNumber = stage = 0;
    obstacles = []; particles = []; sparkles = [];
    pickups = []; itemClock = itemIndex = 0; itemBag = []; lastItem = ''; bagNo = 0;
    lives = 0; masks = 1; masked = invincible = charmLeft = doubleLeft = magnetLeft = slowLeft = confusedLeft = 0;
    charm = ''; doll = true;
    taste = tasteClock = chase = 0;
    ufoX = width / 2; ufoY = 180; alienPhase = 'patrol'; alienClock = 0;
    dashX = dashY = dashVX = dashVY = 0;
    primaryStun = primarySpin = 0; primaryNear = { armed: false, cd: 0 };
    visitors = []; visitorSpawn = 25; nearCombo = nearClock = 0; // 추가 UFO: 25초, 50초
    dents = []; impactLeft = 0; impactSide = 1; bolts = []; pebbles = []; pebbleClock = 6; pebbleNo = 0; dentHeal = 0; squishLeft = 0; squishText = null;
    weaponLeft = 0; weaponAt = 20; weaponDrop = null; shotClock = 0; bullets = []; weaponLv = 0;
    resumeLeft = 0; tut = null;
    flipLeft = 0; flipSpin = 0; swirlOrb = null; swirlArmed = false; beatPlan = []; beatPlanFor = -1; beatState = 'calm'; beatIdx = -1; bestBroken = false; runBest = best;
  }
  resetRun();

  // ═══════════════════════════════════════════════════════════════
  // 4. 저장 · 도감 기록
  // ═══════════════════════════════════════════════════════════════
  best = Number(store.get(KEY_BEST)) || 0;
  // v0.11에서 점수 기준이 바뀌었습니다. 예전 기록은 새 기준으로 깰 수 없으니 최고 기록을 새로 시작합니다.
  const SCORE_VERSION = '2', KEY_SCORE_VER = 'neon-drift-score-version';
  let scoreReset = false;
  if (store.get(KEY_SCORE_VER) !== SCORE_VERSION) {
    scoreReset = best > 0; best = 0; store.set(KEY_BEST, '0'); store.set(KEY_SCORE_VER, SCORE_VERSION);
    try { const d = JSON.parse(store.get(KEY_DAILY) || '{}'); if (d && typeof d === 'object') { d.courseBest = 0; store.set(KEY_DAILY, JSON.stringify(d)); } } catch {}
  }

  function applyProgress(data) {
    if (!data || typeof data !== 'object') return;
    for (const k of Object.keys(items)) if (data.found?.[k]) found[k] = true;
    if (Array.isArray(data.observed))
      observed = [
        ...new Set([...observed, ...data.observed.filter((k) => typeof k === 'string' && /^[a-z]+:[012]$/.test(k))]),
      ];
    trophies = Math.max(trophies, Math.min(99, Number(data.trophies) || 0));
    if (data.counts && typeof data.counts === 'object') {
      for (const k of Object.keys(items)) counts[k] = Math.max(counts[k] || 0, Math.min(9999, Math.floor(Number(data.counts[k]) || 0)));
    } else {
      // v0.7 이하 저장: 이미 발견한 장식은 해금 상태로 이어 줍니다.
      for (const k of DRESS_KEYS) if (found[k]) counts[k] = Math.max(counts[k] || 0, UNLOCK_AT);
    }
    if (data.gold && typeof data.gold === 'object')
      for (const k of DRESS_KEYS) gold[k] = Math.max(gold[k] || 0, Math.min(99, Math.floor(Number(data.gold[k]) || 0)));
    if (data.friends && typeof data.friends === 'object') for (const k of FRIEND_KEYS) if (data.friends[k] === true) friends[k] = true;
    if (data.arrested && typeof data.arrested === 'object') for (const k of Object.keys(data.arrested)) if (/^boss\d$/.test(k) && data.arrested[k] === true) arrested[k] = true;
    reached = Math.max(reached, Math.min(99, Math.floor(Number(data.reached) || 0)));
    if (data.tips && typeof data.tips === 'object') for (const k of Object.keys(data.tips)) if (data.tips[k] === true) tips[k] = true;
    stars = Math.max(stars, Math.min(999999, Math.floor(Number(data.stars) || 0)));
    if (data.trophyCount && typeof data.trophyCount === 'object') for (const k of TROPHY_KEYS) trophyCount[k] = Math.max(0, Math.min(9999, Math.floor(Number(data.trophyCount[k]) || 0)));
    if (data.trophyOn && typeof data.trophyOn === 'object') for (const k of TROPHY_KEYS) if (typeof data.trophyOn[k] === 'boolean') trophyOn[k] = data.trophyOn[k];
    if (data.owned && typeof data.owned === 'object') { for (const k of DRESS_KEYS) if (data.owned[k] === true) owned[k] = true; }
    else for (const k of DRESS_KEYS) if ((counts[k] || 0) >= UNLOCK_AT) owned[k] = true; // v0.12 이하: 이미 열린 장식은 산 것으로
    if (data.skins && typeof data.skins === 'object')
      for (const kind of ['paint', 'flame']) for (const k of Object.keys(kind === 'paint' ? PAINTS : FLAMES)) if (data.skins[kind] && data.skins[kind][k] === true) skins[kind][k] = true;
    if (data.skins && typeof data.skins === 'object')
      for (const kind of Object.keys(DECO_TABLES)) for (const k of Object.keys(DECO_TABLES[kind])) if (data.skins[kind] && data.skins[kind][k] === true) skins[kind][k] = true;
    if (data.deco && typeof data.deco === 'object') for (const kind of Object.keys(DECO_TABLES)) if (DECO_TABLES[kind][data.deco[kind]] && skins[kind][data.deco[kind]]) deco[kind] = data.deco[kind];
    if (data.perks && typeof data.perks === 'object') for (const k of Object.keys(PERKS)) if (data.perks[k] === true) perks[k] = true;
    if (PAINTS[data.paint] && skins.paint[data.paint]) shipPaint = data.paint;
    if (FLAMES[data.flame] && skins.flame[data.flame]) flame = data.flame;
    // v0.14: 장식은 판 단위가 됐으므로, 예전에 열거나 산 장식 값은 ★로 한 번 돌려 드립니다.
    if (!data.refunded14) {
      let back = 0;
      for (const k of DRESS_KEYS) if (owned[k]) back += PRICE[items[k].group];
      if (back) { stars += back; refundNote = back; }
    }
    refunded14 = true;
    if (data.loadout && typeof data.loadout === 'object')
      for (const k of DRESS_KEYS) if (unlocked(k) && typeof data.loadout[k] === 'boolean') loadout[k] = data.loadout[k];
    for (const k of DRESS_KEYS) if (unlocked(k) && !(k in loadout)) loadout[k] = true;
  }
  function saveProgress() {
    store.set(KEY_PROGRESS, JSON.stringify({ found, observed, trophies, loadout, counts, gold, tips, friends, reached, arrested, stars, owned, skins, paint: shipPaint, flame, deco, perks, trophyCount, trophyOn, refunded14 }));
  }
  const unlocked = (k) => !!owned[k]; // v0.13: 장식은 발견 후 ★별조각으로 구매
  // 황금 각인(영구): 깊은 궤도에서 3번 먹은 장식은, 다음 판부터 먹을 때마다 금빛으로 달려요.
  const golden = (k) => (gold[k] || 0) >= GOLD_PIECES;
  try {
    const raw = store.get(KEY_PROGRESS);
    if (raw) applyProgress(JSON.parse(raw));
  } catch {}

  // ── 오늘의 미션 ──
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function todayMission() {
    const k = dayKey();
    let h = 0;
    for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return MISSIONS[h % MISSIONS.length];
  }
  function loadDaily() {
    try { const d = JSON.parse(store.get(KEY_DAILY) || '{}'); if (d && typeof d === 'object') daily = { ...daily, ...d }; } catch {}
    if (daily.date !== dayKey()) { daily.date = dayKey(); daily.best = 0; daily.done = false; daily.courseBest = 0; }
  }
  function saveDaily() { store.set(KEY_DAILY, JSON.stringify(daily)); }
  function missionValue(m) { return m.stat === 'time' ? Math.floor(elapsed) : runStats[m.stat] || 0; }
  function checkDaily() {
    if (daily.done || mode !== 'playing' || tut) return;
    if (daily.date !== dayKey()) loadDaily();
    const m = todayMission(), v = missionValue(m);
    if (v > daily.best) daily.best = Math.min(v, m.goal);
    if (v < m.goal) return;
    const y = new Date(); y.setDate(y.getDate() - 1);
    daily.streak = daily.lastDone === dayKey(y) ? daily.streak + 1 : 1;
    daily.lastDone = dayKey(); daily.done = true; saveDaily();
    // 보상: 아직 잠긴 발견 장식 중 가장 덜 모은 것에 일반 조각 +1 (황금 조각은 실력으로만)
    giveStars(STAR_MISSION); saveProgress();
    const reward = ' · ★+' + STAR_MISSION;
    toast('☆ 오늘의 미션 완료!' + reward, 4); burst(playerX, playerY, '#fff1aa'); tone(980, 0.2); buzz(40);
  }
  function renderDaily() {
    const m = todayMission();
    const state = daily.done ? '<b>완료 ✓</b>' : '최고 ' + Math.min(daily.best, m.goal) + '/' + m.goal;
    const streak = daily.streak > 0 && (daily.lastDone === dayKey() || daily.lastDone === dayKey(new Date(Date.now() - 864e5)))
      ? ' · 연속 ' + daily.streak + '일' : '';
    $('daily').innerHTML = '<small>오늘의 미션</small><span></span><em>' + state + streak + '</em>';
    $('daily').children[1].textContent = m.text;
    $('course-best').textContent = daily.courseBest ? '오늘 최고 ' + Number(daily.courseBest).toLocaleString('ko-KR') + '점' : '모두 같은 배치';
  }
  // 장식 조각 추가 (아이템 획득 · 미션 보상 공통)
  // deep = 깊은 궤도(GOLD_FROM초 이후)에서 먹었는지 → 황금 조각도 함께 +1
  function giveStars(n) { if (n > 0) { stars += n; runStars += n; } }
  // 별조각이 사방으로 튀었다가 기체로 쏙 빨려 들어옵니다(1개 = 1★).
  function spawnCoins(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 160;
      coins.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, t: -i * 0.03 });
    }
  }
  function dropLoot(k, x, y) {
    if (Math.random() > TROPHIES[k].chance) return;
    loot.push({ k, x, y, t: 0 });
  }
  function collectTrophy(k) {
    const T = TROPHIES[k], first = !trophyCount[k];
    trophyCount[k] = (trophyCount[k] || 0) + 1;
    runTrophy[k] = (runTrophy[k] || 0) + 1;
    if (k === 'antenna') addGauge(4);
    if (k === 'saucer') { weaponLeft = Math.max(weaponLeft, 5); weaponLv = Math.max(1, weaponLv); shotClock = 0; }
    if (k === 'core') addGauge(HYPER_GAUGE);
    saveProgress();
    if (runTrophy[k] === 1) splash('전리품 획득!!', '{' + k + '} ' + T.name + ' 장착 · 이번 판 동안', 'win', 2);
    else toast('{' + k + '} ' + T.name + ' · ' + T.effect);
    burst(playerX, playerY, '#fff1aa'); tone(1175, 0.12); buzz(30);
  }
  function updateRewards(dt) {
    for (const c of coins) {
      c.t += dt;
      if (c.t < 0) continue;
      if (c.t < 0.35) { c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 0.94; c.vy = c.vy * 0.94 + 200 * dt; continue; }
      const dx = playerX - c.x, dy = playerY - c.y, d = Math.hypot(dx, dy) || 1, sp = 260 + 900 * (c.t - 0.35);
      c.x += (dx / d) * Math.min(d, sp * dt); c.y += (dy / d) * Math.min(d, sp * dt);
      if (d < 22) { c.done = true; giveStars(1); tone(1400 + Math.min(12, runStars % 13) * 40, 0.03); }
    }
    coins = coins.filter((c) => !c.done);
    for (const l of loot) {
      l.t += dt;
      if (l.t < 0.5) { l.y -= 30 * dt; continue; }
      l.x += (playerX - l.x) * (1 - Math.exp(-3 * dt)); l.y += (playerY - l.y) * (1 - Math.exp(-3 * dt));
      if (Math.hypot(playerX - l.x, playerY - l.y) < 26) { l.done = true; collectTrophy(l.k); }
    }
    loot = loot.filter((l) => !l.done);
    for (const b of booms) { b.at -= dt; if (b.at <= 0) { b.done = true; ufoBoom(b.x, b.y, b.c); shake = Math.max(shake, 0.2); } }
    booms = booms.filter((b) => !b.done);
    for (const f of confetti) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 240 * dt; f.vx *= 0.99; f.spin += dt * 10; f.life -= dt; }
    confetti = confetti.filter((f) => f.life > 0 && f.y < height + 20);
    flashT = Math.max(0, flashT - dt);
  }
  // 대왕 우주선 격추 축하: 슬로모션 · 연쇄 폭발 · 섬광 · 폭죽 · 별조각 비 · 징글 · 진동
  function celebrateBoss(b) {
    celebrate = 1.1; flashT = 0.18; shake = 0.7; hitStop = 0.12;
    const col = b.P.boss.color;
    for (let i = 0; i < 8; i++) booms.push({ at: 0.05 + i * 0.13, x: b.x + (Math.random() - 0.5) * 150, y: b.y + (Math.random() - 0.5) * 50, c: i % 2 ? col : '#fff1aa' });
    const cols = ['#ffb6d3', '#a5f8d5', '#f6d47a', '#c9b5f4', '#9fe7f3', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, sp = 180 + Math.random() * 360;
      confetti.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: cols[i % cols.length], spin: Math.random() * 6, life: 2.4 + Math.random() });
    }
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.16), i * 90));
    [0, 160, 320].forEach((t) => setTimeout(() => buzz(60), t)); setTimeout(() => buzz(160), 520);
  }
  function addPiece(k, deep) {
    const wasGold = golden(k);
    counts[k] = (counts[k] || 0) + 1;
    if (k === 'mask') return '';
    if (deep) gold[k] = (gold[k] || 0) + 1;
    let result = '';
    if (!wasGold && golden(k)) result = 'gold';
    saveProgress();
    if (result) buzz(40);
    return result;
  }

  // ── 판 기록 (밸런스 확인용, 최근 30판) ──
  function logRun() {
    let runs = [];
    try { runs = JSON.parse(store.get(KEY_RUNS) || '[]'); if (!Array.isArray(runs)) runs = []; } catch {}
    runs.push({ d: new Date().toISOString().slice(0, 16), t: Math.round(elapsed * 10) / 10, s: score, c: cause, st: STAGES[stage].name, n: runStats.near, i: runStats.items, p: planetIdx, k: runStats.kills, b: runStats.bosses, co: course });
    store.set(KEY_RUNS, JSON.stringify(runs.slice(-30)));
    if (DEBUG) renderDebug(runs.slice(-30));
  }
  function renderDebug(runs) {
    if (!DEBUG) return;
    if (!runs) { try { runs = JSON.parse(store.get(KEY_RUNS) || '[]'); } catch { runs = []; } }
    const box = $('debug');
    box.hidden = false;
    const avg = (f) => (runs.length ? (runs.reduce((a, r) => a + (r[f] || 0), 0) / runs.length).toFixed(1) : '-');
    const causes = {};
    for (const r of runs) causes[r.c] = (causes[r.c] || 0) + 1;
    box.textContent = '';
    const pre = document.createElement('pre');
    pre.textContent = 'DEBUG · 최근 ' + runs.length + '판  평균 ' + avg('t') + '초 / ' + avg('s') + '점 / 근접 ' + avg('n') + '\n' +
      '사망 원인: ' + Object.entries(causes).map(([k, v]) => k + ' ' + v).join(', ') + '\n' +
      runs.slice(-6).reverse().map((r) => r.d.slice(5) + '  ' + r.t + 's  ' + r.s + '점  ' + r.st + '  ' + r.c).join('\n');
    const copy = document.createElement('button');
    copy.className = 'icon'; copy.textContent = 'JSON 복사';
    copy.onclick = () => { try { navigator.clipboard.writeText(JSON.stringify(runs)); copy.textContent = '복사됨'; } catch {} };
    box.append(pre, copy);
  }

  function recordReaction() {
    if (!interested()) return;
    const k = (masked > 0 ? 'mask' : charm) + ':' + taste;
    if (!observed.includes(k)) { observed.push(k); saveProgress(); }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. 도트 아이콘 (기기마다 다른 이모지 대신 직접 그림)
  // ═══════════════════════════════════════════════════════════════
  // 좌표계: 중심 (0,0), 대략 ±12 범위.
  function drawIcon(c, type) {
    const el = (x, y, rx, ry, color) => { c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); };
    const poly = (pts, color) => { c.fillStyle = color; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); };
    const rect = (x, y, w, h, color) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
    switch (type) {
      case 'rabbit':
        el(-4, -5, 3, 7.5, '#fff0f5'); el(4, -5, 3, 7.5, '#fff0f5');
        el(-4, -5, 1.3, 5, '#f4b3cc'); el(4, -5, 1.3, 5, '#f4b3cc');
        el(0, 5, 9, 6.5, '#fff0f5');
        el(-3, 4, 1.2, 1.5, '#49374c'); el(3, 4, 1.2, 1.5, '#49374c'); el(0, 7, 1.5, 1, '#f19ab5');
        break;
      case 'cat':
        el(-5, -8, 3.2, 2, '#f19ab5'); el(5, -8, 3.2, 2, '#f19ab5'); el(0, -8, 1.8, 1.8, '#e77fa5');
        el(0, 2, 9, 9, '#f4d48d'); rect(-9, -1, 18, 2.4, '#c99a4e'); el(-3.5, -3, 2.5, 2, '#fff3c4');
        el(0, 6, 2, 2, '#755c72'); rect(-0.8, 6, 1.6, 4, '#755c72');
        break;
      case 'chick':
        el(0, 3, 9, 8.5, '#f7db8c');
        poly([[-9, 0], [-9, -3], [-6, -8], [-3, -4], [0, -10], [3, -4], [6, -8], [9, -3], [9, 0]], '#fff7ea');
        el(-3, 3, 1.2, 1.3, '#49404c'); el(3, 3, 1.2, 1.3, '#49404c');
        poly([[-2.5, 6], [2.5, 6], [0, 9]], '#efaa78'); el(-6, 6, 1.6, 1, '#f4b3a0'); el(6, 6, 1.6, 1, '#f4b3a0');
        break;
      case 'crown':
        poly([[-10, 7], [-11, -5], [-5, 0], [0, -9], [5, 0], [11, -5], [10, 7]], '#ffdb77');
        rect(-10, 4, 20, 3.5, '#e9b94e'); el(0, 1, 2.2, 2.2, '#fb96b7');
        el(-11, -6, 1.6, 1.6, '#fff3c4'); el(0, -10, 1.6, 1.6, '#fff3c4'); el(11, -6, 1.6, 1.6, '#fff3c4');
        break;
      case 'diamond':
        poly([[-10, -3], [-6, -8], [6, -8], [10, -3], [0, 10]], '#9fe7f3');
        poly([[-6, -8], [0, -3], [6, -8]], '#e2fbff'); poly([[0, -3], [10, -3], [0, 10]], '#6cc8dc');
        rect(-6, -6, 2, 2, '#ffffff');
        break;
      case 'disco':
        rect(-0.8, -12, 1.6, 4, '#c1a6ed');
        c.save(); c.beginPath(); c.ellipse(0, 2, 9, 9, 0, 0, Math.PI * 2); c.clip();
        for (let y = -7; y < 11; y += 3) for (let x = -9; x < 9; x += 3)
          rect(x, y, 3, 3, ((x + y + 32) / 3) % 2 < 1 ? '#cbe8f1' : '#8d87bd');
        c.restore(); rect(-5, -3, 2, 2, '#ffffff'); rect(3, 5, 2, 2, '#ffffff');
        break;
      case 'moustache':
        el(-5, -3, 4.5, 4.5, '#51435c'); el(5, -3, 4.5, 4.5, '#51435c');
        el(-5, -3, 3, 3, '#cbe8f1'); el(5, -3, 3, 3, '#cbe8f1'); rect(-1, -4, 2, 1.6, '#51435c');
        el(0, 3, 2.5, 2.2, '#f1b9a0'); el(-4.5, 7, 4.8, 2.3, '#51435c'); el(4.5, 7, 4.8, 2.3, '#51435c');
        break;
      case 'duck':
        poly([[-11, 0], [-12, -4], [-7, 0]], '#ffdc8b'); el(-1, 4, 9, 6, '#ffdc8b'); el(4, -4, 5.5, 5.5, '#ffdc8b');
        el(9.5, -2.5, 3.2, 1.7, '#ef9d79'); el(5, -5, 1.1, 1.1, '#4d3d52'); el(-3, 4, 4.5, 2.6, '#f3c665');
        break;
      case 'fish':
        poly([[5, 0], [12, -7], [12, 7]], '#a6dbed'); el(-2, 0, 9, 6, '#a6dbed'); el(0, -5.5, 3.5, 1.6, '#7fc2db');
        rect(2, -4, 1.6, 8, '#7fc2db'); el(-6, -1, 1.3, 1.3, '#37415e'); el(-9, 2, 1.2, 0.8, '#f19ab5');
        break;
      case 'mask':
        rect(-12, -3, 3, 1.6, '#423c51'); rect(9, -3, 3, 1.6, '#423c51');
        c.fillStyle = '#e3bc96'; c.beginPath(); c.roundRect(-9, -9, 18, 18, 5); c.fill();
        el(-4, -2, 2.8, 1.8, '#423c51'); el(4, -2, 2.8, 1.8, '#423c51'); el(0, 3, 3.5, 2, '#a57764');
        rect(-4, 6, 8, 1.4, '#423c51');
        break;
      case 'paw':
        el(0, 5, 6.5, 5.5, '#ffd6e5'); el(-6.5, -2, 2.6, 3.2, '#ffd6e5'); el(-2.3, -7, 2.6, 3.2, '#ffd6e5');
        el(2.3, -7, 2.6, 3.2, '#ffd6e5'); el(6.5, -2, 2.6, 3.2, '#ffd6e5'); el(0, 6, 3, 2, '#f4b3cc');
        break;
      case 'sparkle': {
        const st = (x, y, r, col) => poly([[x, y - r], [x + r * 0.28, y - r * 0.28], [x + r, y], [x + r * 0.28, y + r * 0.28],
          [x, y + r], [x - r * 0.28, y + r * 0.28], [x - r, y], [x - r * 0.28, y - r * 0.28]], col);
        st(-2, 2, 9.5, '#ffe6a0'); st(7, -7, 4.5, '#fff6d6'); st(-2, 2, 3, '#fff6d6');
        break;
      }
      case 'swirl':
        c.strokeStyle = '#c9b5f4'; c.lineWidth = 2.6; c.beginPath();
        for (let a = 0; a <= Math.PI * 4.2; a += 0.2) { const r = 1 + a * 0.75; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        c.stroke();
        break;
      case 'rocket':
        el(0, 9.5, 3, 3.5, '#ffba8c'); el(0, 9, 1.4, 2, '#fff4b6');
        el(-5.2, 4, 2.8, 4.5, '#b1a0ed'); el(5.2, 4, 2.8, 4.5, '#b1a0ed');
        el(-2.6, -10, 1.6, 4, '#fff0f5'); el(2.6, -10, 1.6, 4, '#fff0f5');
        el(0, 0, 6, 9.5, '#f4ecff'); el(0, -1, 4.2, 4.6, '#8be2dd'); el(0, 0, 3, 3, '#cef3ad');
        rect(-1.6, -0.6, 1, 1.2, '#27304c'); rect(0.6, -0.6, 1, 1.2, '#27304c');
        break;
      case 'f_bunny':
        el(-3.5, -8, 2.4, 6, '#fff0f5'); el(3.5, -8, 2.4, 6, '#fff0f5'); el(-3.5, -8, 1, 4, '#f4b3cc'); el(3.5, -8, 1, 4, '#f4b3cc');
        el(0, 3, 8, 7, '#fff0f5'); el(0, 10, 6, 3, '#f4ecff');
        el(-3, 2, 1.1, 1.4, '#49374c'); el(3, 2, 1.1, 1.4, '#49374c'); el(0, 5, 1.4, 1, '#f19ab5'); el(-5.5, 5, 1.6, 1, '#f4b3cc'); el(5.5, 5, 1.6, 1, '#f4b3cc');
        break;
      case 'f_chick':
        el(0, 3, 8.5, 8, '#f7db8c'); el(-7, 4, 2.5, 4, '#f3c665'); el(7, 4, 2.5, 4, '#f3c665');
        rect(-1, -7, 2, 3, '#f3c665'); el(-3, 1, 1.1, 1.3, '#49404c'); el(3, 1, 1.1, 1.3, '#49404c');
        poly([[-2, 4], [2, 4], [0, 7]], '#efaa78'); el(-5.5, 5, 1.5, 1, '#f4b3a0'); el(5.5, 5, 1.5, 1, '#f4b3a0');
        break;
      case 'f_cat':
        poly([[-8, -1], [-6, -10], [-1, -4]], '#c9b5f4'); poly([[8, -1], [6, -10], [1, -4]], '#c9b5f4');
        el(0, 2, 8.5, 7.5, '#c9b5f4'); el(0, 5, 4, 3, '#efe6ff');
        el(-3, 1, 1.1, 1.5, '#33314d'); el(3, 1, 1.1, 1.5, '#33314d'); el(0, 4, 1.2, 0.9, '#f19ab5');
        rect(-9, 3, 4, 0.8, '#efe6ff'); rect(5, 3, 4, 0.8, '#efe6ff');
        break;
      case 'antenna':
        rect(-6, -2, 1.6, 12, '#9d8fc7'); rect(4.4, -2, 1.6, 12, '#9d8fc7');
        el(-5.2, -4, 3, 3, '#a5f8d5'); el(5.2, -4, 3, 3, '#ffb6d3'); el(-5.8, -4.8, 1, 1, '#ffffff'); el(4.6, -4.8, 1, 1, '#ffffff');
        el(0, 10, 9, 3, '#bca5eb');
        break;
      case 'saucer':
        el(0, -1, 5.5, 5, '#9ddbd9'); el(0, 3, 11, 3.5, '#9bded3'); el(0, 2, 9, 2, '#ded0f9');
        rect(-6, 3, 1.6, 1.6, '#ffe7a9'); rect(-0.8, 3.4, 1.6, 1.6, '#ffffff'); rect(4.5, 3, 1.6, 1.6, '#ffe7a9');
        poly([[8, -6], [11, -9], [10, -4]], '#ffffff');
        break;
      case 'core':
        el(0, 0, 10, 10, '#ffb6d333'); el(0, 0, 7, 7, '#ff8fb8'); el(0, 0, 4.5, 4.5, '#ffe0f0'); el(-1.5, -1.5, 1.5, 1.5, '#ffffff');
        rect(-0.8, -11, 1.6, 4, '#f6d47a'); rect(-0.8, 7, 1.6, 4, '#f6d47a'); rect(-11, -0.8, 4, 1.6, '#f6d47a'); rect(7, -0.8, 4, 1.6, '#f6d47a');
        break;
      case 'doll':
        el(-6, -7, 4, 4, '#dba77c'); el(6, -7, 4, 4, '#dba77c'); el(0, 6, 8, 7, '#dba77c'); el(0, -1, 9, 8, '#edc39a');
        el(-3, -2, 1.2, 1.5, '#49374c'); el(3, -2, 1.2, 1.5, '#49374c'); el(0, 2, 2, 1.5, '#65475b');
        break;
    }
  }
  // DOM용: 16×16 도트 이미지를 미리 만들어 두고 CSS에서 2배(pixelated)로 확대합니다.
  const iconURL = {}, iconCanvas = {};
  for (const type of [...Object.keys(items), 'doll', 'paw', 'sparkle', 'swirl', 'rocket', 'f_bunny', 'f_chick', 'f_cat', 'antenna', 'saucer', 'core']) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.setTransform(16 / 26, 0, 0, 16 / 26, 8, 8);
    drawIcon(g, type);
    iconCanvas[type] = c;
    try { iconURL[type] = c.toDataURL(); } catch { iconURL[type] = ''; }
  }
  const icon = (type, cls = 'ico') => `<img class="${cls}" src="${iconURL[type]}" alt="" aria-hidden="true">`;
  // '{rabbit} 토끼 귀'처럼 {키}를 도트 아이콘으로 바꿉니다. (내부 문자열만 사용)
  const rich = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (iconURL[k] !== undefined ? icon(k) : m));

  // ═══════════════════════════════════════════════════════════════
  // 6. DOM 갱신 (값이 바뀔 때만 씀 — 저사양 WebView 대비)
  // ═══════════════════════════════════════════════════════════════
  const uiCache = {};
  function setText(id, v) { if (uiCache[id] !== v) { uiCache[id] = v; $(id).textContent = v; } }
  function setHTML(id, v) { const k = '#' + id; if (uiCache[k] !== v) { uiCache[k] = v; $(id).innerHTML = rich(v); } }
  function setAttr(id, name, v) { const k = id + '@' + name; if (uiCache[k] !== v) { uiCache[k] = v; $(id).setAttribute(name, v); } }
  function setFlag(id, prop, v) { const k = id + '.' + prop; if (uiCache[k] !== v) { uiCache[k] = v; $(id)[prop] = v; } }
  const pad = (n) => String(n).padStart(4, '0');

  function sync() {
    bgmUpdate();
    setText('score', pad(score));
    setText('best', pad(best));
    setText('time', String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(Math.floor(elapsed % 60)).padStart(2, '0'));
    const P = planet();
    setText('level', boss ? '⚠ 모선 ' + P.boss.short + ' 격퇴!' : rescue ? '♥ 친구를 받아요!' : '모선까지 ' + Math.max(0, Math.ceil(P.len - tripT)) + '초');
    const trip = boss || rescue ? 100 : Math.min(100, Math.round((tripT / P.len) * 100));
    if (uiCache.trip !== trip) { uiCache.trip = trip; $('trip-fill').style.width = trip + '%'; }
    setHTML('trip-goal', '{' + P.friend + '}');
    setFlag('boss-bar', 'hidden', !boss || mode !== 'playing');
    if (boss) {
      setText('boss-name', P.boss.name + (boss.L ? ' ' + 'Ⅱ Ⅲ Ⅳ Ⅴ'.split(' ')[Math.min(3, boss.L - 1)] : ''));
      const bp = Math.max(0, Math.round((boss.hp / boss.max) * 100));
      if (uiCache.bp !== bp) { uiCache.bp = bp; $('boss-fill').style.width = bp + '%'; }
      setText('boss-time', Math.max(0, Math.ceil(BOSS_TIME - boss.t)) + 's');
    }
    const showAlien = !boss;
    if (uiCache.showAlien !== showAlien) { uiCache.showAlien = showAlien; $('alien-panel').style.visibility = showAlien ? '' : 'hidden'; }
    const known = observed.some((k) => k.endsWith(':' + taste));
    setHTML('taste', known ? '{' + tastes[taste].icon + '} ' + tastes[taste].name : '? 미확인 방문자');
    setText('pursuit',
      mode === 'capture' ? '포획 중…'
        : confusedLeft > 0 ? '? 혼란 중'
        : alienPhase === 'aim' ? '! 다가온다'
        : alienPhase === 'dash' ? '추격 중'
        : interested() ? '♥ 관심 집중'
        : masked > 0 ? '? 못 알아봄'
        : '주변을 맴도는 중');
    const hot = interested();
    if (uiCache.hot !== hot) { uiCache.hot = hot; $('pursuit').classList.toggle('hot', hot); }
    const pct = Math.round((chase / 8.5) * 100);
    if (uiCache.pct !== pct) { uiCache.pct = pct; $('chase-fill').style.width = pct + '%'; $('chase-meter').setAttribute('aria-valuenow', String(pct)); }
    setHTML('mask', masked > 0 ? '{mask} ' + Math.ceil(masked) + '초' : '{mask} 위장 ×' + masks);
    setFlag('mask', 'disabled', mode !== 'playing' || resumeLeft > 0 || masks < 1 || masked > 0);
    setText('hangar-open', '상점 ★' + stars.toLocaleString('ko-KR'));
    setFlag('hyper-gauge', 'hidden', hyperCharged || hyperOn() || mode !== 'playing');
    const gp = Math.round((hyperGauge / HYPER_GAUGE) * 100);
    if (uiCache.gp !== gp) { uiCache.gp = gp; $('hyper-fill').style.width = gp + '%'; $('hyper-gauge').setAttribute('aria-valuenow', String(gp)); }
    setHTML('status', (lives ? '♡ ' + lives + ' ' : '') + (doll ? '{doll}' : '<span class="lost">인형 없음</span>'));
    const fx = [];
    if (charmLeft > 0 && items[charm]) fx.push('{' + charm + '} ' + Math.ceil(charmLeft) + 's');
    if (hyperLeft > 0) fx.push('⚡ ' + hyperLeft.toFixed(1) + 's');
    const fb = flipLeft > 0 && mode === 'playing' ? (flipLeft <= FLIP_WARN ? '정상 항로 복귀까지 ' + Math.ceil(flipLeft) + '…' : '거꾸로 비행 중 · 운석이 아래에서 와요') : '';
    setText('flip-banner', fb); setFlag('flip-banner', 'hidden', !fb);
    const fw = flipLeft > 0 && flipLeft <= FLIP_WARN;
    if (uiCache.fw !== fw) { uiCache.fw = fw; $('flip-banner').classList.toggle('warn', fw); }
    setAttr('beat-edge', 'class', 'beat-edge ' + (mode === 'playing' ? beatState : 'calm'));
    if (weaponLeft > 0) fx.push('★LV' + weaponLv + ' ' + weaponLeft.toFixed(1) + 's');
    if (doubleLeft > 0) fx.push('{crown} ×2 ' + Math.ceil(doubleLeft) + 's');
    if (magnetLeft > 0) fx.push('{cat} ' + Math.ceil(magnetLeft) + 's');
    if (slowLeft > 0) fx.push('{chick} ' + Math.ceil(slowLeft) + 's');
    if (confusedLeft > 0) fx.push('{moustache} ' + Math.ceil(confusedLeft) + 's');
    setHTML('effects', fx.join('  '));
  }
  // 화면 가운데 큰 알림: 피버·모선·구출 같은 중요한 순간에만 씁니다.
  let splashTimer = null;
  function splash(main, sub = '', tone2 = 'hyper', seconds = 1.6) {
    const el = $('splash');
    el.className = 'splash ' + tone2;
    el.innerHTML = '<b></b><small></small>';
    el.firstChild.innerHTML = rich(main); el.lastChild.innerHTML = rich(sub); // 내부 문자열만 사용
    el.hidden = false; $('coach').classList.add('under'); // 연습 안내 카드와 겹치지 않게 잠깐 숨김
    void el.offsetWidth; el.classList.add('show'); // 애니메이션 다시 시작
    clearTimeout(splashTimer);
    splashTimer = setTimeout(() => { el.classList.remove('show'); el.hidden = true; $('coach').classList.remove('under'); }, seconds * 1000);
  }
  function hideSplash() { clearTimeout(splashTimer); $('splash').hidden = true; $('coach').classList.remove('under'); }
  function toast(text, seconds = 2.8) { $('notice').innerHTML = rich(text); toastLeft = seconds; }
  // 처음 한 번만 보여 주는 상황별 힌트 (튜토리얼)
  function tip(key, text) {
    if (tips[key] || tut) return;
    tips[key] = true; saveProgress(); toast('TIP · ' + text, 4);
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. 도감 · 꾸미기
  // ═══════════════════════════════════════════════════════════════
  function refreshBook() {
    for (const group of ['animal', 'shiny', 'odd', 'supply']) {
      const list = $('book-' + group);
      list.replaceChildren();
      for (const [key, item] of Object.entries(items).filter(([, i]) => i.group === group)) {
        const known = !!found[key];
        const cell = document.createElement('div');
        cell.className = 'book-item' + (known ? '' : ' undiscovered');
        // 미발견 아이템은 모양도 숨깁니다(직접 먹어 보고 알아가기).
        cell.innerHTML = `<span class="book-icon">${known ? icon(key, 'ico big') : '<span class="q">?</span>'}</span><span></span><small></small>`;
        cell.children[1].textContent = known ? item.name : '???';
        cell.children[2].textContent = known ? item.effect : '미발견';
        if (known) {
          const n = document.createElement('small');
          n.className = 'book-count';
          n.textContent = '×' + (counts[key] || 0) + (gold[key] ? ' · ★' + gold[key] : '');
          cell.append(n);
        }
        const witnessed = observed.filter((k) => k.startsWith(key + ':'));
        if (known && witnessed.length) {
          const relation = document.createElement('small');
          relation.className = 'book-reaction';
          relation.innerHTML = rich(witnessed.map((k) => '{' + tastes[Number(k.split(':')[1])].icon + '}♥').join(' '));
          cell.append(relation);
        }
        cell.setAttribute('aria-label', known ? item.name + ' ' + item.note : '아직 발견하지 않은 아이템');
        list.append(cell);
      }
    }
    const tb = $('book-trophy');
    tb.replaceChildren();
    for (const k of TROPHY_KEYS) {
      const T = TROPHIES[k], have = trophyCount[k] > 0, cell = document.createElement('div');
      cell.className = 'book-item' + (have ? '' : ' undiscovered');
      cell.innerHTML = `<span class="book-icon">${have ? icon(k, 'ico big') : '<span class="q">?</span>'}</span><span></span><small></small>`;
      cell.children[1].textContent = have ? T.name : '???';
      cell.children[2].textContent = have ? T.effect : T.from + '으로만';
      tb.append(cell);
    }
    $('book-title').innerHTML = '발견 도감 <em class="chip">' + Object.keys(found).filter((k) => items[k]).length + '/10</em>';
  }
  // ── 여정: 행성 지도 · 구한 친구 · 현상수배 ──
  function refreshJourney() {
    const pl = $('journey-planets'), fr = $('journey-friends'), wa = $('journey-wanted');
    pl.replaceChildren(); fr.replaceChildren(); wa.replaceChildren();
    PLANETS.forEach((P, i) => {
      const seen = i <= reached, cell = document.createElement('div');
      cell.className = 'jr-planet' + (seen ? '' : ' locked');
      cell.innerHTML = '<span class="dot"></span><b></b><small></small>';
      cell.querySelector('.dot').style.background = seen ? P.pl2 : '#3b3156';
      cell.querySelector('b').textContent = seen ? P.name : '???';
      cell.querySelector('small').textContent = arrested['boss' + i] ? '모선 격퇴 ✓' : seen ? '도착' : '미도착';
      pl.append(cell);
    });
    for (const k of FRIEND_KEYS) {
      const has = !!friends[k], cell = document.createElement('div');
      cell.className = 'book-item' + (has ? '' : ' undiscovered');
      cell.innerHTML = `<span class="book-icon">${has ? icon(k, 'ico big') : '<span class="q">?</span>'}</span><span></span><small></small>`;
      cell.children[1].textContent = has ? FRIENDS[k].name : '???';
      cell.children[2].textContent = has ? '함께 다니는 중' : '구출 전';
      fr.append(cell);
    }
    PLANETS.forEach((P, i) => {
      const seen = i <= reached, got = !!arrested['boss' + i], card = document.createElement('div');
      card.className = 'wanted' + (got ? ' got' : '');
      card.innerHTML = '<small>WANTED</small><b></b><em></em><i>체포!</i>';
      card.querySelector('b').textContent = seen ? P.boss.name : '???';
      card.querySelector('em').textContent = seen ? P.boss.hint : '다음 행성에 숨어 있대요';
      wa.append(card);
    });
    $('journey-title').innerHTML = '여정 지도 <em class="chip">친구 ' + everFriends() + '/' + FRIEND_KEYS.length + '</em>';
  }
  let journeyFrom = 'ready';
  function openJourney() {
    if (!['ready', 'over', 'paused'].includes(mode)) return;
    refreshJourney();
    journeyFrom = mode; mode = 'journey'; keys.clear(); dragging = false;
    $('panel').inert = true; $('pause').disabled = true; $('journey').hidden = false; $('journey-close').focus();
  }
  function closeJourney() {
    if (mode !== 'journey') return;
    $('journey').hidden = true; $('panel').inert = false; $('pause').disabled = false;
    mode = journeyFrom; keys.clear(); sync(); $('journey-open').focus();
  }
  function openBook() {
    if (!['ready', 'over', 'playing', 'paused'].includes(mode)) return;
    refreshBook();
    bookFrom = mode; mode = 'book'; keys.clear(); dragging = false;
    $('panel').inert = true; $('pause').disabled = true; $('item-book').hidden = false; $('book-close').focus();
  }
  function closeBook() {
    if (mode !== 'book') return;
    $('item-book').hidden = true; $('panel').inert = false; $('pause').disabled = false;
    mode = bookFrom; keys.clear(); sync(); $('book-open').focus();
  }

  const equipped = (k) => mode !== 'ready' && !!runDress[k]; // 이번 판에 먹은 장식만
  function dressCount() { return DRESS_KEYS.filter(equipped).length; }
  function dressTier() {
    const n = dressCount();
    if (n >= 9) return DRESS_KEYS.every(golden) ? 4 : 3;
    return n >= 6 ? 2 : n >= 3 ? 1 : 0;
  }
  const RANKS = ['SCOUT', 'CUSTOM', 'ELITE', 'MAXED', 'LEGEND'];
  // 구매는 두 번 눌러야 확정(실수 방지). 첫 번째 누름 = '한 번 더 누르면 구매'
  let buyArmed = '', buyArmedAt = 0;
  function tryBuy(id, price, onBuy) {
    const now = performance.now();
    if (stars < price) { hangarMsg('★' + (price - stars) + ' 더 모으면 살 수 있어요'); tone(200, 0.08); return; }
    if (buyArmed !== id || now - buyArmedAt > 3000) { buyArmed = id; buyArmedAt = now; hangarMsg('★' + price + ' · 한 번 더 누르면 구매'); refreshHangar(); return; }
    buyArmed = ''; stars -= price; onBuy(); saveProgress();
    hangarMsg('구매 완료! ★' + stars + ' 남음'); tone(988, 0.12); setTimeout(() => tone(1318, 0.12), 90); buzz(30);
    refreshHangar();
  }
  function hangarMsg(text) { $('hangar-msg').textContent = text; }
  function refreshHangar() {
    $('hangar-stars').textContent = '★ ' + stars.toLocaleString('ko-KR');
    const list = $('hangar-parts');
    list.replaceChildren();
    for (const key of DRESS_KEYS) {
      const known = !!found[key];
      const button = document.createElement('div'); // 정보 칸(구매 버튼 아님) — 장식은 판에서 먹으면 달림
      button.className = 'hangar-part info' + (known ? '' : ' locked') + (golden(key) ? ' gold' : '');
      button.innerHTML = known ? `<span>${icon(key, 'ico big')}</span><small></small><em></em>` : '<span class="q">?</span><small></small><em></em>';
      button.children[1].textContent = known ? items[key].name : '미발견';
      const g = Math.min(gold[key] || 0, GOLD_PIECES);
      button.children[2].textContent = !known ? '먹어서 발견' : golden(key) ? '✦ 황금 각인' : '황금 ' + g + '/' + GOLD_PIECES;
      list.append(button);
    }
    const tbox = $('hangar-trophies');
    tbox.replaceChildren();
    for (const k of TROPHY_KEYS) {
      const T = TROPHIES[k], have = trophyCount[k] > 0, b = document.createElement('div');
      b.className = 'hangar-part info' + (have ? ' trophy' : ' locked');
      b.innerHTML = (have ? `<span>${icon(k, 'ico big')}</span>` : '<span class="q">?</span>') + '<small></small><em></em>';
      b.children[1].textContent = have ? T.name : '???';
      b.children[2].textContent = have ? '격추 기록 ×' + trophyCount[k] : T.from;
      tbox.append(b);
    }
    for (const [kind, table, boxId] of [['nickc', NICK_COLORS, 'hangar-nickc'], ['badge', BADGES, 'hangar-badge'], ['frame', FRAMES, 'hangar-frame']]) {
      const box = $(boxId);
      box.replaceChildren();
      for (const [k, sk] of Object.entries(table)) {
        const have = !!skins[kind][k], on = deco[kind] === k, id = kind + ':' + k, b = document.createElement('button');
        b.type = 'button';
        b.className = 'skin deco-' + kind + (on ? ' on' : '') + (have ? '' : ' shop') + (buyArmed === id ? ' armed' : '');
        b.setAttribute('aria-pressed', String(on));
        b.innerHTML = '<i></i><small></small><em></em>';
        if (kind === 'nickc') b.firstChild.style.background = sk.c;
        else if (kind === 'frame') { b.firstChild.style.background = sk.bg; if (k === 'gold') b.firstChild.style.boxShadow = 'inset 0 0 0 2px #ffd76a'; }
        else b.firstChild.innerHTML = k === 'none' ? '' : icon(k, 'ico');
        b.children[1].textContent = sk.name;
        b.children[2].textContent = on ? '사용 중' : have ? '고르기' : buyArmed === id ? '눌러서 구매!' : '★ ' + sk.price;
        b.onclick = () => {
          const pick = () => { deco[kind] = k; saveProgress(); refreshHangar(); tone(620); pushProfile(); };
          if (have) pick();
          else tryBuy(id, sk.price, () => { skins[kind][k] = true; deco[kind] = k; pushProfile(); });
        };
        box.append(b);
      }
    }
    decorateRow($('deco-preview'), nick || '내 닉네임', decoCode(), true);
    for (const [kind, table, boxId] of [['paint', PAINTS, 'hangar-paints'], ['flame', FLAMES, 'hangar-flames']]) {
      const box = $(boxId);
      box.replaceChildren();
      for (const [k, sk] of Object.entries(table)) {
        const have = !!skins[kind][k], on = (kind === 'paint' ? shipPaint : flame) === k, id = kind + ':' + k;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'skin' + (on ? ' on' : '') + (have ? '' : ' shop') + (buyArmed === id ? ' armed' : '');
        b.setAttribute('aria-pressed', String(on));
        b.innerHTML = '<i></i><small></small><em></em>';
        b.firstChild.style.background = kind === 'paint' ? `linear-gradient(90deg, ${sk.body} 50%, ${sk.wing} 50%)` : `linear-gradient(90deg, ${sk.core} 40%, ${sk.out} 40%)`;
        b.children[1].textContent = sk.name;
        b.children[2].textContent = on ? '사용 중' : have ? '고르기' : buyArmed === id ? '눌러서 구매!' : '★ ' + sk.price;
        b.onclick = () => {
          const pick = () => { if (kind === 'paint') shipPaint = k; else flame = k; saveProgress(); refreshHangar(); tone(620); };
          if (have) pick();
          else tryBuy(id, sk.price, () => { skins[kind][k] = true; if (kind === 'paint') shipPaint = k; else flame = k; });
        };
        box.append(b);
      }
    }
    const pbox = $('hangar-perks');
    pbox.replaceChildren();
    for (const [k, pk] of Object.entries(PERKS)) {
      const have = !!perks[k], id = 'perk:' + k, b = document.createElement('button');
      b.type = 'button'; b.className = 'skin perk' + (have ? ' on' : ' shop') + (buyArmed === id ? ' armed' : '');
      b.innerHTML = '<i></i><small></small><em></em>';
      b.children[1].textContent = pk.name + ' · ' + pk.note;
      b.children[2].textContent = have ? '보유 중 · 별탄 ' + weaponTime() + '초' : buyArmed === id ? '눌러서 구매!' : '★ ' + pk.price;
      b.disabled = have;
      b.onclick = () => { if (!have) tryBuy(id, pk.price, () => { perks[k] = true; }); };
      pbox.append(b);
    }
    $('hangar-rank').textContent = RANKS[dressTier()];
    $('hangar-count').textContent = (mode === 'hangar' && hangarFrom !== 'ready' && hangarFrom !== 'over' ? '이번 판 장식 ' + dressCount() + ' / 9 · ' : '') + '황금 각인 ' + DRESS_KEYS.filter(golden).length + ' / 9';
  }
  function openHangar() {
    if (!['ready', 'over', 'playing', 'paused'].includes(mode)) return;
    hangarFrom = mode; mode = 'hangar'; keys.clear(); dragging = false; buyArmed = '';
    $('panel').inert = true; $('pause').disabled = true; $('hangar').hidden = false;
    hangarMsg('★는 업그레이드 · 기체 색 · 불꽃 색 · 순위표 꾸미기에 써요');
    refreshHangar(); $('hangar-close').focus();
  }
  function closeHangar() {
    if (mode !== 'hangar') return;
    $('hangar').hidden = true; $('panel').inert = false; $('pause').disabled = false;
    mode = hangarFrom; keys.clear();
    if (mode === 'playing') beginResume(); // 플레이 중에 열었다면 바로 재개하지 않고 카운트다운
    sync(); $('hangar-open').focus();
  }
  const hangarCanvas = $('hangar-preview'), hangarView = hangarCanvas.getContext('2d');
  function renderHangar(t) {
    if (!surfaceReady || low.width < 1 || low.height < 1 || width < 1) return;
    const pw = Math.min(width, hangarCanvas.getBoundingClientRect().width || 0);
    if (pw < 1) return;
    ctx.clearRect(0, 0, width, height);
    // 배경은 투명 — 상점의 발사대 그라데이션이 비쳐요
    ctx.save(); ctx.translate(S(pw / 2), 98); ctx.scale(1.45, 1.45); ship(0, 0, t);
    FRIEND_KEYS.filter((k) => runFriends[k] && hangarFrom !== 'ready' && hangarFrom !== 'over').forEach((k, i) => { ctx.save(); ctx.translate([-58, 58, 0][i], [30, 30, 58][i]); ctx.scale(0.8, 0.8); drawIcon(ctx, k); ctx.restore(); });
    ctx.restore();
    const w = Math.round(pw * DPR), h = Math.round(180 * DPR);
    if (hangarCanvas.width !== w || hangarCanvas.height !== h) { hangarCanvas.width = w; hangarCanvas.height = h; }
    hangarView.imageSmoothingEnabled = false;
    hangarView.clearRect(0, 0, w, h);
    hangarView.drawImage(low, 0, 0, pw / PX, 180 / PX, 0, 0, w, h);
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. 효과음
  // ═══════════════════════════════════════════════════════════════
  function tone(freq, duration = 0.08) {
    if (!sound) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
      const o = audio.createOscillator(), g = audio.createGain();
      o.connect(g); g.connect(audio.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.05, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      o.start(); o.stop(audio.currentTime + duration);
    } catch {}
  }
  function refreshSound() {
    $('sound').textContent = sound ? '사운드 ON' : '음소거';
    $('sound').setAttribute('aria-label', sound ? '효과음과 음악 끄기' : '효과음과 음악 켜기');
  }

  // ── 배경 음악: 아주 작은 칩튠 루프 (사운드 ON + 플레이 중에만) ──
  const NOTE = (n) => {
    const m = /^([A-G])(#?)(\d)$/.exec(n);
    if (!m) return 0;
    const semi = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
    return 440 * Math.pow(2, semi / 12);
  };
  const LEAD = ('E5 . G5 . A5 . G5 E5 D5 . E5 . C5 . . . E5 . G5 . A5 . C6 A5 G5 . E5 . D5 . . . ' +
    'C5 . D5 E5 G5 . E5 . D5 . C5 . A4 . . . C5 . E5 . D5 . G4 . C5 . . . . . . .').split(' ').map(NOTE);
  const BASS = ['C3', 'G2', 'A2', 'G2', 'F2', 'G2', 'C3', 'G2'].map(NOTE);
  const BGM_STEP = 0.16;
  let bgmTimer = null, bgmNext = 0, bgmStep = 0;
  function blip(freq, at, dur, type, vol) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    o.start(at); o.stop(at + dur + 0.02);
  }
  function bgmTick() {
    if (!audio) return;
    try {
      while (bgmNext < audio.currentTime + 0.3) {
        const i = bgmStep % LEAD.length;
        const st = hyperLeft > 0 ? BGM_STEP * 0.6 : BGM_STEP;
        if (LEAD[i]) blip(LEAD[i], bgmNext, st * 1.6, 'square', 0.012);
        if (i % 4 === 0) blip(BASS[Math.floor(i / 8) % BASS.length], bgmNext, st * 3, 'triangle', 0.035);
        bgmStep++; bgmNext += st;
      }
    } catch {}
  }
  function bgmUpdate() {
    const want = sound && mode === 'playing' && resumeLeft <= 0;
    if (want && !bgmTimer) {
      try {
        if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
        audio.resume(); bgmNext = audio.currentTime + 0.05;
        bgmTimer = setInterval(bgmTick, 100);
      } catch {}
    } else if (!want && bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  // ── 진동: 앱에서는 Android 브리지, 브라우저에서는 navigator.vibrate ──
  const CAN_BUZZ = !!(window.NeonAndroid && window.NeonAndroid.vibrate) ||
    (typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches);
  function buzz(ms) {
    if (!haptic || !CAN_BUZZ) return;
    try {
      if (window.NeonAndroid && window.NeonAndroid.vibrate) window.NeonAndroid.vibrate(ms);
      else navigator.vibrate(ms);
    } catch {}
  }
  function refreshHaptic() {
    const b = $('haptic');
    b.hidden = !CAN_BUZZ;
    b.textContent = haptic ? '진동 ON' : '진동 OFF';
    b.setAttribute('aria-pressed', String(haptic));
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. 판 진행 (시작 · 일시정지 · 재개 · 종료)
  // ═══════════════════════════════════════════════════════════════
  function start(daily = false, practice = false) {
    if (!tips.intro && !practice && (mode === 'ready' || mode === 'over')) { openIntro(false, () => start(daily, practice)); return; } // 처음 한 번: 설명 화면 + 닉네임
    if (rival) rival.beaten = false;
    course = !!daily; courseSeed = seedOf('neon-drift:' + dayKey());
    resetRun();
    activePointer = null; dragging = false; keys.clear();
    playerY = targetY = S(height - 135);
    playerX = targetX = S(width / 2);
    pickups = [{ x: width / 2, y: height - 230, type: 'rabbit', speed: 120 * pace() }]; // 첫 아이템은 항상 토끼 귀(목숨 +1)
    mode = 'playing';
    $('panel').hidden = true; $('result').hidden = true; $('panel').classList.remove('over'); $('panel').classList.remove('quick'); $('stage').classList.remove('menu');
    $('pause').hidden = false; $('pause').textContent = 'Ⅱ';
    $('alien-panel').hidden = false; $('play-tools').hidden = false; $('scene-caption').hidden = true;
    $('run-stats').hidden = true; $('share').hidden = true; $('share-panel').hidden = true; $('next-goal').hidden = true; hideSplash();
    $('boss-bar').hidden = true; uiCache['boss-bar.hidden'] = true;
    if (daily.date !== dayKey()) loadDaily();
    if (practice || !tips.tutorial) { startTutorial(); sync(); tone(540); return; }
    if (rival) { toast('친구 기록 ' + rival.score.toLocaleString('ko-KR') + '점을 넘어라!', 3.2); if (!tips.start) setTimeout(() => { if (mode === 'playing') tip('start', '손가락으로 끌어서 이동 · 톡 치면 변장'); }, 3400); }
    else if (!tips.start) tip('start', '손가락으로 끌어서 이동 · 톡 치면 변장');
    else if (course) toast('오늘의 코스 — 다들 같은 길! 친구보다 멀리 가 봐요', 3.2);
    else toast('오늘의 미션 ▸ ' + todayMission().text);
    { const g = goalTarget(); if (g) setTimeout(() => { if (mode === 'playing' && elapsed < 4) splash('{' + g.P.friend + '} ' + FRIENDS[g.P.friend].name.split(' ')[1] + ' 구출 작전!', g.i === 0 ? '모선까지 ' + planet().len + '초 · 버티면 나타나요' : PLANETS[0].boss.short + '부터 잡고 ' + g.P.name + '으로!', 'planet', 2.4); }, 250); }
    sync(); tone(540);
  }
  function show(message, label) {
    $('panel').hidden = false; $('coach').hidden = true; $('panel').classList.remove('quick');
    for (const id of ['near-line', 'rank-line', 'nick-box', 'over-more']) $(id).hidden = true;
    $('message').textContent = message;
    $('start').innerHTML = label + ' <span>↗\uFE0E</span>';
    renderDaily();
    $('course-start').hidden = mode === 'paused';
    renderGoal();
    $('stage').classList.add('menu');
  }
  function beginResume() { resumeLeft = 1.5; $('scene-caption').hidden = false; $('scene-caption').classList.add('count'); $('scene-caption').textContent = '3'; }
  function pause() {
    hideSplash();
    if (mode === 'playing' || mode === 'capture') {
      pausedFrom = mode; mode = 'paused'; resumeLeft = 0;
      keys.clear(); dragging = false;
      if (pausedFrom === 'playing') $('scene-caption').hidden = true;
      show('잠시 쉬어 가세요.', '계속하기');
      $('pause').textContent = '▶';
    } else if (mode === 'paused') {
      mode = pausedFrom; $('panel').hidden = true; $('pause').textContent = 'Ⅱ'; $('stage').classList.remove('menu');
      if (tut) coach();
      if (mode === 'playing') beginResume();
    }
    sync();
  }
  // ── 결과 공유: 카톡 등에 붙여 넣을 문구 ──
  let shareText = '';
  // ── 결과 링크: 공유 페이지는 #뒤에 글자·숫자·. 만 전달하므로 결과를 숫자 토큰으로 담습니다 ──
  const fmtTime = (t) => (t < 60 ? t + '초' : Math.floor(t / 60) + '분 ' + String(t % 60).padStart(2, '0') + '초');
  const maskOf = (keys, all) => all.reduce((m, k, i) => m | (keys.includes(k) ? 1 << i : 0), 0);
  const keysOf = (m, all) => all.filter((k, i) => m & (1 << i));
  const sum36 = (t) => { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % 46656; return h.toString(36); };
  function encodeCard(c) {
    const f = [c.score, c.secs, c.pIdx, maskOf(c.friends, FRIEND_KEYS), c.kills, c.bosses, c.hypers, maskOf(c.dress, DRESS_KEYS), maskOf(c.golden, DRESS_KEYS), c.day];
    const body = 'r1.' + f.map((n) => Math.max(0, Math.floor(n)).toString(36)).join('.');
    return body + '.' + sum36(body);
  }
  function decodeCard(tok) {
    if (!/^r1(\.[0-9a-z]{1,9}){11}$/.test(tok)) return null;
    const parts = tok.split('.'), sum = parts.pop(), body = parts.join('.');
    if (sum36(body) !== sum) return null;
    const [score, secs, pIdx, fm, kills, bosses, hypers, dm, gm, day] = parts.slice(1).map((x) => parseInt(x, 36));
    if (![score, secs, pIdx].every(Number.isFinite) || score > 9999999 || secs > 36000 || pIdx > 99) return null;
    const P = PLANETS[pIdx % PLANETS.length], L = Math.floor(pIdx / PLANETS.length);
    return { score, isNew: false, secs, pIdx, day, kills, bosses, hypers,
      timeText: fmtTime(secs), where: P.name + (L ? ' ' + (L + 1) + '회차' : ''),
      friends: keysOf(fm, FRIEND_KEYS), dress: keysOf(dm, DRESS_KEYS), golden: keysOf(gm, DRESS_KEYS), course: !!day, trophies: [] };
  }
  // 친구가 보낸 링크로 들어오면: 친구의 기록 카드 + '이 기록 깨기'
  let rival = null;
  function openChallenge(c) {
    $('challenge-card').src = drawCard(c, true);
    const sameDay = c.day && c.day === Number(dayKey().replace(/-/g, ''));
    $('challenge-text').textContent = sameDay ? '친구가 오늘의 코스 기록을 보냈어요. 같은 길로 이겨 봐요!' : '친구가 보낸 기록이에요. 이 점수를 넘어 봐요!';
    $('challenge').hidden = false; $('challenge-go').focus();
    $('challenge-go').onclick = () => { rival = c; $('challenge').hidden = true; start(!!sameDay); };
  }
  // 카톡에 붙여 넣으면 바로 읽히는 결과 메시지 (0인 항목은 빼서 짧게)
  function buildShare() {
    const c = card, d = new Date(), md = d.getMonth() + 1 + '/' + d.getDate();
    const L = ['🚀 뽀짝 우주 대탈출 결과'];
    if (c.course) L.push('📅 오늘의 코스 ' + md + ' · 다들 같은 길!');
    L.push('━━━━━━━━━━━━');
    L.push('🏆 ' + c.score.toLocaleString('ko-KR') + '점' + (c.isNew ? ' (내 최고 기록!)' : ''));
    L.push('⏱ ' + c.timeText + ' 버팀 · 🪐 ' + c.where);
    const fight = [];
    if (c.friends.length) fight.push('💖 친구 ' + c.friends.length + '명 구출');
    if (c.bosses) fight.push('🛸 모선 ' + c.bosses + '대 격추');
    else if (c.kills) fight.push('🛸 UFO ' + c.kills + '대 격추');
    if (fight.length) L.push(fight.join(' · '));
    const extra = [];
    if (c.hypers) extra.push('⚡ 폭주 ' + c.hypers + '번');
    if (c.dress.length) extra.push('🎀 장식 ' + c.dress.length + '/9' + (c.golden.length ? ' (황금 ' + c.golden.length + ')' : ''));
    if (extra.length) L.push(extra.join(' · '));
    L.push('━━━━━━━━━━━━');
    L.push(c.course ? '같은 코스로 나 이겨 봐 👇' : '나보다 멀리 갈 수 있어? 👇');
    L.push(SHARE_URL + '#' + encodeCard(c));
    return L.join('\n');
  }
  // 결과 카드 이미지(1080×1350): 길게 눌러 저장해서 카톡에 같이 보내요
  function drawCard(c = card, friendView = false) {
    const W = 1080, H = 1350, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, planet().bg); bg.addColorStop(1, '#0b0f1f');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { g.fillStyle = i % 9 ? '#d9d2f8' : '#ffe6aa'; g.globalAlpha = 0.25 + (i % 3) * 0.2; g.fillRect((i * 137.31) % W, (i * 83.71) % H, 6, 6); }
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = false;
    const pix = (type, x, y, size) => { if (iconCanvas[type]) g.drawImage(iconCanvas[type], x, y, size, size); };
    const font = (wt, px) => wt + ' ' + px + "px 'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',Arial,sans-serif";
    g.textBaseline = 'alphabetic';
    pix('rocket', 80, 70, 128);
    g.fillStyle = '#f4ebff'; g.font = "80px 'OnePop','Malgun Gothic',sans-serif"; g.fillText('뽀짝 우주 대탈출', 230, 150);
    g.fillStyle = '#c9b5f4'; g.font = "900 36px 'NSN','Malgun Gothic',sans-serif"; g.fillText(c.course ? '오늘의 코스 · 다들 같은 길!' : '귀여우면 잡혀가는 슈팅 게임', 234, 200);
    if (friendView) { g.fillStyle = '#ffb6d3'; g.font = font(800, 40); g.fillText('친구의 기록', 80, 300); }
    g.fillStyle = '#fff3c4'; g.font = font(900, 190);
    const sc = c.score.toLocaleString('ko-KR'); g.fillText(sc, 80, 470);
    const sw = g.measureText(sc).width; g.font = font(800, 70); g.fillText('점', 100 + sw, 470);
    if (c.isNew) { g.fillStyle = '#ffb6d3'; g.font = font(900, 44); g.fillText('★ 내 최고 기록!', 84, 540); }
    const rows = [['⏱ 버틴 시간', c.timeText], ['🪐 도착', c.where], ['💖 구한 친구', c.friends.length + '명'],
      ['🛸 격추', 'UFO ' + c.kills + ' · 모선 ' + c.bosses], ['⚡ 폭주', c.hypers + '번']];
    rows.forEach(([k, v], i) => {
      const y = 650 + i * 92;
      g.fillStyle = '#2b2643cc'; g.fillRect(80, y - 62, W - 160, 80);
      g.fillStyle = '#c4b7d8'; g.font = font(700, 40); g.fillText(k, 110, y);
      g.fillStyle = '#f4ebff'; g.font = font(800, 44); g.textAlign = 'right'; g.fillText(v, W - 110, y); g.textAlign = 'left';
    });
    let y = 1160;
    if (c.friends.length) { c.friends.forEach((k, i) => pix(k, 80 + i * 104, y - 96, 96)); }
    c.dress.slice(0, 9).forEach((k, i) => pix(k, (c.friends.length ? 420 : 80) + i * 64, y - 64, 60));
    g.fillStyle = '#a5f8d5'; g.font = font(800, 40); g.fillText(c.course ? '같은 코스로 이겨 봐!' : '이 기록, 깰 수 있어?', 80, 1270);
    try { return cv.toDataURL('image/png'); } catch { return ''; }
  }
  function openShare() {
    if (!card) return;
    $('share-card').src = drawCard(card, true); // 친구가 링크를 누르면 보게 될 카드
    $('share-preview').textContent = shareText;
    $('share-copy').textContent = '메시지 복사 → 카톡에 붙여 넣기';
    $('share-app').hidden = !(window.NeonAndroid && window.NeonAndroid.share);
    $('share-panel').hidden = false; $('share-copy').focus();
  }
  function closeShare() { $('share-panel').hidden = true; $('share').focus(); }
  function copyShare() {
    const btn = $('share-copy');
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($('share-preview')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); btn.textContent = '위 글을 길게 눌러 복사하세요'; };
    try { navigator.clipboard.writeText(shareText).then(() => { btn.textContent = '복사됨! 카톡 채팅창에 붙여 넣어요'; tone(880); }, fallback); } catch { fallback(); }
  }
  // 앱: 지금 결과 화면을 자동 캡처해서 메시지와 함께 카톡 등으로 바로 공유(Android가 캡처)
  // 웹(공유 링크): 미리보기 패널에서 메시지 복사
  function shareResult() {
    if (window.NeonAndroid && window.NeonAndroid.shareResult) {
      $('notice').textContent = ''; hideSplash();
      try { window.NeonAndroid.shareResult(shareText); return; } catch {}
    }
    openShare();
  }

  // 사망: 0.7초 정지 연출(hit-stop) 뒤에 결과 화면
  // 게임오버 순간: 이번 판 장식·전리품이 기체에서 우수수 떨어져 나감
  function shedDress() {
    lastDress = DRESS_KEYS.filter((k) => runDress[k]); lastTrophy = TROPHY_KEYS.filter((k) => runTrophy[k]);
    const ks = [...lastDress, ...lastTrophy];
    ks.forEach((k, i) => {
      const a = -Math.PI / 2 + (i - (ks.length - 1) / 2) * 0.45;
      spills.push({ k, x: playerX, y: playerY, vx: Math.cos(a) * (110 + Math.random() * 80), vy: Math.sin(a) * 220 - 30, spin: 0, life: 1.6 });
    });
    runDress = {}; runTrophy = {};
  }
  function die(reason, x, y, why) {
    mode = 'dying'; dyingLeft = 0.75; dieReason = reason; cause = why;
    dressLost = dressCount(); trophyLost = TROPHY_KEYS.some((k) => runTrophy[k]); shedDress();
    deathFx = { x, y, t: 0 };
    impactSide = x < playerX ? -1 : 1; impactLeft = 0.38;
    for (let i = 0; i < 3; i++) burst(playerX + (Math.random() - 0.5) * 20, playerY + (Math.random() - 0.5) * 20, ['#ffc69a', '#fff1aa', '#d8bcff'][i]);
    for (let i = 0; i < 10; i++)
      bolts.push({ x: playerX, y: playerY, vx: (Math.random() - 0.5) * 220, vy: -60 - Math.random() * 140, life: 0.9 });
    keys.clear(); dragging = false;
    $('pause').hidden = true;
    tone(90, 0.35); buzz(120); sync();
  }
  function finish(reason) {
    hideSplash();
    if (friendCount()) toast('친구들이 다시 잡혀갔어요…', 3);
    mode = 'over'; tone(110, 0.3);
    if (!cause) cause = '포획';
    const prevBest = best, isNew = score > best;
    if (isNew) { best = score; store.set(KEY_BEST, String(best)); }
    $('pause').hidden = true; $('play-tools').hidden = true; $('alien-panel').hidden = true; $('scene-caption').hidden = true;
    show(reason || '운석과 부딪혔어요. 한 번 더?', '다시 도전');
    $('panel').classList.add('over');
    $('result').hidden = false;
    $('result').textContent = '⏱ ' + fmtTime(Math.floor(elapsed)) + ' · ' + score.toLocaleString('ko-KR') + '점' + (isNew ? ' · NEW BEST' : '');
    // 이번 판 기록 — 핵심 3줄만 보이고 나머지는 '기록 더 보기'에 접어 둠(눈 피로 줄이기)
    const r = runStats;
    if (coins.length) { giveStars(coins.length); coins = []; } // 날아오던 별조각은 챙겨 드려요
    for (const l of loot) collectTrophy(l.k);
    loot = [];
    const timeStars = Math.floor(elapsed * STAR_PER_SEC);
    giveStars(timeStars); saveProgress();
    const dressKeys = lastDress.length ? lastDress : DRESS_KEYS.filter((k) => runDress[k]);
    const trophyKeys = lastTrophy.length ? lastTrophy : TROPHY_KEYS.filter((k) => runTrophy[k]);
    const friendKeys = FRIEND_KEYS.filter((k) => runFriends[k]);
    const where = planet().name + (lap() ? ' ' + (lap() + 1) + '회차' : '');
    const timeText = fmtTime(Math.floor(elapsed));
    const main = [
      ['★ 별조각', '+' + runStars + ' · 보유 ' + stars.toLocaleString('ko-KR')],
      ['버틴 시간', timeText + ' · ' + where],
      ['친구 · 격추', '친구 ' + friendKeys.length + '명 · UFO ' + r.kills + ' · 모선 ' + r.bosses],
    ];
    const more = [
      ['근접 회피', r.near + '번 · 최고 ' + r.combo + '연속'],
      ['폭주(하이퍼)', r.hypers + '번 · 부순 운석 ' + r.smashed],
      ['아이템', r.items + '개' + (r.finds ? ' · 새 발견 ' + r.finds : '')],
      ['별탄 명중', 'UFO ' + r.ufoHits + ' · 운석 ' + r.rocks],
    ];
    const lost = [];
    if (dressKeys.length) lost.push('장식 ' + dressKeys.length);
    if (trophyKeys.length) lost.push('전리품 ' + trophyKeys.length);
    if (friendKeys.length) lost.push('친구 ' + friendKeys.length);
    if (lost.length) more.push(['날아간 것', lost.join(' · ')]);
    const box = $('run-stats');
    box.replaceChildren();
    const addRow = (parent, k, v) => {
      const line = document.createElement('div'), a = document.createElement('span'), b = document.createElement('b');
      a.textContent = k; b.textContent = v; line.append(a, b); parent.append(line);
    };
    for (const [k, v] of main) addRow(box, k, v);
    const det = document.createElement('details'), sum = document.createElement('summary');
    sum.textContent = '기록 더 보기'; det.append(sum);
    for (const [k, v] of more) addRow(det, k, v);
    box.append(det);
    box.hidden = false;
    // 다음 목표 — 딱 한 줄
    const P = planet();
    let next;
    if (boss) next = P.boss.short + ' 체력 ' + Math.max(1, Math.round((boss.hp / boss.max) * 100)) + '% 남음';
    else if (friendKeys.length >= FRIEND_KEYS.length) next = (lap() + 2) + '회차까지';
    else if (friendKeys.length) next = '친구 ' + (friendKeys.length + 1) + '명째 구출';
    else next = '모선까지 ' + Math.max(1, Math.ceil(P.len - tripT)) + '초';
    if (rival) next = score > rival.score ? '친구 기록 ' + rival.score.toLocaleString('ko-KR') + '점 돌파!' : '친구까지 ' + (rival.score - score).toLocaleString('ko-KR') + '점';
    $('next-goal').innerHTML = '<small>' + (rival ? '친구와 승부' : '다음 목표') + '</small><b></b>';
    $('next-goal').querySelector('b').textContent = next;
    $('next-goal').hidden = false;
    if (course && score > (daily.courseBest || 0)) { daily.courseBest = score; $('result').textContent += ' · 오늘의 코스 최고!'; }
    // 공유용 기록(카톡 메시지 + 결과 카드)
    card = { score, isNew, timeText, where, friends: friendKeys, dress: dressKeys, golden: dressKeys.filter(golden), trophies: trophyKeys,
      kills: r.kills, bosses: r.bosses, hypers: r.hypers, near: r.near, course, stars: runStars, secs: Math.floor(elapsed), pIdx: planetIdx, day: course ? Number(dayKey().replace(/-/g, '')) : 0 };
    shareText = buildShare();
    $('share').hidden = false; $('share').textContent = '카톡으로 자랑하기';
    // v0.17 빠른 결과 띠: 아까움 한 줄 + (오늘의 코스면) 순위. 화면 아무 데나 톡 = 바로 다시.
    $('near-line').textContent = nearLine(prevBest, isNew);
    $('near-line').hidden = false;
    $('over-more').hidden = false;
    $('start').innerHTML = (course ? '오늘의 코스 다시' : '다시 도전') + ' <small>· 톡!</small> <span>↗\uFE0E</span>';
    $('panel').classList.add('quick'); overAt = performance.now();
    rankAfterRun(score, Math.floor(elapsed));
    runDress = {}; runTrophy = {}; runFriends = {}; lastDress = []; lastTrophy = []; // 게임오버: 이번 판에 얻은 것은 모두 날아감
    checkDaily(); logRun(); saveDaily(); renderDaily();
    sync();
  }
  // 그 판에서 가장 아까운 것 한 줄
  function nearLine(prevBest, isNew) {
    const P = planet(), ko = (n) => Math.max(0, n).toLocaleString('ko-KR');
    if (rival) return score > rival.score ? '친구 기록 돌파! +' + ko(score - rival.score) + '점' : '친구까지 ' + ko(rival.score - score) + '점!';
    if (isNew) return prevBest > 0 ? '신기록! +' + ko(score - prevBest) + '점' : '첫 기록 ' + ko(score) + '점!';
    if (boss && boss.hp / boss.max <= 0.4) return P.boss.short + ' 체력 ' + Math.max(1, Math.round((boss.hp / boss.max) * 100)) + '% 남았었어요!';
    if (!boss && !rescue && P.len - tripT <= 6) return '모선까지 ' + Math.max(1, Math.ceil(P.len - tripT)) + '초 남았었어요!';
    if (!hyperOn() && hyperGauge >= HYPER_GAUGE - 3) return '폭주까지 ' + (HYPER_GAUGE - hyperGauge) + '칸이었어요!';
    return '최고 기록까지 ' + ko(best - score) + '점!';
  }

  // ═══ 하루 랭킹 (자유 비행 · 오늘의 코스) ═══
  const deviceId = (() => {
    let d = store.get(KEY_DEVICE);
    if (!d || !/^[A-Za-z0-9_-]{8,64}$/.test(d)) {
      d = ''; const ch = 'abcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 20; i++) d += ch.charAt(Math.floor(Math.random() * 36));
      store.set(KEY_DEVICE, d);
    }
    return d;
  })();
  let nick = (store.get(KEY_NICK) || '').slice(0, 10), pendingRank = null;
  async function rpc(fn, body) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 7000);
    try {
      const res = await fetch(SB_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }
  const ko = (n) => Number(n || 0).toLocaleString('ko-KR');
  function rankLine(text) { $('rank-line').textContent = text; $('rank-line').hidden = false; }
  // 순위는 두 종류: free = 자유 비행(일반 판), course = 오늘의 코스(모두 같은 배치)
  const KIND_NAME = { free: '자유 비행', course: '오늘의 코스' };
  let boardKind = 'free';
  function rankAfterRun(sc, secs) {
    const kind = course ? 'course' : 'free';
    boardKind = kind; $('rank-line').dataset.act = 'board';
    if (!nick) { pendingRank = { sc, secs, kind }; showNickBox(); rankLine('닉네임을 정하면 오늘 순위에 올라가요'); return; }
    submitRank(sc, secs, kind);
  }
  function showNickBox() { $('nick-box').hidden = false; $('nick-input').value = nick; }
  async function submitRank(sc, secs, kind = 'free') {
    rankLine('오늘 순위 올리는 중…');
    try {
      const r = await rpc('submit_daily', { p_day: dayKey(), p_device: deviceId, p_nick: nick, p_score: sc, p_secs: Math.max(1, secs), p_kind: kind, p_deco: decoCode() });
      if (!r || !r.ok) {
        const why = { nick: '닉네임은 1~10자로 해 주세요', nick_banned: '그 닉네임은 쓸 수 없어요 · 다른 걸로!', day: '오늘 순위는 한국 시간 기준이에요', score: '이 기록은 순위에 올릴 수 없어요' }[r && r.error] || '순위 등록에 실패했어요';
        rankLine(why);
        if (r && /nick/.test(r.error)) { pendingRank = { sc, secs, kind }; showNickBox(); }
        return;
      }
      pendingRank = null;
      const tag = KIND_NAME[kind] + ' ';
      rankLine(r.rank === 1 ? tag + '오늘 1위! · ' + r.total + '명 중 (내 최고 ' + ko(r.best) + '점)' : tag + '오늘 ' + r.rank + '위 / ' + r.total + '명 · ' + (r.rank - 1) + '위까지 ' + ko(r.gap) + '점!');
    } catch { rankLine('순위를 못 올렸어요 · 인터넷 연결을 확인해 주세요'); }
  }
  function saveNick() {
    const v = ($('nick-input').value || '').replace(/\s+/g, ' ').trim().slice(0, 10);
    if (!v) { $('nick-input').focus(); return; }
    nick = v; store.set(KEY_NICK, nick);
    $('nick-box').hidden = true;
    if (pendingRank) submitRank(pendingRank.sc, pendingRank.secs, pendingRank.kind);
  }
  // ── 순위표 꾸미기 ──
  const decoCode = () => 'n=' + deco.nickc + ';b=' + deco.badge + ';f=' + deco.frame;
  function parseDeco(s) {
    const d = { ...DECO_DEFAULT }, map = { n: 'nickc', b: 'badge', f: 'frame' };
    for (const part of String(s || '').split(';')) { const [a, v] = part.split('='); const kind = map[a]; if (kind && DECO_TABLES[kind][v]) d[kind] = v; }
    return d;
  }
  function decorateRow(li, name, code, mine) {
    const d = parseDeco(code);
    li.className = 'board-row f-' + d.frame + (mine ? ' mine' : '');
    const sp = li.children[1]; sp.replaceChildren();
    if (d.badge !== 'none') { const w = document.createElement('i'); w.className = 'badge'; w.innerHTML = icon(d.badge, 'ico'); sp.append(w); }
    const n = document.createElement('span'); n.className = 'nm'; n.textContent = name; n.style.color = NICK_COLORS[d.nickc].c; sp.append(n);
  }
  let profileTimer = 0;
  function pushProfile() { // 오늘 이미 올라간 내 기록에도 닉네임·꾸미기를 바로 반영
    if (!nick) return;
    clearTimeout(profileTimer);
    profileTimer = setTimeout(() => { rpc('set_profile', { p_day: dayKey(), p_device: deviceId, p_nick: nick, p_deco: decoCode() }).catch(() => {}); }, 600);
  }
  // ── 회원가입 없는 닉네임 ──
  const NICK_A = ['용감한', '말랑한', '반짝', '졸린', '씩씩한', '뽀짝', '몰래', '빙글', '통통', '쪼꼬미', '수줍은', '날쌘'];
  const NICK_B = ['토끼', '삐약이', '냥냥', '곰돌', '펭귄', '햄찌', '우주콩', '별사탕', '오리', '다람쥐'];
  const randomNick = () => (NICK_A[Math.floor(Math.random() * NICK_A.length)] + NICK_B[Math.floor(Math.random() * NICK_B.length)]).slice(0, 8) + Math.floor(10 + Math.random() * 90);
  const cleanNick = (v) => (v || '').replace(/\s+/g, ' ').trim().slice(0, 10);

  // ── 처음 시작할 때 보여 주는 설명 화면(운석 · 아이템 · UFO) + 닉네임 ──
  const INTRO = [
    { title: '운석은 피해요', text: '손가락으로 끌어서 운석 사이 빈칸으로 쏙! 작은 부스러기는 맞아도 콩 찌그러지기만 해요.' },
    { title: '아이템은 먹어요', text: '토끼 귀는 한 번 막아 주고, ★별탄 캡슐을 먹으면 별탄이 자동으로 나가요. 먹을수록 세져요.' },
    { title: 'UFO한테 잡히면 끝!', text: '외계인은 귀여운 것부터 잡아가요. 톡 치면 위장 가면 · 별탄으로 격추하면 인형을 되찾아요.' },
    { title: '닉네임 만들기', text: '회원가입 없이, 이 닉네임으로 하루 순위에 올라가요.' },
  ];
  let introStep = 0, introFrom = 'ready', introThen = null, introOnlyNick = false;
  function openIntro(onlyNick, then) {
    if (!['ready', 'over', 'board'].includes(mode)) return;
    if (mode === 'board') { $('board').hidden = true; introFrom = 'board'; }
    else introFrom = mode;
    mode = 'intro'; keys.clear(); dragging = false; introThen = then || null; introOnlyNick = !!onlyNick;
    $('panel').inert = true; $('pause').disabled = true; $('intro').hidden = false;
    $('intro-nick-input').value = nick || randomNick();
    showIntro(onlyNick ? 3 : 0);
  }
  function showIntro(i) {
    introStep = i;
    const it = INTRO[i];
    $('intro-title').textContent = it.title; $('intro-text').textContent = it.text;
    $('intro-nick').hidden = i !== 3; $('intro-art').hidden = i === 3 && introOnlyNick;
    $('intro-dots').innerHTML = introOnlyNick ? '' : INTRO.map((_, k) => '<i class="' + (k === i ? 'on' : '') + '"></i>').join('');
    $('intro-skip').textContent = i === 3 ? (introOnlyNick ? '취소' : '나중에') : '건너뛰기';
    $('intro-next').innerHTML = i < 3 ? '다음 <span>→</span>' : introOnlyNick ? '저장' : '이 닉네임으로 출발! <span>↗\uFE0E</span>';
    $('intro-nick-msg').textContent = '';
    if (i === 3) setTimeout(() => { if (mode === 'intro') $('intro-nick-input').focus(); }, 50); else $('intro-next').focus();
    tone(520 + i * 80, 0.05);
  }
  function closeIntro(saveIt) {
    if (mode !== 'intro') return;
    if (saveIt) {
      const v = cleanNick($('intro-nick-input').value);
      if (!v) { $('intro-nick-msg').textContent = '닉네임을 1~10자로 써 주세요'; $('intro-nick-input').focus(); return; }
      if (v !== nick) { nick = v; store.set(KEY_NICK, nick); pushProfile(); }
    }
    if (!introOnlyNick) { tips.intro = true; saveProgress(); }
    $('intro').hidden = true; $('panel').inert = false; $('pause').disabled = false;
    mode = introFrom === 'board' ? 'ready' : introFrom; keys.clear(); sync();
    const then = introThen; introThen = null;
    if (introFrom === 'board') { mode = boardFrom; openBoard(); return; }
    if (then) then();
  }
  function introNext() { if (introStep < 3) showIntro(introStep + 1); else closeIntro(true); }
  function introSkip() { if (introStep < 3) showIntro(3); else closeIntro(false); }
  const introCanvas = $('intro-art'), introView = introCanvas.getContext('2d');
  function renderIntro(t) {
    if (!surfaceReady || low.width < 1 || width < 1 || introCanvas.hidden) return;
    const pw = Math.min(width, introCanvas.getBoundingClientRect().width || 0), H = 200;
    if (pw < 1) return;
    // 그림만 잠깐 그리기 위해 판 상태를 저장했다가 되돌림
    const keep = { obstacles, pickups, playerX, playerY, invincible, flipLeft, flipSpin, impactLeft, squishLeft, weaponLeft, masked, magnetLeft, dents, hyperLeft, primaryStun, primarySpin, elapsed, taste };
    obstacles = []; pickups = []; invincible = flipLeft = flipSpin = impactLeft = squishLeft = weaponLeft = masked = magnetLeft = hyperLeft = primaryStun = primarySpin = 0; dents = []; elapsed = t / 1000; taste = 0;
    ctx.clearRect(0, 0, width, height);
    const s = t / 1000, cx = pw / 2;
    if (introStep === 0) {
      const y = 22 + ((s * 34) % 46), gapL = cx - 46, gapR = cx + 46;
      for (let x = 22; x < pw - 14; x += 42) if (x + 17 < gapL || x - 17 > gapR) obstacles.push({ x: x - 17, y: y - 17, spin: x, vx: 0 });
      drawRocks();
      ctx.strokeStyle = '#a5f8d5'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(S(cx), y + 22); ctx.lineTo(S(cx), 128); ctx.stroke(); ctx.setLineDash([]);
      ship(S(cx + Math.sin(s * 2.2) * 10), 160, t);
    } else if (introStep === 1) {
      const sx = cx + Math.sin(s * 1.6) * (pw * 0.22);
      for (const [k, x] of [['rabbit', pw * 0.28], ['crown', pw * 0.72]]) {
        const iy = S(52 + Math.sin(s * 3 + x) * 3);
        ellipse(S(x), iy, 20, 20, '#312d50'); ctx.strokeStyle = '#b3e2bc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(S(x), iy, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.save(); ctx.translate(S(x), iy); ctx.scale(1.2, 1.2); drawIcon(ctx, k); ctx.restore();
      }
      ellipse(S(cx), 52, 22, 22, '#55412a'); ctx.strokeStyle = '#ffe39b'; ctx.beginPath(); ctx.arc(S(cx), 52, 22, 0, Math.PI * 2); ctx.stroke(); star(S(cx), 52, 13, '#ffe39b');
      weaponLeft = 9; ship(S(sx), 160, t);
      bulletsArt(S(sx), 160, s);
    } else if (introStep === 2) {
      const ux = pw * 0.7, uy = 46;
      ctx.fillStyle = '#e6d1ff26'; ctx.beginPath(); ctx.moveTo(ux - 17, uy + 10); ctx.lineTo(ux - 80, 190); ctx.lineTo(ux + 40, 190); ctx.lineTo(ux + 17, uy + 10); ctx.closePath(); ctx.fill();
      ufo(S(ux), S(uy + Math.sin(s * 2) * 4), t);
      masked = (s % 3) > 1.4 ? 4 : 0; ship(S(pw * 0.3), 156, t);
    } else {
      ctx.save(); ctx.translate(S(cx), 100); ctx.scale(1.6, 1.6); ship(0, 0, t); ctx.restore();
    }
    ({ obstacles, pickups, playerX, playerY, invincible, flipLeft, flipSpin, impactLeft, squishLeft, weaponLeft, masked, magnetLeft, dents, hyperLeft, primaryStun, primarySpin, elapsed, taste } = keep);
    const w = Math.round(pw * DPR), h = Math.round(H * DPR);
    if (introCanvas.width !== w || introCanvas.height !== h) { introCanvas.width = w; introCanvas.height = h; }
    introView.imageSmoothingEnabled = false; introView.clearRect(0, 0, w, h);
    introView.drawImage(low, 0, 0, pw / PX, H / PX, 0, 0, w, h);
  }
  function bulletsArt(x, y, s) {
    for (let i = 0; i < 3; i++) { const by = y - 40 - (((s * 220) + i * 40) % 120); if (by > 0) star(x, S(by), 4, '#fff1a5'); }
  }
  let boardFrom = 'ready';
  async function openBoard(kind) {
    if (kind) boardKind = kind;
    if (mode !== 'board') {
      if (!['ready', 'over', 'paused'].includes(mode)) return;
      boardFrom = mode; mode = 'board'; keys.clear(); dragging = false;
      $('panel').inert = true; $('pause').disabled = true; $('board').hidden = false; $('board-close').focus();
    }
    for (const k of ['free', 'course']) { const t = $('board-tab-' + k); t.classList.toggle('on', k === boardKind); t.setAttribute('aria-selected', String(k === boardKind)); }
    $('board-rule').textContent = boardKind === 'course' ? '오늘의 코스는 모두 같은 운석 배치라 실력으로만 겨뤄요.' : '평소 판(자유 비행)의 오늘 최고 점수끼리 겨뤄요.';
    $('board-nick').textContent = nick ? '내 닉네임 ' + nick + ' · 바꾸기 ✎\uFE0E' : '닉네임 만들기 ✎\uFE0E';
    const want = boardKind;
    const list = $('board-list'); list.replaceChildren();
    $('board-me').textContent = '불러오는 중…';
    $('board-day').textContent = dayKey().slice(5).replace('-', '월 ') + '일 · 매일 밤 12시에 새로 시작';
    try {
      const r = await rpc('daily_board', { p_day: dayKey(), p_device: deviceId, p_kind: want });
      if (mode !== 'board' || want !== boardKind) return;
      for (const e of r.top || []) {
        const li = document.createElement('li');
        li.innerHTML = '<b></b><span></span><em></em>';
        li.children[0].textContent = e.rank; li.children[2].textContent = ko(e.score) + '점';
        decorateRow(li, e.nick, e.deco, !!e.mine);
        list.append(li);
      }
      if (!(r.top || []).length) $('board-me').textContent = '아직 아무도 없어요 · 오늘 1등 기회!';
      else if (r.me) $('board-me').textContent = '내 순위 ' + r.me.rank + '위 / ' + r.total + '명' + (r.me.gap ? ' · ' + (r.me.rank - 1) + '위까지 ' + ko(r.me.gap) + '점' : ' · 1등!');
      else $('board-me').textContent = (want === 'course' ? '오늘의 코스를 하면' : '한 판 하면') + ' 순위에 올라가요 · ' + r.total + '명 도전 중';
    } catch { if (mode === 'board') $('board-me').textContent = '순위를 불러오지 못했어요 · 인터넷 연결을 확인해 주세요'; }
  }
  function closeBoard() {
    if (mode !== 'board') return;
    $('board').hidden = true; $('panel').inert = false; $('pause').disabled = false;
    mode = boardFrom; keys.clear(); sync();
  }

  function useMask() {
    if (mode !== 'playing' || resumeLeft > 0 || masks < 1 || masked > 0) return;
    masks--; masked = 4; runStats.masks++; buzz(15);
    if (tut) tutEvent('mask');
    if (taste === 2) toast('♥ …외계인이 가면에 반했다?!');
    else { chase = 0; toast('변장 성공! 못 알아본다'); }
    recordReaction(); tone(240, 0.15); sync();
  }
  // 안드로이드 뒤로가기: 처리했으면 true, 앱을 닫아도 되면 false
  window.neonBack = () => {
    if (!$('share-panel').hidden) { closeShare(); return true; }
    if (mode === 'book') { closeBook(); return true; }
    if (mode === 'journey') { closeJourney(); return true; }
    if (mode === 'intro') { introSkip(); return true; }
    if (mode === 'board') { closeBoard(); return true; }
    if (mode === 'hangar') { closeHangar(); return true; }
    if (mode === 'playing' || mode === 'capture') { pause(); return true; }
    if (mode === 'dying') return true;
    return false;
  };

  // ═══════════════════════════════════════════════════════════════
  // 10. 아이템
  // ═══════════════════════════════════════════════════════════════
  function collect(type, refund = false) {
    const item = items[type];
    if (!item) return;
    const first = !refund && !found[type];
    if (!refund) { found[type] = true; runStats.items++; if (first) runStats.finds++; }
    const deep = elapsed >= GOLD_FROM && !hyperOn(); // 하이퍼(무적) 중에 먹은 것은 황금 조각이 아님
    const piece = refund ? '' : addPiece(type, deep); // 3번째 = 장식 해금, 깊은 궤도 3번 = 황금 장식
    if (first || piece) burst(playerX, playerY, '#fff1aa');
    const newDress = !refund && type !== 'mask' && !runDress[type];
    if (!refund && type !== 'mask') runDress[type] = true;
    if (item.group !== 'supply') { charm = type; charmLeft = 12; }
    if (type === 'rabbit') { if (lives >= 2) points += PTS.overflow; else lives++; }
    if (type === 'cat') magnetLeft = 8;
    if (type === 'chick') slowLeft = 6;
    if (type === 'crown') doubleLeft = 12;
    if (type === 'diamond') points += PTS.diamond;
    if (type === 'disco') {
      const old = obstacles.length;
      obstacles = obstacles.filter((o) => Math.hypot(o.x + 17 - playerX, o.y + 17 - playerY) > 180);
      points += (old - obstacles.length) * PTS.discoRock;
      for (let i = 0; i < 22; i++)
        particles.push({ x: playerX + (Math.random() - 0.5) * 260, y: playerY + (Math.random() - 0.5) * 260, life: 1 });
    }
    if (type === 'moustache') { confusedLeft = 4; chase = 0; }
    if (type === 'fish') { if (doll) points += PTS.fish; else doll = true; }
    if (type === 'mask' || type === 'duck') {
      const amount = type === 'duck' ? 2 : 1, added = Math.min(3 - masks, amount);
      masks += added; points += (amount - added) * PTS.overflow;
    }
    points += PTS.item; score = Math.floor(points);
    if (!refund) addGauge(GAUGE_ITEM);
    recordReaction();
    const n = counts[type] || 0;
    const g = gold[type] || 0;
    if (refund) toast('{' + type + '} 되찾음!');
    else if (piece === 'gold') toast('★ 황금 장식!! {' + type + '} 번쩍번쩍', 3.4);
    else if (first && type !== 'mask') toast('새 발견! {' + type + '} ' + item.name + ' · ' + item.effect, 3.2);
    else if (newDress && dressCount() >= 3 && [3, 6, 9].includes(dressCount())) toast('{' + type + '} ' + item.name + ' · 기체 ' + RANKS[dressTier()] + '!', 2.6);
    else if (type !== 'mask' && deep && !golden(type))
      toast('{' + type + '} ' + item.name + ' · 반짝 조각 ' + Math.min(g, GOLD_PIECES) + '/' + GOLD_PIECES + ' ✦');
    else toast('{' + type + '} ' + item.name + ' · ' + item.effect);
    if (newDress) setTimeout(() => tip('piece', '먹은 아이템은 이번 판 동안 기체에 달려요 · 게임오버면 다 떨어져요!'), 3300);
    burst(playerX, playerY, '#d8bcff'); tone(piece ? 980 : 760); buzz(piece ? 40 : 12); sync();
    if (tut && !refund) tutEvent('item');
  }
  function nextItem() {
    if (itemIndex++ % 4 === 3) return 'mask';
    if (!itemBag.length) {
      itemBag = [...DRESS_KEYS]; bagNo++;
      for (let i = itemBag.length - 1; i > 0; i--) {
        const j = Math.floor(rnd(9000 + bagNo, i) * (i + 1));
        [itemBag[i], itemBag[j]] = [itemBag[j], itemBag[i]];
      }
      if (itemBag[itemBag.length - 1] === lastItem)
        [itemBag[0], itemBag[itemBag.length - 1]] = [itemBag[itemBag.length - 1], itemBag[0]];
    }
    return (lastItem = itemBag.pop());
  }

  // ═══════════════════════════════════════════════════════════════
  // 11. 근접 회피 보너스 · 이펙트
  // ═══════════════════════════════════════════════════════════════
  function burst(x, y, color = '#ffe5a0') {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      sparkles.push({ x, y, vx: Math.cos(a) * 65, vy: Math.sin(a) * 65, life: 0.5, color });
    }
  }
  function graze(x, y) {
    if (invincible > 0 || hyperLeft > 0) return;
    nearCombo = nearClock > 0 ? Math.min(8, nearCombo + 1) : 1;
    nearClock = 2;
    points += 10 + nearCombo * 5;
    runStats.near++; runStats.combo = Math.max(runStats.combo, nearCombo);
    burst(x, y); tone(390 + nearCombo * 65, 0.045); buzz(8);
    tip('near', '아슬아슬 스치면 보너스 + 하이퍼 게이지!');
    addGauge(GAUGE_NEAR);
  }

  // ═══ 하이퍼 드리프트 ═══
  const hyperOn = () => hyperLeft > 0;
  // 세상 속도 배율: 하이퍼 중 HYPER_MUL, 끝나면 HYPER_EASE초 동안 1로 감속
  const worldMul = () => (hyperLeft > 0 ? HYPER_MUL : hyperEase > 0 ? 1 + (HYPER_MUL - 1) * (hyperEase / HYPER_EASE) : 1);
  function addGauge(n) {
    if (tut || hyperCharged || hyperOn() || mode !== 'playing') return;
    hyperGauge = Math.min(HYPER_GAUGE, hyperGauge + n);
    if (hyperGauge >= HYPER_GAUGE) chargeHyper();
  }
  function chargeHyper() {
    hyperCharged = true;
    tone(1180, 0.12); buzz(30);
    activateHyper(); // 자동 발동
    if (!tips.hyper) setTimeout(() => tip('hyper', '폭주 중엔 무적! 운석도 UFO도 그냥 박으면 돼요'), 1600);
  }
  function activateHyper() {
    if (mode !== 'playing' || resumeLeft > 0 || !hyperCharged || hyperOn()) return;
    hyperCharged = false; hyperGauge = 0; hyperLeft = HYPER_TIME; hyperEase = 0; nearCombo = 0; nearClock = 0;
    runStats.hypers++;
    // (선택) 대가: 가면·목숨·켜진 효과가 우수수 튕겨 나감. 자동 발동에선 HYPER_COST = false로 꺼 둠.
    const lost = [];
    if (HYPER_COST) {
    for (let i = 0; i < masks; i++) lost.push('mask');
    for (let i = 0; i < lives; i++) lost.push('rabbit');
    if (doubleLeft > 0) lost.push('crown');
    if (magnetLeft > 0) lost.push('cat');
    if (slowLeft > 0) lost.push('chick');
    if (confusedLeft > 0) lost.push('moustache');
    if (charmLeft > 0 && items[charm] && !lost.includes(charm)) lost.push(charm);
    if (weaponLeft > 0) lost.push('sparkle');
    masks = 0; lives = 0; masked = 0; doubleLeft = magnetLeft = slowLeft = confusedLeft = charmLeft = 0;
    weaponLeft = 0; bullets = [];
    hyperLost = lost.filter((k) => k !== 'sparkle');
    lost.forEach((k, i) => {
      const a = -Math.PI / 2 + (i - (lost.length - 1) / 2) * 0.5;
      spills.push({ k, x: playerX, y: playerY, vx: Math.cos(a) * (120 + Math.random() * 60), vy: Math.sin(a) * 200 - 40, spin: 0, life: 1.4 });
    });
    }
    burst(playerX, playerY, '#fff1aa'); burst(playerX, playerY, '#a5f8d5');
    splash('⚡ 귀여움 폭주!!', 'HYPER DRIFT · 4초 무적 · ' + (boss ? '모선한테 박치기!' : '다 박아!'), 'hyper', 1.5);
    tone(1400, 0.2); buzz(60); sync();
  }
  function endHyper() {
    hyperEase = HYPER_EASE; invincible = Math.max(invincible, 1.2); // 끝나자마자 맞는 억울함 방지
    // 만회: 떨어뜨린 것 중 최대 HYPER_REFUND개를 앞쪽에 다시 떨어뜨림 (조각·도감 집계에는 안 들어감)
    const back = hyperLost.slice().sort(() => Math.random() - 0.5).slice(0, HYPER_REFUND);
    back.forEach((k, i) => pickups.push({ x: clamp(playerX + (i ? 70 : -70) * (Math.random() < 0.5 ? 1 : -1), 40, width - 40), y: playerY - 230, type: k, speed: 70 * pace(), refund: true }));
    hyperLost = [];
    toast(back.length ? '폭주 끝 · 떨어진 템 다시 잡아요!' : '폭주 끝 · 잠깐 무적 남았어요', 2.2);
    tone(520, 0.15);
  }
  // 하이퍼 중 운석 충돌 = 부수기
  function smash(o) {
    burst(o.x + 17, o.y + 17, '#ffe6a0');
    for (let i = 0; i < 3; i++) bolts.push({ x: o.x + 17, y: o.y + 17, vx: (Math.random() - 0.5) * 240, vy: -80 - Math.random() * 120, life: 0.6 });
    o.y = height + 100; runStats.smashed++; points += PTS.smash;
  }
  // UFO 근접: 가까이 왔다가(1~1.6) 잡히지 않고 멀어졌을 때(≥1.6)만 보너스.
  function ufoNear(n, d, x, y, dt) {
    n.cd = Math.max(0, n.cd - dt);
    if (d < 1.6) { if (n.cd <= 0 && invincible <= 0) n.armed = true; }
    else if (n.armed) { n.armed = false; n.cd = 2; graze(x, y); }
  }
  function rockHit(x, y) { return obstacles.find((o) => Math.hypot((o.x + 17 - x) / 43, (o.y + 17 - y) / 29) < 1); }

  // ═══════════════════════════════════════════════════════════════
  // 12. 충돌 흔적 · 별탄 무기
  // ═══════════════════════════════════════════════════════════════
  // v0.17.1 부스러기 운석: 작고 빠르고 불규칙하게 떨어짐. 맞아도 안 죽고 기체가 찌그러질 뿐(웃음 포인트).
  function updatePebbles(dt, py) {
    if (!tut && elapsed > 5 && !boss) {
      pebbleClock -= dt;
      if (pebbleClock <= 0) {
        pebbleNo++;
        const k = 7000 + pebbleNo, many = 1;
        pebbleClock = 3.5 + rnd(k, 1) * 3;
        for (let i = 0; i < many; i++) {
          const size = 6 + Math.round(rnd(k, 2 + i) * 4);
          pebbles.push({ x: 20 + rnd(k, 4 + i) * (width - 40), y: flipOn() ? height + 10 : -14, r: size,
            vy: rowSpeed() * (1.15 + rnd(k, 6 + i) * 0.45) * dirY(), vx: (rnd(k, 8 + i) - 0.5) * 70, spin: rnd(k, 10 + i) * 6.28 });
        }
      }
    }
    for (const p of pebbles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 8 || p.x > width - 8) p.vx = -p.vx;
      const d = Math.hypot(playerX - p.x, py - p.y);
      if (d < p.r + 15) {
        burst(p.x, p.y, '#d8c7ec'); p.y = height * 3;
        if (hyperOn()) { points += 2; continue; }
        if (invincible > 0) continue;
        dentShip(p.x); squishLeft = 0.55; dentHeal = 9; buzz(25);
        squishText = { x: playerX, y: py - 40, t: 0.8, s: ['찌그럭!', '콩!', '아야!', '뿌직!'][pebbleNo % 4] };
      }
    }
    pebbles = pebbles.filter((p) => p.y < height + 30 && p.y > -40);
    if (dents.length && (dentHeal -= dt) <= 0) { dents.shift(); dentHeal = 6; } // 찌그러진 곳은 천천히 펴짐
    squishLeft = Math.max(0, squishLeft - dt);
    if (squishText && (squishText.t -= dt) <= 0) squishText = null;
  }
  function drawPebbles() {
    const P = planet();
    for (const p of pebbles) {
      const x = S(p.x), y = S(p.y), up = Math.sign(p.vy) || 1;
      ctx.strokeStyle = P.rockLite + '88'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(x, y - up * (p.r + 2)); ctx.lineTo(x - p.vx * 0.06, y - up * (p.r + 14)); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.round((p.spin + elapsed * 3) / (Math.PI / 4)) * (Math.PI / 4));
      ctx.fillStyle = P.rock; ctx.beginPath();
      for (let j = 0; j < 6; j++) { const a = (j * Math.PI * 2) / 6, rr = p.r * (j % 2 ? 0.8 : 1); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); ellipse(-p.r * 0.3, -p.r * 0.2, p.r * 0.3, p.r * 0.25, P.rockDark);
      ctx.restore();
    }
    if (squishText) labels.push({ s: squishText.s, x: S(squishText.x), y: S(squishText.y - (0.8 - squishText.t) * 30), font: "16px 'OnePop', sans-serif", color: '#ffc69a' });
  }
  function dentShip(x) {
    impactSide = x < playerX ? -1 : 1; impactLeft = 0.38;
    dents.push(impactSide); if (dents.length > 3) dents.shift();
    for (let i = 0; i < 5; i++)
      bolts.push({ x: playerX + impactSide * 15, y: playerY + 8, vx: impactSide * (45 + Math.random() * 60), vy: -55 - Math.random() * 60, life: 0.8 });
    burst(playerX + impactSide * 13, playerY, '#ffc69a'); tone(115, 0.12);
  }
  const weaponTime = () => WEAPON_TIME + (perks.fuel ? PERKS.fuel.bonus : 0);
  function armWeapon() {
    const up = weaponLv < WEAPON_MAX;
    if (up) weaponLv++;
    weaponLeft = weaponTime(); shotClock = 0; weaponDrop = null;
    const secs = Math.round(weaponLeft) + '초';
    if (up && weaponLv > 1) {
      splash('★ 별탄 LV' + weaponLv + '!', (weaponLv === 2 ? '양옆 대각선 추가' : '가운데 왕별탄 · 2배 피해') + ' · ' + secs, 'win', 1.6);
      burst(playerX, playerY, '#a5f8d5'); tone(1175, 0.14);
    } else toast(up ? '★ 쌍발 별탄 장착! ' + secs + ' · 또 먹으면 LV업' : '★ 별탄 MAX 재충전! ' + secs);
    burst(playerX, playerY, '#fff2a6'); tone(900, 0.13); buzz(30);
    if (tut) tutEvent('weapon');
  }
  // 무기 캡슐은 다음 운석 줄 사이에 떨어집니다(spawnMidDrop). 직전 빈칸에서 60~160px 옆이라 직접 먹으러 가야 합니다.
  function dropWeapon() { weaponPending = true; }
  function updateCombat(dt) {
    if (!tut && elapsed >= weaponAt) { weaponAt += 30; if (!weaponDrop && !weaponPending) dropWeapon(); }
    if (weaponDrop) {
      weaponDrop.y += weaponDrop.speed * (slowLeft > 0 ? 0.55 : 1) * worldMul() * dt;
      if (Math.hypot(weaponDrop.x - playerX, weaponDrop.y - playerY) < 34) armWeapon();
      else if (weaponDrop.y > height + 30 || weaponDrop.y < -70) weaponDrop = null;
    }
    if (weaponLeft > 0) {
      weaponLeft = Math.max(0, weaponLeft - dt);
      if (weaponLeft === 0) { bullets = []; toast('별탄 끝'); tone(220, 0.12); }
      else {
        shotClock -= dt;
        if (shotClock <= 0) {
          const dy = dirY(); // 역방향이면 아래로 발사
          for (const side of [-1, 1]) bullets.push({ x: playerX + side * 24, y: playerY - 20 * dy, vx: 0, life: 1.5, dy });
          if (weaponLv >= 2) for (const side of [-1, 1]) bullets.push({ x: playerX + side * 28, y: playerY - 14 * dy, vx: side * 120, life: 1.5, diag: true, dy });
          if (weaponLv >= 3) bullets.push({ x: playerX, y: playerY - 34 * dy, vx: 0, life: 1.5, dmg: 2, big: true, dy });
          shotClock += 0.2; tone(weaponLeft < 3 ? 500 : 650, 0.025);
        }
      }
    }
    primarySpin = Math.max(0, primarySpin - dt);
    for (const b of bullets) {
      b.y -= 420 * dt * (b.dy || 1); b.x += (b.vx || 0) * dt; b.life -= dt;
      let hit = false;
      const dmg = b.dmg || 1, br = b.big ? 29 : 23;
      const rock = obstacles.find((o) => Math.hypot(b.x - o.x - 17, b.y - o.y - 17) < br);
      if (rock) { obstacles.splice(obstacles.indexOf(rock), 1); burst(rock.x + 17, rock.y + 17, '#d8c7ec'); points += PTS.starRock; hit = true; runStats.rocks++; }
      // 모선: 별탄 1발 = 체력 1
      if (!hit && boss && boss.enter <= 0 && Math.abs(b.x - boss.x) < 74 && Math.abs(b.y - boss.y) < 32) { burst(b.x, b.y - 6, '#ffdf9d'); damageBoss(dmg); hit = true; }
      // UFO: 1발 = 체력 1. 맞으면 살짝 밀리고 번쩍 — 더 이상 빙글빙글 돌며 무적이 되지 않음
      if (!hit && !boss && primaryGone <= 0 && Math.hypot((b.x - ufoX) / 43, (b.y - ufoY) / 28) < 1) {
        ufoY = Math.max(150, ufoY - 4); burst(b.x, b.y - 6, '#ffdf9d'); damagePrimary(dmg); hit = true;
      }
      if (!hit && !boss) {
        const v = visitors.find((v) => !v.dead && v.grace <= 0 && Math.hypot((b.x - v.x) / 43, (b.y - v.y) / 28) < 1);
        if (v) { v.y = Math.max(150, v.y - 4); burst(b.x, b.y - 6, '#ffdf9d'); damageVisitor(v, dmg); hit = true; }
      }
      if (hit) b.life = 0;
    }
    bullets = bullets.filter((b) => b.life > 0 && ((b.dy || 1) > 0 ? b.y > 115 : b.y < height - 40) && b.x > -20 && b.x < width + 20);
    visitors = visitors.filter((v) => !v.dead);
    primaryFlash = Math.max(0, primaryFlash - dt);
    score = Math.floor(points);
  }

  // ═══════════════════════════════════════════════════════════════
  // 13. 외계인 (주 UFO · 추가 UFO)
  // ═══════════════════════════════════════════════════════════════
  function interested() {
    if (confusedLeft > 0) return false;
    return masked > 0 ? taste === 2 : charmLeft > 0 && items[charm]?.group === tastes[taste].type;
  }
  function capture(hitX = ufoX, hitY = ufoY, guest = null) {
    if (flipOn()) endFlip(true);
    if (doll) dentShip(hitX, hitY);
    captureBy = guest; cause = guest && guest.boss ? '모선 집게' : guest ? '추가 UFO' : '주 UFO'; buzz(80);
    mode = 'capture'; sceneTime = 0; sceneX = playerX; sceneY = playerY; sceneReturn = doll ? 'playing' : 'over';
    keys.clear(); dragging = false;
    primaryNear.armed = false; for (const v of visitors) v.armed = false;
    $('scene-caption').hidden = false; $('scene-caption').classList.remove('count'); $('scene-caption').textContent = ''; $('notice').textContent = '';
    sync(); tone(180, 0.25);
  }
  function moveAlien(dt) {
    if (boss) { primaryNear.armed = false; return; } // 모선전: UFO들은 모선 뒤로 숨음
    if (primaryGone > 0) {
      primaryGone -= dt; primaryNear.armed = false;
      if (primaryGone <= 0) {
        primaryGone = 0; ufoX = width / 2; ufoY = -40; alienPhase = 'recover'; alienClock = 0;
        toast('UFO 재등장 — 이번엔 체력 ' + primaryMax);
      }
      return;
    }
    if (primaryStun > 0) {
      primaryStun -= dt; primaryNear.armed = false;
      ufoX = clamp(ufoX + dashVX * dt * 0.3, 42, width - 42);
      ufoY = clamp(ufoY + dashVY * dt * 0.3, 160, height - 115);
      return;
    }
    recordReaction();
    const hidden = confusedLeft > 0 || (masked > 0 && !interested());
    alienClock += dt;
    if (hidden) {
      alienPhase = 'retreat'; primaryNear.armed = false;
      ufoY += ((flipOn() ? height - 125 : 170) - ufoY) * (1 - Math.exp(-2.2 * dt));
      ufoX = clamp(ufoX + Math.sin(elapsed * 2) * 35 * dt, 42, width - 42);
      return;
    }
    if (alienPhase === 'retreat') { alienPhase = 'patrol'; alienClock = 0; }
    const fast = stage >= 2; // 후반에는 조준 간격이 짧아집니다
    const early = elapsed < 30 ? 1.4 : 1; // 처음 30초는 조준 간격을 길게(숨 돌릴 시간)
    if (alienPhase === 'patrol' && swirlReady()) {
      alienPhase = 'swirl'; alienClock = 0; swirlArmed = false; dashX = playerX; dashY = playerY;
      tip('swirl', '{swirl} 빙글 구슬! 맞으면 10초 동안 거꾸로 비행 · 피하거나 별탄으로 터뜨려요');
    } else if (alienPhase === 'swirl') {
      // 빙글 구슬 예고: 멈칫하며 조준(0.55초까지 기체를 따라봄) → 1.05초에 발사. 점선과 빙글 고리로 보여 줌.
      if (alienClock < 0.55) { dashX = playerX; dashY = playerY; }
      if (alienClock > 1.05) {
        const dx = dashX - ufoX, dy = dashY - ufoY, d = Math.hypot(dx, dy) || 1, sp = ORB_SPEED * pace();
        swirlOrb = { x: ufoX, y: ufoY + 14 * Math.sign(dy || 1), vx: (dx / d) * sp, vy: (dy / d) * sp, t: 0 };
        alienPhase = 'recover'; alienClock = 0; tone(720, 0.1);
      }
    } else if (alienPhase === 'patrol') {
      const tx = width / 2 + Math.sin(elapsed * 1.1) * Math.max(20, width / 2 - 55), span = Math.max(30, minY() - 160), ty0 = 160 + span * 0.4 + Math.sin(elapsed * 0.9) * Math.min(45, span * 0.38);
      const ty = flipOn() ? height - 115 - (ty0 - 160) : ty0; // 역방향: 아래쪽에서 맴돎
      ufoX += (tx - ufoX) * (1 - Math.exp(-1.7 * dt));
      ufoY += (ty - ufoY) * (1 - Math.exp(-1.5 * dt));
      // 귀여울수록 위험: 함께 다니는 친구 1명당 조준 간격 -0.15초
      // 처음 8초는 돌진하지 않음
      if (elapsed > 8 && alienClock > Math.max(1, (interested() ? (fast ? 1.3 : 1.6) : fast ? 2.6 : 3.2) * early - 0.15 * friendCount())) {
        alienPhase = 'aim'; alienClock = 0; dashX = playerX; dashY = playerY;
        tip('aim', '점선 = 돌진 예고! 옆으로 피하거나 톡 쳐서 변장');
      }
    } else if (alienPhase === 'aim') {
      if (alienClock < 0.35) { dashX = playerX; dashY = playerY; }
      if (alienClock > 0.72) {
        const dx = dashX - ufoX, dy = dashY - ufoY, d = Math.hypot(dx, dy) || 1, speed = (interested() ? 260 : 220) * pace();
        dashVX = (dx / d) * speed; dashVY = (dy / d) * speed; alienPhase = 'dash'; alienClock = 0;
      }
    } else if (alienPhase === 'dash') {
      ufoX = clamp(ufoX + dashVX * dt, 42, width - 42);
      ufoY = clamp(ufoY + dashVY * dt, 160, height - 115);
      if (alienClock > 1.25) { alienPhase = 'recover'; alienClock = 0; }
    } else if (alienPhase === 'recover') {
      const ry = 160 + Math.max(30, minY() - 160) * 0.22; ufoY += ((flipOn() ? height - 115 - (ry - 160) : ry) - ufoY) * (1 - Math.exp(-1.6 * dt));
      ufoX += (width / 2 - ufoX) * dt * 0.4;
      if (alienClock > 1.6) { alienPhase = 'patrol'; alienClock = 0; }
    }
    const hit = rockHit(ufoX, ufoY);
    if (hit) {
      primaryStun = 1.1; alienPhase = 'recover'; alienClock = 0;
      dashVX = (ufoX - hit.x - 17) * 6; dashVY = (ufoY - hit.y - 17) * 6;
      burst(ufoX, ufoY, '#c8e7d3'); tone(140, 0.07);
      return;
    }
    const near = Math.hypot((playerX - ufoX) / 42, (playerY - ufoY) / 32);
    if (hyperOn() && near < 1) { // 하이퍼: 주 UFO를 튕겨 냄
      primaryStun = 1.8; primarySpin = 1.1; alienPhase = 'recover'; alienClock = 0;
      dashVX = (ufoX - playerX) * 3; dashVY = -260;
      ramFx((ufoX + playerX) / 2, (ufoY + playerY) / 2, false); damagePrimary(Math.max(1, primaryHp)); // 한 방 격추
      toast('쾅! 박치기 한 방 격추! ★+' + STAR_UFO, 2);
    } else if (invincible <= 0 && near < 1) { if (tut) tutBumpUfo(); else capture(); }
    else ufoNear(primaryNear, near, ufoX, ufoY, dt);
  }
  function spawnVisitor() {
    const side = visitors.length % 2;
    visitors.push({ x: side ? width - 48 : 48, y: 180, vx: side ? -78 : 78, vy: 64, stun: 0, spin: 0, grace: 1.5,
      armed: false, cd: 0, color: side ? '#efaec8' : '#9bded3', hp: VISITOR_HP, max: VISITOR_HP, flash: 0 });
    toast('UFO 한 대 더 왔다!');
  }
  function moveVisitors(dt) {
    if (boss) return;
    visitorSpawn -= dt;
    if (visitorSpawn <= 0 && visitors.length < 2) { spawnVisitor(); visitorSpawn = 25; }
    for (const v of visitors) {
      v.stun = Math.max(0, v.stun - dt); v.spin = Math.max(0, v.spin - dt); v.grace = Math.max(0, v.grace - dt); v.flash = Math.max(0, (v.flash || 0) - dt);
      if (v.grace > 0) v.x = clamp(v.x, 44, width - 44);
      const hidden = confusedLeft > 0 || (masked > 0 && taste !== 2);
      if (hidden) { v.armed = false; v.y += (165 - v.y) * dt * 2; continue; }
      const factor = v.stun > 0 ? 0.35 : 1;
      v.x += v.vx * dt * factor * pace(); v.y += v.vy * dt * factor * pace();
      if (v.x < 44 || v.x > width - 44) { v.x = clamp(v.x, 44, width - 44); v.vx *= -1; }
      if (v.y < 160 || v.y > height - 115) { v.y = clamp(v.y, 160, height - 115); v.vy *= -1; }
      const rock = v.stun <= 0 && rockHit(v.x, v.y);
      if (rock) {
        const dx = v.x - rock.x - 17, dy = v.y - rock.y - 17, d = Math.hypot(dx, dy) || 1;
        v.vx = (dx / d) * 100; v.vy = (dy / d) * 100; if (Math.abs(v.vx) < 25) v.vx = 25;
        v.stun = 1.1; burst(v.x, v.y, '#c7eddf'); tone(150, 0.07);
      }
      const d = Math.hypot((playerX - v.x) / 42, (playerY - v.y) / 32);
      if (hyperOn() && d < 1 && v.stun <= 0) {
        v.stun = 1.8; v.spin = 1.1; v.vy = -Math.max(120, Math.abs(v.vy)); v.vx = v.x < playerX ? -140 : 140;
        ramFx((v.x + playerX) / 2, (v.y + playerY) / 2, false); damageVisitor(v, Math.max(1, v.hp)); toast('쾅! 박치기 한 방 격추! ★+' + STAR_VISITOR, 2); continue;
      }
      if (v.stun <= 0 && v.grace <= 0 && invincible <= 0 && !hyperOn() && d < 1) { capture(v.x, v.y, v); return; }
      if (v.grace <= 0 && v.stun <= 0) ufoNear(v, d, v.x, v.y, dt);
      else v.armed = false;
    }
    // 추가 UFO끼리 튕김 (원반 폭에 맞춰 88px)
    const R = 88;
    for (let i = 0; i < visitors.length; i++)
      for (let j = i + 1; j < visitors.length; j++) {
        const a = visitors[i], b = visitors[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d > 0 && d < R) {
          const nx = dx / d, ny = dy / d, shift = (R - d) / 2;
          a.x -= nx * shift; a.y -= ny * shift; b.x += nx * shift; b.y += ny * shift;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            a.vx += rv * nx; a.vy += rv * ny; b.vx -= rv * nx; b.vy -= rv * ny;
            burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#dccbff');
          }
        }
      }
  }


  // ═══════════════════════════════════════════════════════════════
  // 13-B. 격퇴 · 행성 여정 · 모선(보스) · 친구 구출
  // ═══════════════════════════════════════════════════════════════
  const planet = () => PLANETS[planetIdx % PLANETS.length];
  const lap = () => Math.floor(planetIdx / PLANETS.length);
  const friendCount = () => FRIEND_KEYS.filter((k) => runFriends[k]).length; // 이번 판에 함께 다니는 친구
  const everFriends = () => FRIEND_KEYS.filter((k) => friends[k]).length; // 구출 기록
  function ufoBoom(x, y, color) {
    burst(x, y, '#ffe6a0'); burst(x, y, color);
    for (let i = 0; i < 8; i++) bolts.push({ x, y, vx: (Math.random() - 0.5) * 260, vy: -60 - Math.random() * 160, life: 0.9 });
    tone(160, 0.2); buzz(50);
  }
  // 격퇴된 외계인은 작은 탈출 캡슐을 타고 울면서 도망갑니다(귀여운 분위기 유지).
  function podEscape(x, y, color) { escapes.push({ x, y, vx: (Math.random() - 0.5) * 70, vy: -150, life: 1.8, color }); }
  function damagePrimary(n) {
    primaryHp -= n; primaryFlash = 0.12; points += PTS.ufoHit * n; runStats.ufoHits++;
    if (primaryHp <= 0) defeatPrimary();
  }
  function defeatPrimary() {
    ufoBoom(ufoX, ufoY, '#bca5eb'); podEscape(ufoX, ufoY - 10, '#bca5eb');
    points += PTS.ufoKill; runStats.kills++; addGauge(GAUGE_KILL);
    spawnCoins(ufoX, ufoY, STAR_UFO); if (!tut) dropLoot('antenna', ufoX, ufoY); // 연습 중엔 전리품 없음(끝 알림과 겹치지 않게)
    if (!doll) { doll = true; toast('격추! {doll} 인형 되찾았다 · ★+' + STAR_UFO, 3.4); }
    else toast('격추! 외계인 울면서 탈출 · ★+' + STAR_UFO, 3);
    primaryGone = UFO_RESPAWN; primaryMax += UFO_HP_STEP; primaryHp = primaryMax;
    primaryStun = 0; primarySpin = 0; primaryNear.armed = false; alienPhase = 'patrol';
    if (tut) tutEvent('kill');
    if (!tips.kill) setTimeout(() => tip('kill', '격추할수록 다음 UFO는 튼튼해져요 · 뺏긴 인형도 되찾아요'), 3200);
  }
  function damageVisitor(v, n) {
    v.hp -= n; v.flash = 0.12; points += PTS.ufoHit * n; runStats.ufoHits++;
    if (v.hp <= 0 && !v.dead) {
      v.dead = true; ufoBoom(v.x, v.y, v.color); podEscape(v.x, v.y - 10, v.color);
      points += PTS.visitorKill; runStats.kills++; addGauge(GAUGE_KILL); toast('격추! ★+' + STAR_VISITOR);
      spawnCoins(v.x, v.y, STAR_VISITOR); dropLoot('saucer', v.x, v.y);
    }
  }

  function ramFx(x, y, big) {
    hitStop = big ? 0.08 : 0.05; shake = big ? 0.28 : 0.16;
    burst(x, y, '#ffe6a0'); burst(x, y, '#a5f8d5');
    for (let i = 0; i < (big ? 10 : 6); i++) bolts.push({ x, y, vx: (Math.random() - 0.5) * 300, vy: -40 - Math.random() * 200, life: 0.8 });
    tone(big ? 90 : 140, 0.18); buzz(big ? 80 : 50);
  }
  // 지금 목표 한 줄: 다음에 구할 친구와 모선
  function goalTarget() {
    const i = PLANETS.findIndex((P) => !runFriends[P.friend]);
    return i < 0 ? null : { i, P: PLANETS[i] };
  }
  function nextGoalText(inRun) {
    const P = planet();
    if (inRun) return P.boss.subj + ' 기다려요 · ' + Math.round(P.len) + '초 버티면 등장';
    const g = goalTarget();
    if (!g) return '이번 판에 친구를 모두 구했어요! 2회차 모선에 도전해요';
    const via = g.i === 1 ? PLANETS[0].name + '을 지나 ' : g.i >= 2 ? '행성 ' + g.i + '개를 지나 ' : '';
    return via + g.P.name + '의 모선 ' + g.P.boss.obj + ' 격퇴하고 {' + g.P.friend + '} ' + FRIENDS[g.P.friend].name + ' 구하기';
  }
  function renderGoal() {
    // 친구 칸: 구출 기록이 있으면 실루엣으로 보여 줌(이번 판에 다시 구해야 함)
    const slots = FRIEND_KEYS.map((k) => (friends[k] ? icon(k, 'ico big seen') : '<span class="q">?</span>')).join('');
    const rec = everFriends() ? '최고 기록 · 친구 ' + everFriends() + '명 · ' + PLANETS[Math.min(PLANETS.length - 1, reached)].name : '아직 아무도 못 구했어요';
    $('goal').innerHTML = '<small>목표 · 한 판에 잡혀간 친구 3명을 구하라</small><div class="goal-slots">' + slots + '<em></em></div><p></p>';
    $('goal').querySelector('em').textContent = rec;
    $('goal').querySelector('p').innerHTML = rich('첫 목표: ' + nextGoalText(false) + (refundNote ? '<br>장식이 판마다 새로 모으는 방식으로 바뀌어서 ★' + refundNote + '을 돌려 드렸어요' : ''));
  }
  function spawnBoss() {
    const P = planet(), L = lap();
    const hp = Math.round(P.boss.hp * (1 + 0.5 * L));
    boss = { x: width / 2, y: -80, ty: HUD_BAND + 62, hp, max: hp, t: 0, enter: 1.6, atk: 2.6, flip: 0, claw: null, flash: 0, P, L, ramCd: 0, dizzy: 0, cracks: 0 };
    orbs = []; bossSupply = 10;
    if (planetIdx === 0 && lives < 2) { lives++; setTimeout(() => toast('{rabbit} 방어막 +1 · 첫 모선 서비스'), 3700); } // 첫 모선은 한 번 실수해도 괜찮게
    if (!weaponDrop && weaponLeft <= 0) weaponPending = true; // 모선전에는 별탄 캡슐을 바로 + 계속 보급
    splash('⚠ 모선 등장!!', P.boss.subj + ' {' + P.friend + '} ' + FRIENDS[P.friend].obj + ' 잡고 있어요 · 별탄으로 쏴!', 'boss', 2.2);
    if (!tips.boss) setTimeout(() => tip('boss', '모선은 별탄으로! 캡슐이 계속 떨어져요 · 45초 안에'), 3800);
    tone(120, 0.4); buzz(80);
  }
  function damageBoss(n) {
    if (!boss) return;
    boss.hp -= n; boss.flash = 0.1; points += PTS.bossHit * n;
    if (boss.hp <= 0) defeatBoss();
  }
  function defeatBoss() {
    const b = boss, key = 'boss' + (planetIdx % PLANETS.length), bonus = PTS.boss * (1 + b.L);
    for (let i = 0; i < 4; i++) ufoBoom(b.x + (i - 1.5) * 40, b.y + (i % 2) * 10, b.P.boss.color);
    podEscape(b.x, b.y - 20, b.P.boss.color);
    points += bonus; runStats.bosses++; addGauge(GAUGE_BOSS);
    const first = !arrested[key];
    celebrateBoss(b);
    spawnCoins(b.x, b.y, STAR_BOSS + (first ? STAR_ARREST : 0)); dropLoot('core', b.x, b.y + 10);
    arrested[key] = true; saveProgress();
    rescue = { x: b.x, y: b.y + 10, k: b.P.friend, t: 0 };
    boss = null; orbs = [];
    setTimeout(() => splash('모선 격추!!!', (first ? '현상수배 ' + b.P.boss.short + ' 체포 · ' : '') + '★+' + (STAR_BOSS + (first ? STAR_ARREST : 0)) + ' · 친구가 날아와요', 'win', 2.2), 150);
  }
  function bossFlee() {
    const b = boss;
    boss = null; orbs = [];
    toast('모선이 도망쳤다… ' + FRIENDS[b.P.friend].name.split(' ')[1] + ', 다음엔 꼭!', 3.4);
    nextPlanet();
  }
  function nextPlanet() {
    planetIdx++; tripT = 0; primaryGone = Math.max(primaryGone, 2);
    reached = Math.max(reached, planetIdx); giveStars(STAR_PLANET); saveProgress();
    const P = planet(), L = lap();
    setTimeout(() => { if (mode === 'playing') splash('🪐 ' + P.name, (L ? (L + 1) + '회차 · ' : '') + '다음 타깃 ▸ ' + P.boss.short + ' · ' + P.len + '초 · ★+' + STAR_PLANET, 'planet', 2.2); }, 2300);
  }
  function fireOrbs(b) {
    const a0 = Math.atan2(playerY - b.y, playerX - b.x), n = 3 + Math.min(2, b.L);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i - (n - 1) / 2) * 0.32;
      orbs.push({ x: b.x, y: b.y + 20, vx: Math.cos(a) * 170 * pace(), vy: Math.sin(a) * 170 * pace() });
    }
    tone(880, 0.06);
  }
  function updateBoss(dt) {
    if (rescue) {
      // 구출 캡슐은 기체 쪽으로 둥실 날아옵니다(놓칠 일 없음).
      rescue.t += dt;
      rescue.x += (playerX - rescue.x) * (1 - Math.exp(-2.4 * dt));
      rescue.y += (playerY - 20 - rescue.y) * (1 - Math.exp(-2.4 * dt));
      if (rescue.t > 0.8 && Math.hypot(playerX - rescue.x, playerY - 20 - rescue.y) < 30) {
        const k = rescue.k, f = FRIENDS[k];
        rescue = null;
        runFriends[k] = true; runStats.rescued++;
        const firstEver = !friends[k];
        friends[k] = true; giveStars(firstEver ? STAR_RESCUE : STAR_RESCUE_AGAIN); saveProgress();
        {
          splash('{' + k + '} ' + f.name.split(' ')[1] + ' 구출!!', f.name + ' 합류 · 이번 판 친구 ' + friendCount() + '/' + FRIEND_KEYS.length + ' · ★+' + (firstEver ? STAR_RESCUE : STAR_RESCUE_AGAIN), 'win', 2.2); burst(playerX, playerY, '#ffb6d3'); tone(1046, 0.25); buzz(60);
          if (!tips.cute) setTimeout(() => tip('cute', '친구가 늘면 더 귀여워져서… UFO가 더 노려요'), 3800);
        }
        nextPlanet();
      }
      return;
    }
    if (!boss) { tripT += dt * worldMul(); if (tripT >= planet().len) spawnBoss(); return; }
    const b = boss;
    b.t += dt; b.flash = Math.max(0, b.flash - dt);
    b.y += (b.ty - b.y) * (1 - Math.exp(-3 * dt));
    if (b.enter > 0) { b.enter -= dt; return; }
    b.ramCd = Math.max(0, b.ramCd - dt); b.dizzy = Math.max(0, b.dizzy - dt);
    if (hyperOn()) tip('ram', '폭주 중엔 위로 올라가 모선에 박치기!');
    // 하이퍼 돌진: 모선과 부딪히면 쾅 — 체력 −RAM_BOSS, 위로 튕겨 나감, 창살에 금
    if (hyperOn() && b.ramCd <= 0 && Math.abs(playerX - b.x) < 84 && Math.abs(playerY - b.y) < 46) {
      b.ramCd = RAM_COOLDOWN; b.dizzy = 0.9; b.y -= 26; b.cracks = Math.min(3, b.cracks + 1);
      ramFx((playerX + b.x) / 2, (playerY + b.y) / 2 + 10, true);
      toast(b.cracks >= 3 ? '창살이 흔들린다! 조금만 더!' : '쾅!! 모선 −' + RAM_BOSS, 1.4);
      damageBoss(RAM_BOSS);
      if (!boss) return;
    }
    b.x = width / 2 + Math.sin(b.t * 0.7) * Math.max(10, width / 2 - 82);
    if (b.t > BOSS_TIME) { bossFlee(); return; }
    bossSupply -= dt;
    if (bossSupply <= 0) { bossSupply = 11; if (!weaponDrop && weaponLeft <= 0 && !weaponPending) weaponPending = true; }
    b.atk -= dt;
    if (b.atk <= 0 && !b.claw) {
      const kind = b.P.boss.attack === 'both' ? (b.flip++ % 2 ? 'orbs' : 'claw') : b.P.boss.attack;
      if (kind === 'claw') b.claw = { x: playerX, phase: 'aim', t: 0, y: b.y + 24 };
      else fireOrbs(b);
      b.atk = (kind === 'claw' ? 3.4 : 2.6) / (1 + 0.25 * b.L);
    }
    if (b.claw) {
      const c = b.claw;
      c.t += dt;
      const warn = planetIdx === 0 ? 1.3 : 0.95; // 첫 모선은 집게 예고를 길게
      if (c.phase === 'aim') { if (c.t < 0.5) c.x = playerX; if (c.t > warn) { c.phase = 'drop'; c.t = 0; } }
      else if (c.phase === 'drop') { c.y += 900 * pace() * dt; if (c.y > height - 70) { c.y = height - 70; c.phase = 'up'; } }
      else { c.y -= 520 * pace() * dt; if (c.y < b.y + 24) b.claw = null; }
      if (b.claw && c.phase !== 'aim' && Math.abs(playerX - c.x) < 24 && Math.abs(playerY - c.y) < 28) {
        if (hyperOn()) { b.claw = null; burst(c.x, c.y, '#ffe6a0'); damageBoss(3); }
        else if (invincible <= 0) {
          b.claw = null;
          capture(playerX, playerY, { color: b.P.boss.color, stun: 0, spin: 0, grace: 0, boss: true });
          return;
        }
      }
    }
    for (const o of orbs) {
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (Math.hypot(playerX - o.x, playerY - o.y) < 18) {
        if (hyperOn()) { o.dead = true; burst(o.x, o.y, '#fff1a5'); points += PTS.orb; }
        else if (invincible <= 0) {
          o.dead = true;
          if (lives > 0) { lives--; invincible = 2.2; dentShip(o.x); toast('{rabbit} 토끼 귀가 막아 줬다!'); tone(320); buzz(60); }
          else { die('모선의 반짝이 탄에 맞았어요. 한 번 더?', o.x, o.y, '모선 탄'); return; }
        }
      }
    }
    orbs = orbs.filter((o) => !o.dead && o.y < height + 20 && o.y > -20 && o.x > -20 && o.x < width + 20);
  }
  // 함께 다니는 친구들: 기체의 지난 위치를 따라옵니다(꾸미기처럼 외형만, 능력 없음).
  function drawCompanions() {
    FRIEND_KEYS.filter((k) => runFriends[k]).forEach((k, i) => {
      const p = trail[Math.max(0, trail.length - 1 - 10 * (i + 1))] || [playerX, playerY];
      const side = i % 2 ? 1 : -1;
      ctx.save(); ctx.translate(S(p[0] + side * (34 + 6 * i)), S(p[1] + 26 * dirY() + Math.sin(tick / 12 + i) * 3)); ctx.scale(0.75, 0.75);
      drawIcon(ctx, k); ctx.restore();
    });
  }
  function drawBoss() {
    const b = boss;
    if (!b) return;
    const x = S(b.x), y = S(b.y), col = b.P.boss.color;
    if (b.claw) {
      const c = b.claw, cx = S(c.x);
      if (c.phase === 'aim') {
        ctx.save(); ctx.strokeStyle = '#ffb6d3aa'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
        ctx.beginPath(); ctx.moveTo(cx, y + 24); ctx.lineTo(cx, height - 70); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(cx, S(playerY), 24 + ((tick >> 3) & 1) * 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      } else {
        const cy = S(c.y);
        ctx.strokeStyle = '#e2d6f6'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, y + 20); ctx.lineTo(cx, cy); ctx.stroke();
        ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(cx - 14, cy + 2); ctx.lineTo(cx - 10, cy + 14); ctx.moveTo(cx + 14, cy + 2); ctx.lineTo(cx + 10, cy + 14);
        ctx.moveTo(cx - 14, cy + 2); ctx.lineTo(cx + 14, cy + 2); ctx.stroke();
      }
    }
    ctx.save(); ctx.translate(x, y);
    ellipse(0, -14, 44, 34, '#9ddbd9'); ellipse(0, -16, 22, 21, '#e2f6ff');
    ctx.save(); ctx.translate(0, -16); ctx.scale(1.1, 1.1); drawIcon(ctx, b.P.friend); ctx.restore();
    ctx.strokeStyle = '#51435c'; ctx.lineWidth = 2; ctx.beginPath(); // 창살 — 친구가 갇혀 있어요
    for (const bx of [-12, -4, 4, 12]) { ctx.moveTo(bx, -34); ctx.lineTo(bx, 2); }
    ctx.stroke();
    if (b.cracks) { // 들이받은 만큼 돔에 금
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath();
      const cr = [[[-20, -40], [-12, -30], [-18, -22], [-8, -14]], [[22, -38], [14, -28], [20, -18]], [[-4, -46], [2, -36], [-4, -28], [4, -20]]];
      for (let i = 0; i < b.cracks; i++) cr[i].forEach(([cx, cy], j) => (j ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)));
      ctx.stroke();
    }
    ellipse(-34, -12, 9, 8, '#d0efaa'); ellipse(34, -12, 9, 8, '#d0efaa'); // 양옆 외계인 얼굴
    if (b.dizzy > 0) { // 어질어질 — 눈이 소용돌이
      ctx.strokeStyle = '#33314d'; ctx.lineWidth = 1.5;
      for (const ex of [-36, -31, 31, 36]) { ctx.beginPath(); ctx.arc(ex, -13, 2.2, b.t * 12, b.t * 12 + Math.PI * 1.6); ctx.stroke(); }
      labels.push({ s: '@_@', x: b.x, y: b.y - 58, font: '12px monospace', color: '#ffe0f0' });
    } else {
      ellipse(-36, -13, 1.5, 2, '#33314d'); ellipse(-31, -13, 1.5, 2, '#33314d'); ellipse(31, -13, 1.5, 2, '#33314d'); ellipse(36, -13, 1.5, 2, '#33314d');
    }
    if (b.cracks >= 3 && (tick >> 5) & 1) labels.push({ s: '꺼내줘!', x: b.x, y: b.y - 62, font: '12px Arial', color: '#ffb6d3' });
    ellipse(0, 10, 86, 20, col); ellipse(0, 5, 76, 11, '#ded0f9');
    for (let i = -3; i <= 3; i++) ellipse(i * 21, 16, 3, 2, ((tick >> 4) + i + 9) % 3 === 0 ? '#ffffff' : '#ffe7a9');
    if (b.flash > 0) { ctx.globalAlpha = 0.6; ellipse(0, 10, 86, 20, '#ffffff'); ctx.globalAlpha = 1; }
    ctx.restore();
    for (const o of orbs) { ellipse(S(o.x), S(o.y), 9, 9, '#fff1a544'); star(S(o.x), S(o.y), 8, '#fff1a5'); }
  }
  function drawEscapes() {
    for (const e of escapes) {
      const x = S(e.x), y = S(e.y);
      ellipse(x, y + 8, 3, 5 + ((tick >> 2) & 1) * 2, '#ffba8c');
      ellipse(x, y, 9, 8, '#cbe8f1'); ellipse(x, y + 1, 5, 4.5, '#d0efaa');
      ellipse(x - 2, y, 1, 1.3, '#33314d'); ellipse(x + 2, y, 1, 1.3, '#33314d');
      ctx.fillStyle = '#9fe7f3'; ctx.fillRect(x - 3, y + 2, PX, PX); ctx.fillRect(x + 2, y + 2, PX, PX); // 눈물
      if (e.life > 0.9) labels.push({ s: '으앙', x: e.x + 14, y: e.y - 10, font: '11px Arial', color: '#e8dcff' });
    }
    if (rescue) {
      const x = S(rescue.x), y = S(rescue.y);
      ctx.strokeStyle = '#ffb6d3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.stroke();
      ellipse(x, y, 17, 17, '#ffb6d322');
      ctx.save(); ctx.translate(x, y); drawIcon(ctx, rescue.k); ctx.restore();
      labels.push({ s: '♥', x: rescue.x, y: rescue.y - 24, font: '14px Arial', color: '#ffb6d3' });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 14. 운석 줄 · 난이도
  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  // 13-C. 연습 비행 (v0.16 튜토리얼)
  // ═══════════════════════════════════════════════════════════════
  // 처음 한 판은 따라 하면 끝나는 짧은 연습. 실패해도 죽지 않고, 해낼 때마다 다음 단계로.
  // 끝나면 그대로 본게임이 시작됩니다(연습 중 먹은 토끼 귀는 그대로). 시작 화면 '연습 비행'으로 다시 볼 수 있어요.
  const TUT_STEPS = ['move', 'dodge', 'item', 'mask', 'shoot'];
  const TUT_TEXT = {
    move: ['손가락으로 끌어서 움직여 봐', '화면 아무 데나 대고 슥슥 · PC는 방향키'],
    dodge: ['운석이 온다! 빈칸으로 쏙', '빈칸 쪽으로 미리 가 있으면 안전해요'],
    item: ['아이템을 먹어 봐', '먹은 장식은 이번 판 동안 기체에 달려요'],
    mask: ['점선 = 외계인 돌진 예고!', '아래 위장 버튼을 톡 (화면을 톡 쳐도 돼요)'],
    shoot: ['★ 캡슐을 먹고 UFO를 쏴!', '별탄은 자동 발사 · UFO 밑으로 가요'],
  };
  function startTutorial() {
    tut = { step: 0, t: 0, wait: 0, moved: 0, lx: playerX, ly: playerY, spawned: false, passes: 0, failed: false };
    pickups = []; primaryGone = 999; masks = Math.max(masks, 1); taste = 0;
    $('notice').textContent = '';
    coach();
  }
  function coach(okText) {
    const el = $('coach');
    if (!tut) { el.hidden = true; return; }
    const k = TUT_STEPS[tut.step], [main, sub] = TUT_TEXT[k];
    el.hidden = false; el.classList.toggle('ok', !!okText);
    el.innerHTML = '<small></small><b></b><span></span><button type="button" id="coach-skip">건너뛰기</button>';
    el.children[0].textContent = '연습 비행 ' + (tut.step + 1) + '/' + TUT_STEPS.length;
    el.children[1].textContent = okText || main;
    el.children[2].textContent = okText ? '' : sub;
    $('coach-skip').onclick = () => endTutorial(true);
    $('mask').classList.toggle('tut-pulse', k === 'mask' && !okText);
  }
  function enterTutStep() {
    const k = TUT_STEPS[tut.step];
    tut.t = 0; tut.spawned = false; tut.failed = false;
    if (k === 'mask') { primaryGone = 0; ufoX = width / 2; ufoY = -40; alienPhase = 'recover'; alienClock = 0; primaryStun = 0; masks = Math.max(masks, 1); }
    if (k === 'shoot') { primaryHp = primaryMax = 6; }
    coach();
  }
  function tutDone(text) {
    if (!tut || tut.wait > 0) return;
    tut.wait = 1.2; coach(text); burst(playerX, playerY, '#a5f8d5'); tone(1046, 0.12); setTimeout(() => tone(1318, 0.12), 90); buzz(20);
  }
  // 게임 쪽에서 알려 주는 사건: 아이템 먹음 · 위장 · 별탄 장착 · UFO 격추
  function tutEvent(ev) {
    if (!tut || tut.wait > 0) return;
    const k = TUT_STEPS[tut.step];
    if (k === 'item' && ev === 'item') tutDone('장식 획득! 귀가 달렸죠?');
    else if (k === 'mask' && ev === 'mask') tutDone('변장 성공! 못 알아봐요');
    else if (k === 'shoot' && ev === 'weapon') { const el = $('coach'); el.children[1].textContent = 'UFO 밑으로 가서 맞혀!'; el.children[2].textContent = '캡슐을 또 먹으면 별탄 LV업'; }
    else if (k === 'shoot' && ev === 'kill') tutDone('격추!! 이제 진짜 출발');
  }
  function tutRow() {
    const gap = 150, gapX = playerX < width / 2 ? width - gap - 24 : 24, speed = 118 * pace();
    for (let x = 18; x < width - 12; x += 38) {
      if (x + 17 > gapX && x - 17 < gapX + gap) continue;
      obstacles.push({ x: x - 17, y: -40, w: 34, h: 34, speed, spin: Math.random() * 6.28, vx: 0, close: false, grazed: false, tut: true });
    }
    tut.spawned = true; tut.failed = false;
  }
  function tutHitRock(o) {
    dentShip(o.x + 17); invincible = 1.2;
    for (const r of obstacles) if (r.tut) r.y = height + 100;
    o.y = height + 100;
    if (tut && TUT_STEPS[tut.step] === 'dodge') { tut.failed = true; tut.spawned = false; tut.t = 0; }
    toast('앗! 괜찮아요, 연습이니까 · 한 번 더', 1.8);
  }
  function tutBumpUfo() {
    primaryStun = 1.1; alienPhase = 'recover'; alienClock = 0; dashVX = (ufoX - playerX) * 3; dashVY = -240; invincible = 1;
    toast('앗! 다음엔 위장 버튼을 톡!', 1.8); tone(180, 0.1);
  }
  function updateTutorial(dt) {
    const T = tut;
    T.t += dt; visitorSpawn = 25; tasteClock = 0;
    if (T.step < 3) primaryGone = 999;
    if (T.wait > 0) {
      T.wait -= dt;
      if (T.wait <= 0) { T.wait = 0; T.step++; if (T.step >= TUT_STEPS.length) endTutorial(false); else enterTutStep(); }
      return;
    }
    const k = TUT_STEPS[T.step];
    if (k === 'move') {
      T.moved += Math.abs(playerX - T.lx) + Math.abs(playerY - T.ly); T.lx = playerX; T.ly = playerY;
      if (T.moved > 120) tutDone('좋아요! 손을 떼면 바로 멈춰요');
    } else if (k === 'dodge') {
      if (!T.spawned && T.t > 0.6) tutRow();
      if (T.spawned && !T.failed && !obstacles.some((o) => o.tut && o.y + 17 < playerY + 40)) {
        T.passes++; T.spawned = false; T.t = 0;
        if (T.passes >= 2) tutDone('완벽! 운석은 빈칸으로');
        else toast('좋아요! 한 줄 더', 1.4);
      }
    } else if (k === 'item') {
      if (!T.spawned && T.t > 0.4) {
        pickups.push({ x: clamp(playerX + (playerX < width / 2 ? 90 : -90), 40, width - 40), y: -30, type: 'rabbit', speed: 110 * pace() });
        T.spawned = true;
      }
      if (T.spawned && !pickups.length) { T.spawned = false; T.t = 0; toast('놓쳤다! 하나 더 떨어져요', 1.6); }
    } else if (k === 'mask') {
      masks = Math.max(masks, 1);
      if (alienPhase === 'patrol' && T.t > 1.8 && masked <= 0 && primaryStun <= 0) { alienPhase = 'aim'; alienClock = 0; dashX = playerX; dashY = playerY; }
    } else if (k === 'shoot') {
      if (!weaponDrop && weaponLeft <= 0 && T.t > 0.6) {
        weaponDrop = { x: clamp(playerX + (playerX < width / 2 ? 80 : -80), 40, width - 40), y: -30, speed: 110 * pace() };
        T.t = 0;
      }
      if (alienPhase === 'aim' || alienPhase === 'dash') { alienPhase = 'patrol'; alienClock = 0; } // 쏘기 연습 중엔 돌진하지 않음
    }
  }
  function endTutorial(skipped) {
    if (!tut) return;
    tut = null; tips.tutorial = true;
    for (const k of ['start', 'weapon', 'aim', 'piece']) tips[k] = true; // 연습에서 배운 팁은 다시 안 띄움
    saveProgress();
    $('coach').hidden = true; $('mask').classList.remove('tut-pulse');
    obstacles = obstacles.filter((o) => !o.tut); pebbles = []; weaponDrop = null; weaponLeft = 0; weaponLv = 0; bullets = [];
    primaryHp = primaryMax = UFO_HP; primaryGone = skipped ? 0 : 3; primaryStun = 0; alienPhase = 'patrol'; alienClock = 0;
    masks = Math.max(masks, 1); masked = 0; invincible = 1.5;
    elapsed = 0; spawn = 0.9; itemClock = 2; points = score = 0;
    runStats = { near: 0, combo: 0, items: 0, finds: 0, unlocks: 0, ufoHits: 0, rocks: 0, masks: 0, hypers: 0, smashed: 0, kills: 0, bosses: 0, rescued: 0 };
    const g = goalTarget();
    splash(skipped ? '진짜 비행 시작!' : '준비 끝! 진짜 비행 시작', g ? '모선까지 ' + planet().len + '초 버티면 {' + g.P.friend + '} ' + FRIENDS[g.P.friend].name.split(' ')[1] + ' 구출!' : '친구를 구하러 가요', 'planet', 2.4);
    tone(880, 0.15); sync();
  }

  // ═══════════════════════════════════════════════════════════════
  // 14-B. v0.17 몰림→반격 리듬 · 역방향 비행
  // ═══════════════════════════════════════════════════════════════
  // 행성마다 1~3번(오늘의 코스는 모두 같음). 행성 시작 직후와 모선 직전은 비워 둠.
  function planBeats() {
    const P = planet(), n = 1 + Math.floor(rnd(9300 + planetIdx, 1) * 3), span = (P.len * 0.66) / n;
    beatPlan = [];
    for (let k = 0; k < n; k++) beatPlan.push(Math.max(P.len * 0.18, P.len * 0.2 + span * (k + 0.5) - (CRUNCH + RELEASE) / 2));
    beatPlanFor = planetIdx; beatIdx = -1; beatState = 'calm';
  }
  function beatAt(t) {
    for (let k = 0; k < beatPlan.length; k++) {
      const s0 = beatPlan.at(k);
      if (t >= s0 && t < s0 + CRUNCH) return ['crunch', k];
      if (t >= s0 + CRUNCH && t < s0 + CRUNCH + RELEASE) return ['release', k];
    }
    return ['calm', -1];
  }
  function updateBeats() {
    if (tut || boss || rescue) { beatState = 'calm'; beatIdx = -1; return; }
    if (beatPlanFor !== planetIdx) planBeats();
    const [st, k] = beatAt(tripT);
    if (st === beatState && k === beatIdx) return;
    beatState = st; beatIdx = k;
    if (st === 'crunch') { swirlArmed = true; if (!flipOn()) toast('☄ 몰려온다! 버텨!', 2); tone(260, 0.12); }
    if (st === 'release') {
      toast('★ 반격 타임!', 2); tone(988, 0.12);
      if (!weaponDrop && weaponLeft <= 0) weaponPending = true; // 바로 별탄 캡슐
      addGauge(RELEASE_GAUGE);
    }
  }
  // 빙글 구슬: 몰리는 구간이 시작되고 0.8초 뒤, 주 UFO가 있을 때만 한 번
  function swirlReady() {
    return swirlArmed && beatState === 'crunch' && !flipOn() && !hyperOn() && !tut && !boss && primaryGone <= 0 && primaryStun <= 0
      && tripT >= beatPlan.at(beatIdx) + 0.8 && !swirlOrb;
  }
  // UFO가 격추됐거나 기절해서 못 쏘면, 몰림 1.8초째에 하늘에서 빙글 구슬이 직접 내려옴(뒤집기가 사라지지 않게)
  function skySwirl() {
    if (!swirlArmed || beatState !== 'crunch' || flipOn() || hyperOn() || tut || boss || swirlOrb) return;
    if (tripT < beatPlan.at(beatIdx) + 1.8 || alienPhase === 'swirl') return;
    swirlArmed = false;
    const x = clamp(playerX + (rnd(8800 + beatIdx + planetIdx * 7, 1) - 0.5) * 120, 30, width - 30), y = flipOn() ? height + 20 : HUD_BAND + 10;
    const dx = playerX - x, dy = playerY - y, d = Math.hypot(dx, dy) || 1, sp = ORB_SPEED * pace();
    swirlOrb = { x, y, vx: (dx / d) * sp, vy: (dy / d) * sp, t: 0 };
    toast('{swirl} 빙글 구슬이 떨어진다! 피해요', 1.6); tone(700, 0.08);
  }
  function popOrb() {
    if (!swirlOrb) return;
    burst(swirlOrb.x, swirlOrb.y, '#c9b5f4'); burst(swirlOrb.x, swirlOrb.y, '#fff1aa');
    points += 15; swirlOrb = null; toast('구슬 펑! 휴~', 1.4); tone(1046, 0.08);
  }
  function clearRocks() {
    for (const o of obstacles) if (o.y > -20 && o.y < height + 20) burst(o.x + 17, o.y + 17, '#d8c7ec');
    obstacles = []; pebbles = [];
  }
  // 전환 순간 UFO들도 반대편으로(기체와 길이 엇갈려 억울하게 잡히지 않게)
  function mirrorAliens() {
    ufoY = clamp(height - ufoY, 160, height - 115); alienPhase = 'recover'; alienClock = 0; primaryNear.armed = false;
    for (const v of visitors) { v.y = clamp(height - v.y, 160, height - 115); v.vy = -v.vy; v.grace = Math.max(v.grace, 1.5); v.armed = false; }
  }
  function startFlip() {
    if (flipOn() || mode !== 'playing') return;
    flipLeft = FLIP_TIME; flipSpin = FLIP_SPIN; runStats.flips = (runStats.flips || 0) + 1;
    invincible = Math.max(invincible, FLIP_SAFE);
    clearRocks();
    for (const p of pickups) p.speed = -Math.abs(p.speed || 120 * pace());
    if (weaponDrop) weaponDrop.speed = -Math.abs(weaponDrop.speed);
    midDrop = null; forceGap = null; spawn = Math.max(spawn, 0.9);
    targetY = toRev(playerY); clampTarget(); mirrorAliens();
    splash('{swirl} 뒤집혔다!!', '아래에서 와요 · 조작은 그대로', 'boss', 1.8);
    tone(300, 0.2); setTimeout(() => tone(200, 0.2), 120); buzz(70); shake = 0.25;
    sync();
  }
  // silent = 포획·게임오버 등으로 바로 끝낼 때(연출 없음)
  function endFlip(silent) {
    const was = flipLeft > 0 || silent !== true;
    flipLeft = 0; swirlOrb = null; flipSpin = silent ? 0 : FLIP_SPIN;
    if (silent) { targetY = toNorm(playerY); return; }
    if (!was) return;
    invincible = Math.max(invincible, FLIP_SAFE);
    clearRocks();
    for (const p of pickups) p.speed = Math.abs(p.speed || 120 * pace());
    if (weaponDrop) weaponDrop.speed = Math.abs(weaponDrop.speed);
    midDrop = null; forceGap = null; spawn = Math.max(spawn, 0.9);
    targetY = toNorm(playerY); clampTarget(); mirrorAliens();
    splash('정상 항로 복귀!', '잠깐 무적 · 운석이 다시 위에서 와요', 'hyper', 1.2);
    tone(880, 0.12); setTimeout(() => tone(1175, 0.14), 100); buzz(30);
  }
  function updateFlip(dt) {
    skySwirl();
    if (swirlOrb) {
      const o = swirlOrb;
      if (o.t < 0.9) o.vx += clamp(playerX - o.x, -60, 60) * 1.6 * dt; // 처음 잠깐만 살짝 따라옴(피할 수는 있음)
      o.x += o.vx * dt; o.y += o.vy * dt; o.t += dt;
      if (Math.hypot(o.x - playerX, o.y - playerY) < 26) {
        if (hyperOn()) popOrb();
        else if (invincible <= 0) { swirlOrb = null; startFlip(); }
      }
      if (swirlOrb && (o.x < -30 || o.x > width + 30 || o.y < -30 || o.y > height + 30 || o.t > 6)) swirlOrb = null;
    }
    if (flipSpin > 0) flipSpin = Math.max(0, flipSpin - dt);
    if (flipLeft > 0) {
      const before = Math.ceil(flipLeft);
      flipLeft = Math.max(0, flipLeft - dt);
      revScroll += dt * 2000 * worldMul(); // 배경 별도 위로 흐름
      if (flipLeft > 0 && flipLeft <= FLIP_WARN && Math.ceil(flipLeft) !== before) tone(520 + (5 - Math.ceil(flipLeft)) * 90, 0.06);
      if (flipLeft === 0) endFlip(false);
    }
  }
  // 기체가 반 바퀴 도는 각도(도트 느낌으로 45°씩)
  function flipAngle() {
    const f = FLIP_SPIN > 0 ? flipSpin / FLIP_SPIN : 0;
    const a = flipOn() ? Math.PI * (1 - f) : Math.PI * f;
    return Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  }

  function stageAt(t) { let s = 0; for (let i = 0; i < STAGES.length; i++) if (t >= STAGES[i].at) s = i; return s; }
  // 운석 줄 낙하 속도(시간에 따라 상승 · 화면 크기 보정)
  function rowSpeed() {
    const late = Math.max(0, elapsed - 70);
    return (165 + Math.min(elapsed * 3, 165) + Math.min(late * 0.8, 100)) * pace(); // v0.17.1: 시작을 빠르게, 55초쯤 기존 최고 속도에 도달
  }
  function row(interval) {
    rowNumber++;
    const late = Math.max(0, elapsed - 70); // 70초 이후 완만하게 계속 상승
    const gap = Math.max(108, 138 - late * 0.25 - (beatState === 'crunch' ? 8 : 0)); // 몰리는 구간은 빈칸이 조금 좁음
    // 바로 앞에 아이템이 있으면, 이 줄의 빈칸을 아이템 위치에 맞춥니다(먹고 그대로 지나갈 수 있게).
    const forced = forceGap !== null;
    const gapX = forced ? clamp(forceGap - gap / 2, 22, Math.max(22, width - gap - 22)) : 22 + rnd(rowNumber, 1) * Math.max(1, width - gap - 44);
    forceGap = null;
    const speed = rowSpeed() * dirY(), y0 = flipOn() ? height + 6 : -40; // 역방향이면 아래에서 올라옴
    // v0.17.2 깔끔한 운석 줄(사용자: "따닥따닥 붙은 게 싫다", "들쭉날쭉은 지저분하다")
    //  징검다리 줄(기본) = 운석이 84px 간격으로 한 줄 정렬, 줄마다 반 칸씩 엇갈려 지그재그로 빠져나감
    //  벽 줄(몰림 구간·아이템 줄) = 42px 간격(서로 안 붙음) + 큰 빈칸 하나
    const wall = forced || tut || beatState === 'crunch';
    const step = wall ? 42 : 84, phase = wall ? 0 : (rowNumber % 2) * 42;
    const made = [];
    for (let x = 24 + phase; x < width - 16; x += step) {
      if (wall && x + 17 > gapX && x - 17 < gapX + gap) continue; // 징검다리 줄은 사이사이가 원래 빈칸
      const o = { x: x - 17, y: y0, w: 34, h: 34, speed, spin: Math.random() * 6.28, vx: 0, close: false, grazed: false };
      obstacles.push(o); made.push(o);
    }
    const moverEvery = stage >= 3 ? 1 : stage >= 2 ? 2 : 3;
    if (!forced && (rowNumber % moverEvery === moverEvery - 1 || moverEvery === 1)) {
      const candidates = made;
      const rock = candidates[Math.floor(rnd(rowNumber, 2) * candidates.length)];
      if (rock) rock.vx = (rock.x < width / 2 ? 1 : -1) * (34 + rnd(rowNumber, 3) * 22);
    }
    // 아이템·무기 캡슐은 운석 줄 '사이'(다음 줄까지 절반 시간 뒤)에 같은 속도로 떨어뜨립니다.
    if (!midDrop && (weaponPending || itemClock <= 0)) {
      const kind = weaponPending ? 'weapon' : 'item';
      if (kind === 'weapon') weaponPending = false; else itemClock = 2.8;
      midDrop = { at: interval / 2, from: gapX + gap / 2, gap, kind };
    }
  }
  function spawnMidDrop() {
    const m = midDrop;
    midDrop = null;
    const off = m.kind === 'weapon' ? (rnd(rowNumber, 4) < 0.5 ? -1 : 1) * (60 + rnd(rowNumber, 5) * 100) : (rnd(rowNumber, 5) - 0.5) * 220;
    const x = clamp(m.from + off, 40, width - 40);
    if (m.kind === 'weapon') {
      weaponDrop = { x, y: flipOn() ? height + 6 : -40, speed: rowSpeed() * dirY() }; // 앞뒤 줄 속도의 중간값 → 줄 사이 한가운데 유지
      if (tips.weapon) toast('★ 별탄 캡슐!');
      else tip('weapon', '★ 캡슐 먹으면 10초간 별탄 자동 발사');
    } else pickups.push({ x, y: flipOn() ? height + 6 : -40, type: nextItem(), speed: rowSpeed() * dirY() });
    forceGap = x + (rnd(rowNumber, 6) - 0.5) * 40; // 다음 줄 빈칸 중심 = 아이템 위치 ±20px
  }

  // ═══════════════════════════════════════════════════════════════
  // 15. 한 틱 업데이트
  // ═══════════════════════════════════════════════════════════════
  // 축마다 따로 목표를 향해 정해진 픽셀만 이동 → 관성 없는 8방향 도트 이동 (원본 유지)
  const minY = () => Math.max(190, height * 0.38), maxY = () => height - 105;
  // 하이퍼 중에는 위쪽 한계만 넓어집니다(HUD 아래까지). 이동 방식·속도는 원본 그대로.
  const topY = () => (hyperLeft > 0 ? HUD_BAND + 40 : minY());
  // 역방향 비행: 우주선은 화면 위쪽 같은 높이 폭 안에서 움직입니다(이동 방식·속도는 그대로).
  const flipOn = () => flipLeft > 0;
  const dirY = () => (flipLeft > 0 ? -1 : 1); // 세상이 흐르는 방향(1 = 아래로, -1 = 위로)
  const revTop = () => HUD_BAND + 40, revBot = () => revTop() + (maxY() - minY());
  const toRev = (y) => clamp(revTop() + (maxY() - y), revTop(), revBot());
  const toNorm = (y) => clamp(maxY() - (y - revTop()), minY(), maxY());
  function clampTarget() { targetX = clamp(targetX, 24, width - 24); targetY = flipOn() ? clamp(targetY, revTop(), revBot()) : clamp(targetY, topY(), maxY()); }
  function stepPlayer() {
    playerX += clamp(S(targetX) - playerX, -DRAG_SPEED, DRAG_SPEED);
    playerY += clamp(S(targetY) - playerY, -DRAG_SPEED, DRAG_SPEED);
  }

  function update(dt) {
    if (mode === 'playing' || mode === 'capture') {
      impactLeft = Math.max(0, impactLeft - dt);
      for (const b of bolts) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 220 * dt; b.life -= dt; }
      bolts = bolts.filter((b) => b.life > 0);
    }
    if (mode === 'capture') { updateCapture(dt); return; }
    if (mode === 'dying') {
      dyingLeft -= dt; impactLeft = Math.max(0, impactLeft - dt); deathFx.t += dt;
      for (const b of bolts) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 220 * dt; b.life -= dt; }
      bolts = bolts.filter((b) => b.life > 0);
      for (const p of sparkles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      sparkles = sparkles.filter((p) => p.life > 0);
      for (const sp of spills) { sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 420 * dt; sp.spin += dt * 9; sp.life -= dt; }
      spills = spills.filter((sp) => sp.life > 0);
      if (dyingLeft <= 0) finish(dieReason);
      return;
    }
    if (mode !== 'playing') return;
    if (resumeLeft > 0) {
      resumeLeft = Math.max(0, resumeLeft - dt);
      if (resumeLeft > 0) $('scene-caption').textContent = String(Math.ceil(resumeLeft / 0.5));
      else { $('scene-caption').hidden = true; $('scene-caption').classList.remove('count'); }
      return;
    }

    shake = Math.max(0, shake - dt);
    updateRewards(dt);
    if (hitStop > 0) { hitStop -= dt; return; } // 쾅! 아주 짧게 멈춤
    if (celebrate > 0) { celebrate -= dt; if (tick % 3) return; } // 모선 격추: 1초 슬로모션
    nearClock = Math.max(0, nearClock - dt);
    for (const p of sparkles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    sparkles = sparkles.filter((p) => p.life > 0);

    if (!tut) elapsed += dt;
    const nextStage = stageAt(elapsed);
    if (nextStage !== stage) { stage = nextStage; if (stage === 2) toast('☄ 깊은 궤도 — 운석이 빨라져요 · 지금부터 먹으면 황금 조각!', 3); if (stage === 3) toast('☄ 운석 폭풍!'); }
    if (hyperLeft > 0) { hyperLeft = Math.max(0, hyperLeft - dt); if (hyperLeft === 0) endHyper(); }
    else if (hyperEase > 0) hyperEase = Math.max(0, hyperEase - dt);
    const wm = worldMul();
    bgBoost += dt * 1000 * (wm - 1);
    for (const sp of spills) { sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 420 * dt; sp.spin += dt * 9; sp.life -= dt; }
    spills = spills.filter((sp) => sp.life > 0);
    if (!tut) points += dt * 10 * (doubleLeft > 0 ? 2 : 1) * (hyperLeft > 0 ? 2 : 1);
    if (!tut && !bestBroken && runBest > 0 && points > runBest) { bestBroken = true; splash('최고 기록 돌파!!', '여기부터는 매 초가 신기록', 'win', 1.6); tone(1046, 0.15); }
    if (rival && !rival.beaten && points > rival.score) { rival.beaten = true; splash('친구 기록 돌파!!', rival.score.toLocaleString('ko-KR') + '점을 넘었어요 · 더 멀리!', 'win', 2); }
    score = Math.floor(points);
    itemClock -= dt;
    if (toastLeft > 0) { toastLeft -= dt; if (toastLeft <= 0) $('notice').textContent = ''; }
    masked = Math.max(0, masked - dt); invincible = Math.max(0, invincible - dt); charmLeft = Math.max(0, charmLeft - dt);
    doubleLeft = Math.max(0, doubleLeft - dt); magnetLeft = Math.max(0, magnetLeft - dt);
    slowLeft = Math.max(0, slowLeft - dt); confusedLeft = Math.max(0, confusedLeft - dt);
    if (!tut) tasteClock += dt;
    if (tasteClock >= 16) { tasteClock -= 16; taste = (taste + 1) % 3; toast('{' + tastes[taste].icon + '} 취향 바뀐 UFO 등장'); }

    // 키보드: 누르는 순간 최고속, 떼는 순간 정지. 틱마다 정확히 KEY_SPEED px. (원본 유지)
    const kx = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
    const ky = Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'));
    if (kx || ky) { targetX = playerX + kx * KEY_SPEED; targetY = playerY + ky * KEY_SPEED; clampTarget(); }
    if (!flipOn() && hyperLeft <= 0 && targetY < minY()) targetY = minY(); // 하이퍼가 끝나면 원래 높이로 (보통 속도로 내려옴)
    stepPlayer();
    if (tut) updateTutorial(dt);
    updateBeats(); updateFlip(dt); if (mode !== 'playing') return;

    updateCombat(dt);
    if (!tut) updateBoss(dt); if (mode !== 'playing') return;
    for (const e of escapes) { e.x += e.vx * dt; e.y += e.vy * dt; e.vy -= 40 * dt; e.life -= dt; }
    escapes = escapes.filter((e) => e.life > 0);
    trail.push([playerX, playerY]); if (trail.length > 50) trail.shift();
    moveAlien(dt); if (mode !== 'playing') return;
    moveVisitors(dt); if (mode !== 'playing') return;
    chase = boss || primaryGone > 0 ? 0 : clamp((1 - Math.hypot(playerX - ufoX, playerY - ufoY) / 220) * 8.5, 0, 8.5);
    if (chase > 6) tip('chase', '분홍 게이지가 차면 위험! 거리를 벌려요');
    if (interested()) tip('taste', '♥ 지금 장식이 외계인 취향! 더 자주 노려요');
    checkDaily();

    // 병아리 모자 감속 중에는 줄 생성도 같은 비율로 늦춰 줄 간격(=아이템 주변 여유)을 유지합니다.
    // 하이퍼 중에는 줄도 그만큼 빨리 옴(간격 유지). 모선전에는 운석 줄을 30% 줄여 보스에 집중.
    const slowSpawn = (slowLeft > 0 ? 0.55 : 1) * wm * (boss ? 0.7 : 1);
    if (!tut) spawn -= dt * slowSpawn;
    if (spawn <= 0) { const interval = Math.max(elapsed < 100 ? 0.85 : 0.72, 1.3 - elapsed * 0.007) * (beatState === 'crunch' ? CRUNCH_ROW : beatState === 'release' ? RELEASE_ROW : 1); row(interval); spawn = interval; }
    if (midDrop) { midDrop.at -= dt * slowSpawn; if (midDrop.at <= 0) spawnMidDrop(); }
    const py = playerY, slow = (slowLeft > 0 ? 0.55 : 1) * wm;

    for (const item of pickups) {
      item.y += (item.speed || 120 * pace()) * dt * slow;
      if (magnetLeft > 0 && Math.hypot(playerX - item.x, py - item.y) < 150) {
        item.x += (playerX - item.x) * (1 - Math.exp(-6 * dt));
        item.y += (py - item.y) * (1 - Math.exp(-6 * dt));
      }
      if (Math.hypot(playerX - item.x, py - item.y) < 35) { collect(item.type, !!item.refund); item.y = height + 100; }
    }
    pickups = pickups.filter((i) => i.y < height + 40 && i.y > -80);

    for (const o of obstacles) {
      const step = dt * slow;
      o.y += o.speed * step; o.x += (o.vx || 0) * step;
      if (o.x < 1 || o.x > width - 35) { o.x = clamp(o.x, 1, width - 35); o.vx = -(o.vx || 0); }
      const dx = playerX - (o.x + 17), dy = py - (o.y + 17), d2 = dx * dx + dy * dy;
      if (hyperOn() && d2 < 36 ** 2) { smash(o); tone(200 + Math.random() * 80, 0.04); continue; }
      if (invincible <= 0 && d2 < HIT_R ** 2) {
        if (tut) { tutHitRock(o); continue; }
        if (lives > 0) {
          lives--; invincible = 2.2; dentShip(o.x + 17); o.y = height + 100;
          toast('{rabbit} 토끼 귀가 막아 줬다!'); tone(320); buzz(60);
        } else { die('운석과 부딪혔어요. 한 번 더?', o.x + 17, o.y + 17, '운석'); return; }
        continue;
      }
      // 근접 회피: 가까이 스친 운석이 부딪히지 않고 기체 아래로 지나간 뒤에만 보너스
      if (d2 < 46 ** 2 && invincible <= 0) o.close = true;
      if (o.close && !o.grazed && (o.speed >= 0 ? o.y + 17 > py + 30 : o.y + 17 < py - 30)) { o.grazed = true; graze(o.x + 17, o.y + 17); }
    }
    obstacles = obstacles.filter((o) => o.y < height + 40 && o.y > -80);
    updatePebbles(dt * slow, py); if (mode !== 'playing') return;

    if (tick % 3 === 0) particles.push({ x: playerX + (Math.random() - 0.5) * 5, y: py + 32 * dirY(), life: 1, vy: 90 * dirY() });
    for (const p of particles) { p.y += (p.vy || 90) * dt; p.life -= dt * 2; }
    particles = particles.filter((p) => p.life > 0);
    sync();
  }
  function updateCapture(dt) {
    sceneTime += dt;
    if (sceneTime > 1.5) $('scene-caption').textContent = sceneReturn === 'playing' ? '…인형만?' : '이번엔 인형이 없다.';
    if (sceneTime <= 3.6) return;
    $('scene-caption').hidden = true;
    if (sceneReturn !== 'playing') { finish('인형이 없어서 이번엔 같이 끌려갔어요.'); return; }
    doll = false; trophies++; saveProgress();
    mode = 'playing'; chase = 0; charmLeft = 0; masked = 0; invincible = 3; obstacles = [];
    ufoY = 180; primaryStun = 0; alienPhase = 'patrol'; alienClock = 0;
    for (const v of visitors) { v.y = 170; v.grace = 2; v.stun = 0; }
    toast('인형만 쏙 가져갔다… 나는 두고'); sync();
  }

  // ═══════════════════════════════════════════════════════════════
  // 16. 그리기 — 기체
  // ═══════════════════════════════════════════════════════════════
  // 황금 장식: 그리는 동안 tint가 켜져 있으면 색을 금빛으로 섞습니다.
  let tint = false;
  const goldCache = new Map();
  function paint(color) {
    if (!tint || typeof color !== 'string' || color[0] !== '#') return color;
    let g = goldCache.get(color);
    if (!g) {
      const h = color.slice(1), a = h.length >= 8 ? h.slice(6, 8) : '';
      const mix = (i, gold) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.45 + gold * 0.55).toString(16).padStart(2, '0');
      g = '#' + mix(0, 0xff) + mix(2, 0xd3) + mix(4, 0x6b) + a;
      goldCache.set(color, g);
    }
    return g;
  }
  function ellipse(x, y, rx, ry, color) { ctx.fillStyle = paint(color); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function star(x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4 - Math.PI / 2, rr = j % 2 ? r * 0.3 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }
  function bear(x, y, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ellipse(-6, -7, 4, 4, '#dba77c'); ellipse(6, -7, 4, 4, '#dba77c'); ellipse(0, 6, 8, 9, '#dba77c'); ellipse(0, -2, 9, 8, '#edc39a');
    ellipse(-3, -3, 1, 1.4, '#49374c'); ellipse(3, -3, 1, 1.4, '#49374c'); ellipse(0, 1, 2, 1.5, '#65475b');
    ellipse(-8, 5, 3, 4, '#dba77c'); ellipse(8, 5, 3, 4, '#dba77c');
    ctx.restore();
  }
  function dressBack(t) {
    const tier = dressTier();
    if (!tier) return;
    const wing = tier >= 3 ? '#f4d692' : tier === 2 ? '#98e7db' : '#c1a6ed';
    for (const side of [-1, 1]) {
      ctx.fillStyle = wing; ctx.beginPath();
      ctx.moveTo(side * 13, -8); ctx.lineTo(side * (25 + tier * 5), -22 - tier * 3); ctx.lineTo(side * (23 + tier * 5), 22); ctx.lineTo(side * 12, 17);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff0c9'; ctx.fillRect(side < 0 ? -31 - tier * 2 : 26 + tier * 2, 16, 5, 12 + ((tick >> 3) & 1) * 5);
    }
    if (tier >= 2) {
      ctx.strokeStyle = tier >= 3 ? '#f6d47a' : '#b5efe7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 1, 43, 49, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (tier === 3) for (let i = 0; i < 4; i++) { const a = t * 0.001 + (i * Math.PI) / 2; star(S(Math.cos(a) * 43), S(Math.sin(a) * 49), 4, '#ffe6a0'); }
    if (tier === 4) {
      // LEGEND: 무지개 별 8개 + 바깥 링
      ctx.strokeStyle = '#ffe6a066'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 1, 52, 58, 0, 0, Math.PI * 2); ctx.stroke();
      const cols = ['#ffe6a0', '#ffb6d3', '#a5f8d5', '#c9b5f4'];
      for (let i = 0; i < 8; i++) { const a = t * 0.0012 + (i * Math.PI) / 4; star(S(Math.cos(a) * 48), S(Math.sin(a) * 54), i % 2 ? 3 : 5, cols[i % 4]); }
    }
  }
  function dressFront() {
    const part = (k, fn) => { if (!equipped(k)) return; tint = golden(k); fn(); tint = false; };
    const fill = (col) => { ctx.fillStyle = paint(col); };
    const line = (col) => { ctx.strokeStyle = paint(col); };
    part('rabbit', () => { ellipse(-7, -29, 4, 12, '#fff0f5'); ellipse(7, -29, 4, 12, '#fff0f5'); ellipse(-7, -29, 1.5, 8, '#f4b3cc'); ellipse(7, -29, 1.5, 8, '#f4b3cc'); });
    part('crown', () => {
      fill('#ffdb77'); ctx.beginPath();
      ctx.moveTo(13, -20); ctx.lineTo(12, -35); ctx.lineTo(20, -30); ctx.lineTo(25, -39); ctx.lineTo(30, -30); ctx.lineTo(37, -35); ctx.lineTo(35, -20);
      ctx.closePath(); ctx.fill(); ellipse(25, -25, 2, 2, '#fb96b7');
    });
    part('cat', () => {
      for (const side of [-1, 1]) {
        line('#f3d681'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(side * 17, 0); ctx.lineTo(side * 26, 4); ctx.stroke();
        ellipse(side * 27, 6, 5, 5, '#f4d48d'); ellipse(side * 27, 8, 1, 2, '#755c72');
      }
    });
    part('chick', () => { ellipse(-25, -26, 9, 8, '#f7db8c'); ellipse(-28, -32, 5, 5, '#f7db8c'); ellipse(-30, -33, 1, 1, '#49404c'); ellipse(-35, -30, 3, 2, '#efaa78'); });
    part('disco', () => {
      line('#c1a6ed'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, -12); ctx.lineTo(-25, -45); ctx.stroke();
      ellipse(-26, -47, 7, 7, '#cbe8f1');
      line('#8d87bd'); ctx.beginPath(); ctx.moveTo(-32, -47); ctx.lineTo(-20, -47); ctx.moveTo(-26, -53); ctx.lineTo(-26, -41); ctx.stroke();
    });
    part('diamond', () => { fill('#9fe7f3'); ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(6, 17); ctx.lineTo(0, 24); ctx.lineTo(-6, 17); ctx.closePath(); ctx.fill(); });
    part('moustache', () => { ellipse(-4, 6, 4, 2, '#51435c'); ellipse(4, 6, 4, 2, '#51435c'); });
    part('duck', () => { ellipse(26, 24, 8, 5, '#ffdc8b'); ellipse(30, 18, 4, 4, '#ffdc8b'); ellipse(35, 19, 3, 1.5, '#ef9d79'); ellipse(31, 17, 1, 1, '#4d3d52'); });
    part('fish', () => {
      fill('#a6dbed'); ctx.beginPath(); ctx.moveTo(-31, 28); ctx.lineTo(-41, 22); ctx.lineTo(-41, 34); ctx.closePath(); ctx.fill();
      ellipse(-26, 28, 8, 5, '#a6dbed'); ellipse(-21, 27, 1, 1, '#37415e');
    });
    // 전리품 장식(격추 전용)
    if (mode !== 'ready' && runTrophy.antenna) {
      ctx.strokeStyle = '#9d8fc7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-11, -18); ctx.lineTo(-16, -32); ctx.moveTo(11, -18); ctx.lineTo(16, -32); ctx.stroke();
      ellipse(-16, -33, 3, 3, (tick >> 4) & 1 ? '#a5f8d5' : '#e6fff6'); ellipse(16, -33, 3, 3, (tick >> 4) & 1 ? '#ffe0f0' : '#ffb6d3');
    }
    if (mode !== 'ready' && runTrophy.core) {
      ellipse(0, 12, 7 + ((tick >> 3) & 1), 7 + ((tick >> 3) & 1), '#ff8fb855'); ellipse(0, 12, 4.5, 4.5, '#ff8fb8'); ellipse(-1, 11, 1.5, 1.5, '#ffffff');
    }
    if (mode !== 'ready' && runTrophy.saucer) {
      const a = tick * 0.05, ox = S(Math.cos(a) * 40), oy = S(Math.sin(a) * 18 - 4);
      ellipse(ox, oy - 2, 4, 3.5, '#9ddbd9'); ellipse(ox, oy + 1, 8, 2.5, '#9bded3');
    }
    // 황금 장식이 있으면 기체 주변에 작은 반짝임
    if (DRESS_KEYS.some((k) => equipped(k) && golden(k)) && ((tick >> 4) & 3) === 0) {
      ctx.fillStyle = '#fff6d6'; ctx.fillRect(S(-20 + ((tick >> 6) % 5) * 10), -40 + ((tick >> 6) % 3) * 30, PX * 2, PX * 2);
    }
  }
  const flameSkin = () => flame;
  function drawWing(side) {
    const dented = mode !== 'hangar' && dents.includes(side);
    ctx.save(); ctx.translate(side * 14, 9); if (dented) ctx.rotate(side * 0.45);
    const pc = PAINTS[shipPaint] || PAINTS.basic;
    ellipse(0, dented ? 3 : 0, dented ? 7 : 8, dented ? 9 : 13, dented ? pc.dent : pc.wing);
    ctx.restore();
  }
  function drawDamage() {
    if (mode === 'hangar') return;
    ctx.strokeStyle = '#82748d'; ctx.lineWidth = 2;
    for (let i = 0; i < dents.length; i++) {
      const side = dents[i], y = 9 + i * 4;
      ctx.beginPath(); ctx.moveTo(side * 8, y); ctx.lineTo(side * 12, y + 3); ctx.lineTo(side * 9, y + 5); ctx.stroke();
    }
  }
  function ship(x, y, t) {
    // 무적 시간에는 옛 게임처럼 기체가 깜빡입니다.
    if (invincible > 0 && mode === 'playing' && (tick >> 2) & 1) return;
    const inHangar = mode === 'hangar';
    ctx.save(); ctx.translate(x, y);
    if (!inHangar) { const fa = flipAngle(); if (fa) ctx.rotate(fa); } // 역방향: 반 바퀴
    if (!inHangar && impactLeft > 0) { const p = impactLeft / 0.38; ctx.scale(1 + 0.17 * p, 1 - 0.2 * p); ctx.rotate(-impactSide * 0.13 * p); }
    if (!inHangar && squishLeft > 0) { const w = Math.sin(squishLeft * 34) * (squishLeft / 0.55); ctx.scale(1 + 0.12 * w, 1 - 0.12 * w); } // 찌그럭 출렁
    dressBack(t);
    const flameLen = ((tick >> 3) & 1 ? 4 : 0) + (hyperLeft > 0 && !inHangar ? 14 + ((tick >> 2) & 1) * 6 : 0); // 2프레임 불꽃 (하이퍼: 길게)
    const pc = PAINTS[shipPaint] || PAINTS.basic, fc = FLAMES[flameSkin()] || FLAMES.basic;
    ellipse(0, 25, 7, 11 + flameLen, fc.out); ellipse(0, 23, 3, 6 + flameLen, fc.core);
    drawWing(-1); drawWing(1);
    ellipse(0, 0, 16, 25, pc.body); ellipse(-5, -9, 5, 9, '#ffffff'); ellipse(0, -2, 11, 12, pc.win);
    ellipse(0, 0, 8, 8, '#cef3ad'); ellipse(-5, -5, 3, 5, '#cef3ad'); ellipse(5, -5, 3, 5, '#cef3ad');
    ellipse(-3, 0, 1.3, 1.8, '#27304c'); ellipse(3, 0, 1.3, 1.8, '#27304c'); ellipse(-6, 3, 2, 1, '#f1a9bb'); ellipse(6, 3, 2, 1, '#f1a9bb');
    ctx.strokeStyle = '#45634b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 2, 2, 0, Math.PI); ctx.stroke();
    ellipse(-4, -7, 2, 3, '#ffffff99');
    ctx.fillStyle = pc.wing; ctx.beginPath(); ctx.roundRect(-7, 17, 14, 5, 2); ctx.fill();
    drawDamage(); dressFront();
    if (weaponLeft > 0 && !inHangar) {
      const blink = weaponLeft > 3 || (tick >> 3) & 1;
      const body = weaponLv >= 3 ? '#f6d47a' : weaponLv === 2 ? '#a5f8d5' : '#c2d8df'; // LV마다 포신 색
      for (const side of [-1, 1]) {
        ctx.fillStyle = body; ctx.fillRect(side < 0 ? -29 : 21, -17, 8, 22);
        ctx.fillStyle = blink ? '#fff0a5' : '#7e718b'; ctx.fillRect(side < 0 ? -28 : 22, -21, 6, 8);
        if (weaponLv >= 2) { // 바깥쪽으로 기운 작은 보조 포신
          ctx.save(); ctx.translate(side * 33, -6); ctx.rotate(side * 0.5);
          ctx.fillStyle = body; ctx.fillRect(-3, -9, 6, 14); ctx.fillStyle = blink ? '#fff0a5' : '#7e718b'; ctx.fillRect(-2, -12, 4, 5);
          ctx.restore();
        }
      }
      if (weaponLv >= 3) star(0, -31, (tick >> 3) & 1 ? 6 : 5, blink ? '#fff1a5' : '#f6d47a'); // 코끝 왕별
    }
    if (magnetLeft > 0 && !inHangar) {
      ctx.strokeStyle = '#f1c78a55'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 42 + ((tick >> 3) % 5) * 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (masked > 0 && !inHangar) {
      ctx.fillStyle = '#e3bc96'; ctx.beginPath(); ctx.roundRect(-12, -13, 24, 24, 5); ctx.fill();
      ellipse(-5, -4, 3, 2, '#423c51'); ellipse(5, -4, 3, 2, '#423c51'); ellipse(1, 2, 5, 3, '#a57764');
      ctx.strokeStyle = '#423c51'; ctx.beginPath(); ctx.moveTo(-5, 7); ctx.lineTo(6, 5); ctx.stroke();
    }
    if (doll && !(mode === 'capture' && sceneTime > 1.5)) bear(23, 11, 0.65);
    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // 17. 그리기 — UFO · 화면
  // ═══════════════════════════════════════════════════════════════
  function ufo(x, y, t, beam = false, guest = null) {
    ctx.save(); ctx.translate(x, y);
    const stunned = guest ? guest.stun > 0 : primaryStun > 0;
    const spin = guest ? guest.spin || 0 : primarySpin;
    if (spin > 0) ctx.rotate((Math.round(spin * 8) * Math.PI) / 4);
    if (stunned) ctx.scale(1.12, 0.72);
    if (beam) {
      ctx.fillStyle = '#e6d1ff26'; ctx.beginPath();
      ctx.moveTo(-17, 10); ctx.lineTo(-52, playerY - y); ctx.lineTo(52, height - 110 - y); ctx.lineTo(17, 10);
      ctx.closePath(); ctx.fill();
    }
    ellipse(0, -6, 23, 22, '#9ddbd9'); ellipse(0, -4, 12, 12, taste === 2 ? '#f6c3df' : '#d0efaa');
    ellipse(-5, -4, 2, 3, '#33314d'); ellipse(5, -4, 2, 3, '#33314d');
    ellipse(0, 8, 43, 12, guest ? guest.color : '#bca5eb'); ellipse(0, 5, 38, 8, '#ded0f9');
    const fl = guest ? guest.flash || 0 : primaryFlash;
    if (fl > 0) { ctx.globalAlpha = 0.7; ellipse(0, 8, 43, 12, '#ffffff'); ellipse(0, -6, 23, 22, '#ffffff'); ctx.globalAlpha = 1; }
    const hpNow = guest ? guest.hp : primaryHp, hpMax = guest ? guest.max : primaryMax;
    if (hpMax && hpNow < hpMax && hpNow > 0 && !(guest && guest.scene)) {
      // 체력 칸 (한 번이라도 맞으면 표시)
      const segW = Math.min(6, Math.floor(70 / hpMax)), total = segW * hpMax;
      for (let i = 0; i < hpMax; i++) { ctx.fillStyle = i < hpNow ? '#a5f8d5' : '#4b3e65'; ctx.fillRect(-total / 2 + i * segW, -58, Math.max(2, segW - 1), 4); }
    }
    for (let i = -1; i <= 1; i++) ellipse(i * 23, 10, 3, 2, ((tick >> 4) + i + 3) % 3 === 0 ? '#ffffff' : '#ffe7a9');
    ctx.font = '19px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    if (!guest || guest.scene) for (let j = 0; j < Math.min(3, trophies); j++) bear(-15 + j * 14, -5, 0.34);
    const mark = stunned ? '✶'
      : guest ? (guest.scene ? '♥' : guest.grace > 0 ? '!' : '↔')
      : confusedLeft > 0 ? '?'
      : interested() ? '♥'
      : alienPhase === 'aim' ? '!'
      : observed.some((k) => k.endsWith(':' + taste)) ? tastes[taste].icon
      : '?';
    if (iconURL[mark] !== undefined) { ctx.save(); ctx.translate(0, -41); ctx.scale(0.8, 0.8); drawIcon(ctx, mark); ctx.restore(); }
    else ctx.fillText(mark, 0, -34);
    if (stunned) {
      ctx.strokeStyle = '#f9dba4'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(-3, 7); ctx.moveTo(-3, 0); ctx.lineTo(-10, 7);
      ctx.moveTo(3, 0); ctx.lineTo(10, 7); ctx.moveTo(10, 0); ctx.lineTo(3, 7); ctx.stroke();
    }
    ctx.restore();
  }
  function drawBackground(t) {
    const P = planet();
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, width, height);
    // 배경 별: 도트 1칸짜리, 반짝임도 두 단계로만
    for (let i = 0; i < 55; i++) {
      const tt = t + bgBoost * (1 + (i % 3)) - revScroll;
      const x = S((i * 137.31) % width), y = S(wrap(i * 83.71 + tt * (0.007 + (i % 3) * 0.004), height));
      if (worldMul() > 1.05) { ctx.globalAlpha = 0.6; ctx.fillStyle = '#d9d2f8'; ctx.fillRect(x, y - 30 * (worldMul() - 1), PX, 30 * (worldMul() - 1)); continue; }
      ctx.globalAlpha = Math.sin(t * 0.002 + i) > 0.3 ? 0.75 : 0.35;
      if (i % 9 === 0) star(x, y, 4, '#ffe6aa'); else { ctx.fillStyle = '#d9d2f8'; ctx.fillRect(x, y, PX, PX); }
    }
    ctx.globalAlpha = 1;
    const planetY = S(wrap(80 + (t + bgBoost - revScroll) * 0.005, height + 160) - 80);
    ctx.save(); ctx.translate(S(width - 52), planetY); ctx.rotate(-0.4);
    ellipse(0, 0, 30, 30, P.pl);
    ctx.strokeStyle = '#b4a0ce'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, 0, 47, 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 30, Math.PI, Math.PI * 2); ctx.fillStyle = P.pl2; ctx.fill();
    ellipse(-11, -13, 6, 4, '#a694c4'); ctx.restore();
    const moonY = S(wrap(height * 0.56 + (t + bgBoost - revScroll) * 0.009, height + 120) - 60);
    ellipse(36, moonY, 19, 19, '#415e79'); ellipse(30, moonY - 6, 5, 5, '#344e69'); ellipse(42, moonY + 5, 3, 3, '#344e69');
  }
  function drawRocks() {
    const P = planet();
    for (const o of obstacles) {
      const ox = S(o.x + 17), oy = S(o.y + 17);
      if (o.vx) {
        const sx = Math.sign(o.vx);
        ctx.strokeStyle = '#b9eadb66'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(ox - sx * 28, oy - 8); ctx.lineTo(ox - sx * 13, oy - 8); ctx.moveTo(ox - sx * 33, oy + 4); ctx.lineTo(ox - sx * 18, oy + 4);
        ctx.stroke();
      }
      ctx.save(); ctx.translate(ox, oy);
      ctx.rotate((Math.round((o.spin + elapsed * 0.4) / (Math.PI / 4)) * Math.PI) / 4);
      ctx.fillStyle = o.vx ? P.mover : P.rock; ctx.beginPath();
      for (let j = 0; j < 9; j++) { const a = (j * Math.PI * 2) / 9, r = 17 * (j % 2 ? 0.9 : 1); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ellipse(-5, -4, 4, 3, P.rockDark); ellipse(5, 4, 2.5, 3, P.rockDark); ellipse(3, -7, 2, 2, P.rockLite);
      ctx.restore();
      if (o.vx) {
        // 움직이는 운석: 색만이 아니라 진행 방향 화살표로도 구분
        const sx = Math.sign(o.vx);
        ctx.fillStyle = '#f3fffb'; ctx.beginPath();
        ctx.moveTo(ox + sx * 9, oy); ctx.lineTo(ox - sx * 3, oy - 7); ctx.lineTo(ox - sx * 3, oy + 7); ctx.closePath(); ctx.fill();
      }
    }
  }
  function drawPickups() {
    for (const item of pickups) {
      const ix = S(item.x), iy = S(item.y), g = items[item.type].group;
      ellipse(ix, iy, 20, 20, '#312d50');
      ctx.strokeStyle = g === 'animal' ? '#b3e2bc' : g === 'shiny' ? '#f4da91' : '#d1bbee'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ix, iy, 20, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(ix, iy); ctx.scale(1.2, 1.2); drawIcon(ctx, item.type); ctx.restore();
    }
  }
  function drawCombat() {
    if (weaponDrop) {
      const x = S(weaponDrop.x), y = S(weaponDrop.y);
      ellipse(x, y, 22, 22, '#55412a');
      ctx.strokeStyle = '#ffe39b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.stroke();
      star(x, y, 13, '#ffe39b');
      labels.push({ s: '★', x, y: y - 30, font: '14px monospace', color: '#ffe39b' });
    }
    for (const b of bullets) {
      const up = (b.dy || 1) > 0; // 꼬리는 날아가는 반대쪽
      if (b.big) { ctx.fillStyle = '#f6d47a88'; ctx.fillRect(S(b.x) - 3, S(b.y) + (up ? 7 : -23), 6, 16); star(S(b.x), S(b.y), 11, '#ffe6a0'); ellipse(S(b.x), S(b.y), 3, 3, '#ffffff'); }
      else if (b.diag) { ctx.fillStyle = '#a5f8d588'; ctx.fillRect(S(b.x - (b.vx > 0 ? 6 : -6)) - 2, S(b.y) + (up ? 4 : -12), 4, 8); star(S(b.x), S(b.y), 5, '#c9fff0'); }
      else { ctx.fillStyle = '#f4b98c'; ctx.fillRect(S(b.x) - 2, S(b.y) + (up ? 5 : -15), 4, 10); star(S(b.x), S(b.y), 6, '#fff1a5'); }
    }
    for (const bolt of bolts) {
      ctx.save(); ctx.translate(S(bolt.x), S(bolt.y)); ctx.rotate(bolt.life * 14);
      ctx.fillStyle = '#d7cfdd'; ctx.fillRect(-2, -2, 4, 4); ctx.fillRect(-4, -1, 8, 2); ctx.restore();
    }
  }
  // 상단 HUD 글자가 운석·행성과 겹쳐도 읽히도록 어둡게 깔아 주는 띠
  // (v0.9) 운석이 일찍 보이도록 옅게. 글자 가독성은 CSS 그림자가 맡습니다.
  let bandCache = null;
  function drawHudBand() {
    const bg = planet().bg;
    if (!bandCache || bandCache.bg !== bg) {
      const g0 = ctx.createLinearGradient(0, 0, 0, HUD_BAND);
      g0.addColorStop(0, bg + '8c'); g0.addColorStop(0.6, bg + '55'); g0.addColorStop(1, bg + '00');
      bandCache = { bg, g: g0 };
    }
    const g = bandCache.g;
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, HUD_BAND);
  }
  function drawCaptureScene(t) {
    const phase = sceneTime;
    ctx.fillStyle = '#15152d99'; ctx.fillRect(0, 0, width, height);
    ship(S(sceneX), S(sceneY - Math.sin((Math.min(phase, 1.5) / 1.5) * Math.PI) * 25), t);
    // 잡아간 UFO가 직접 데려갑니다. 나머지 UFO는 제자리에서 구경합니다.
    if (captureBy && !boss && primaryGone <= 0) ufo(S(ufoX), S(ufoY), t, false);
    if (!boss) for (const v of visitors) if (v !== captureBy) ufo(S(v.x), S(v.y), t, false, v);
    drawBoss();
    const ux = S(sceneX), uy = S(sceneY - 115 - Math.max(0, phase - 2.5) * 180);
    ufo(ux, uy, t, true, captureBy ? { color: captureBy.color, stun: 0, spin: 0, grace: 0, scene: true } : null);
    const extend = phase < 1 ? phase : phase < 1.8 ? 1 : Math.max(0, 1 - (phase - 1.8) / 1.3), endY = S(uy + 20 + extend * 88);
    ctx.strokeStyle = '#e2d6f6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ux + 23, uy + 12); ctx.lineTo(ux + 23, endY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ux + 14, endY); ctx.lineTo(ux + 17, endY + 8); ctx.lineTo(ux + 29, endY + 8); ctx.lineTo(ux + 32, endY); ctx.stroke();
    if (phase > 1.5 && sceneReturn === 'playing') {
      bear(ux + 23, endY + 12, 0.8);
      labels.push({ s: '…', x: sceneX - 35, y: sceneY - 33, font: '22px Arial', color: '#f6edff' });
    }
  }
  function draw(t) {
    if (!surfaceReady || low.width < 1 || low.height < 1 || canvas.width < 1 || canvas.height < 1) return;
    labels = [];
    ctx.clearRect(0, 0, width, height);
    drawBackground(t);
    drawRocks();
    drawPebbles();
    drawPickups();
    drawCombat();
    for (const p of particles) { ctx.globalAlpha = p.life * 0.5; star(S(p.x), S(p.y), 3 * p.life, '#ffdcab'); }
    ctx.globalAlpha = 1;
    if (mode !== 'ready') drawHudBand();
    const inCapture = mode === 'capture' || (mode === 'paused' && pausedFrom === 'capture');
    if (inCapture) drawCaptureScene(t);
    else {
      drawBoss();
      if (alienPhase === 'aim' && mode === 'playing' && !boss && primaryGone <= 0) {
        const ax = S(dashX), ay = S(dashY);
        ctx.save(); ctx.strokeStyle = '#efbddb99'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
        ctx.beginPath(); ctx.moveTo(S(ufoX), S(ufoY) + 12); ctx.lineTo(ax, ay); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(ax, ay, 22 + ((tick >> 3) & 1) * 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (hyperLeft > 0 || hyperEase > 0) {
        // 하이퍼: 도트 잔상 2개 + 가장자리 속도선
        const k = worldMul() - 1;
        ctx.globalAlpha = 0.28; ship(playerX, playerY + 20, t); ctx.globalAlpha = 0.13; ship(playerX, playerY + 40, t); ctx.globalAlpha = 1;
        ctx.fillStyle = '#a5f8d5';
        for (let i = 0; i < 14; i++) {
          const side = i % 2 ? width - 10 - (i * 7) % 40 : 6 + (i * 11) % 40;
          const ly = S((i * 97 + tick * 22) % (height + 80) - 40);
          ctx.globalAlpha = 0.35 * k / (HYPER_MUL - 1);
          ctx.fillRect(S(side), ly, PX, 40 + (i % 3) * 20);
        }
        ctx.globalAlpha = 1;
      }
      if (alienPhase === 'swirl' && mode === 'playing' && !boss && primaryGone <= 0) {
        // 빙글 구슬 예고: 보라 점선 + UFO 주위 빙글 고리
        const ax = S(dashX), ay = S(dashY);
        ctx.save(); ctx.strokeStyle = '#c9b5f4cc'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(S(ufoX), S(ufoY)); ctx.lineTo(ax, ay); ctx.stroke(); ctx.setLineDash([]);
        ctx.translate(S(ufoX), S(ufoY)); ctx.rotate(Math.round(tick / 4) * (Math.PI / 4));
        ctx.beginPath(); ctx.arc(0, 0, 52, 0, Math.PI * 1.4); ctx.stroke(); ctx.restore();
        labels.push({ s: '빙글!', x: ufoX, y: ufoY + (ufoY < playerY ? -62 : 70), font: 'bold 13px Arial', color: '#e4d6ff' });
      }
      if (swirlOrb) {
        const ox = S(swirlOrb.x), oy = S(swirlOrb.y);
        ellipse(ox, oy, 15, 15, '#7d5fd666'); ellipse(ox, oy, 11, 11, '#c9b5f4');
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(Math.round(tick / 3) * (Math.PI / 4)); drawIcon(ctx, 'swirl'); ctx.restore();
      }
      drawCompanions();
      ship(playerX, playerY, t);
      if (hyperLeft > 0) {
        ctx.strokeStyle = (tick >> 2) & 1 ? '#a5f8d5' : '#fff1aa'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(S(playerX), S(playerY), 38, 0, Math.PI * 2); ctx.stroke();
      }
      for (const sp of spills) {
        ctx.save(); ctx.translate(S(sp.x), S(sp.y)); ctx.rotate(Math.round(sp.spin * 2) * Math.PI / 4); ctx.globalAlpha = Math.min(1, sp.life * 1.5);
        drawIcon(ctx, sp.k); ctx.restore();
      }
      ctx.globalAlpha = 1;
      const live = ['playing', 'paused', 'over', 'dying'].includes(mode);
      if (live && !boss && primaryGone <= 0) ufo(S(ufoX), S(ufoY), t, mode !== 'dying' && (alienPhase === 'aim' || alienPhase === 'dash'));
      if (live && !boss) for (const v of visitors) ufo(S(v.x), S(v.y), t, false, v);
      drawEscapes();
      for (const c of coins) if (c.t >= 0) { ellipse(S(c.x), S(c.y), 6, 6, '#ffe39b44'); star(S(c.x), S(c.y), 5, '#ffe39b'); }
      for (const l of loot) {
        const x = S(l.x), y = S(l.y);
        ellipse(x, y, 19, 19, '#2b264399'); ctx.strokeStyle = (tick >> 3) & 1 ? '#f6d47a' : '#fff1aa'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.stroke();
        ctx.save(); ctx.translate(x, y); drawIcon(ctx, l.k); ctx.restore();
        labels.push({ s: '전리품!', x: l.x, y: l.y - 26, font: 'bold 11px Arial', color: '#f6d47a' });
      }
    }
    for (const f of confetti) { ctx.fillStyle = f.c; const w = (Math.round(f.spin) & 1) ? 6 : 3; ctx.fillRect(S(f.x) - w / 2, S(f.y) - 2, w, 9 - w); } // 회전 대신 납작↔길쭉 (가벼움)
    if (flashT > 0 && !REDUCED) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = Math.min(0.7, flashT * 4); ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1; }
    if (mode === 'dying' && deathFx) {
      const p = deathFx.t;
      if (p < 0.08 && !REDUCED) { ctx.fillStyle = '#ffffff55'; ctx.fillRect(0, 0, width, height); } // 순간 섬광
      ctx.strokeStyle = '#ffe6a0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(S(deathFx.x), S(deathFx.y), 10 + p * 110, 0, Math.PI * 2); ctx.stroke();
      if ((tick >> 2) & 1) { ctx.strokeStyle = '#ff8fb8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(S(deathFx.x), S(deathFx.y), 22, 0, Math.PI * 2); ctx.stroke(); }
      labels.push({ s: '탁!', x: deathFx.x, y: deathFx.y - 30, font: 'bold 16px Arial', color: '#ffb6d3' });
      ctx.strokeStyle = '#ffb6d3'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(S(playerX), S(playerY), 6 + p * 70, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of sparkles) { ctx.globalAlpha = Math.max(0, p.life * 2); star(S(p.x), S(p.y), 4, p.color); }
    ctx.globalAlpha = 1;
    if (nearClock > 0 && nearCombo > 0)
      labels.push({ s: 'NEAR! ×' + nearCombo, x: clamp(playerX, 65, width - 65), y: playerY - 55, font: '12px monospace', color: '#ffe5a0' });
    if (mode === 'hangar') { labels = []; renderHangar(t); }
    if (mode === 'intro') { labels = []; renderIntro(t); }
    // 저해상도 화면을 도트가 보이게 확대한 뒤, 작은 글자만 선명하게 덧그립니다.
    view.setTransform(1, 0, 0, 1, 0, 0); view.imageSmoothingEnabled = false;
    view.clearRect(0, 0, canvas.width, canvas.height);
    const sx = shake > 0 && !REDUCED ? Math.round((Math.random() - 0.5) * 10 * DPR) : 0, sy = shake > 0 && !REDUCED ? Math.round((Math.random() - 0.5) * 10 * DPR) : 0;
    view.drawImage(low, sx, sy, low.width * PX * DPR, low.height * PX * DPR);
    view.setTransform(DPR, 0, 0, DPR, 0, 0); view.textAlign = 'center';
    for (const l of labels) { view.font = l.font; view.fillStyle = l.color; view.fillText(l.s, l.x, l.y); }
  }

  // ═══════════════════════════════════════════════════════════════
  // 18. 화면 크기 (0 크기 보호 — 제거 금지)
  // ═══════════════════════════════════════════════════════════════
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width < 1 || r.height < 1) { surfaceReady = false; return false; }
    const ratio = width > 0 ? playerX / width : 0.5, yOffset = height - playerY;
    width = r.width; height = r.height;
    const w = Math.max(1, Math.round(width * DPR)), h = Math.max(1, Math.round(height * DPR));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const lw = Math.max(1, Math.ceil(width / PX)), lh = Math.max(1, Math.ceil(height / PX));
    if (low.width !== lw) low.width = lw;
    if (low.height !== lh) low.height = lh;
    ctx.setTransform(1 / PX, 0, 0, 1 / PX, 0, 0);
    playerX = targetX = S(clamp(width * ratio, 24, width - 24));
    playerY = targetY = S(clamp(height - yOffset, minY(), maxY()));
    ufoX = clamp(ufoX, 40, width - 40); ufoY = clamp(ufoY, 160, height - 115);
    surfaceReady = true;
    return true;
  }
  new ResizeObserver(resize).observe(canvas);

  // ═══════════════════════════════════════════════════════════════
  // 19. 입력
  // ═══════════════════════════════════════════════════════════════
  $('start').onclick = () => (mode === 'paused' ? pause() : start(mode === 'over' ? course : false));
  // 결과 띠: 버튼이 아닌 곳을 톡 = 바로 다시 (게임오버 직후 0.6초는 무시 — 하던 손짓으로 잘못 눌리지 않게)
  $('panel').addEventListener('click', (e) => {
    if (mode !== 'over' || !$('panel').classList.contains('quick')) return;
    if (e.target.closest('button, input, a, details, summary, .nick-box')) return;
    if (performance.now() - overAt < 600) return;
    start(course);
  });
  $('over-more').onclick = () => { $('panel').classList.remove('quick'); $('over-more').hidden = true; };
  $('rank-line').onclick = () => openBoard();
  $('board-tab-free').onclick = () => openBoard('free');
  $('board-nick').onclick = () => openIntro(true);
  $('intro-next').onclick = introNext; $('intro-skip').onclick = introSkip;
  { let sx = null; // 옆으로 밀어서 넘기기
    $('intro').addEventListener('pointerdown', (e) => { sx = e.target.closest('input, button') ? null : e.clientX; });
    $('intro').addEventListener('pointerup', (e) => { if (sx === null || introOnlyNick) return; const dx = e.clientX - sx; sx = null; if (dx < -50 && introStep < 3) showIntro(introStep + 1); else if (dx > 50 && introStep > 0) showIntro(introStep - 1); }); }
  $('intro-dice').onclick = () => { $('intro-nick-input').value = randomNick(); tone(700, 0.05); };
  $('intro-nick-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); closeIntro(true); } e.stopPropagation(); });
  $('board-tab-course').onclick = () => openBoard('course');
  $('nick-save').onclick = saveNick;
  $('nick-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNick(); } e.stopPropagation(); });
  $('board-open').onclick = () => openBoard(); $('board-close').onclick = closeBoard;
  $('pause').onclick = pause;
  $('mask').onclick = useMask;
  $('book-open').onclick = openBook; $('book-close').onclick = closeBook;
  $('journey-open').onclick = openJourney; $('journey-close').onclick = closeJourney;
  $('course-start').onclick = () => { if (mode === 'ready' || mode === 'over') start(true); };
  $('tutorial-open').onclick = () => { if (mode === 'ready' || mode === 'over') start(false, true); };
  $('share').onclick = shareResult;
  $('share-copy').onclick = copyShare; $('share-close').onclick = closeShare;
  $('share-app').onclick = () => { try { (window.NeonAndroid.shareResult || window.NeonAndroid.share).call(window.NeonAndroid, shareText); } catch {} };
  $('challenge-close').onclick = () => { $('challenge').hidden = true; };
  $('hangar-open').onclick = openHangar; $('hangar-close').onclick = closeHangar;
  $('sound').onclick = () => { sound = !sound; store.set(KEY_SOUND, sound ? '1' : '0'); refreshSound(); if (sound) tone(660); sync(); };
  $('haptic').onclick = () => { haptic = !haptic; store.set(KEY_HAPTIC, haptic ? '1' : '0'); refreshHaptic(); buzz(30); };

  // 드래그는 '목표 지점'만 옮기고, 기체는 고정 속도로 그 지점을 따라갑니다. (원본 유지)
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'playing' || dragging) return;
    activePointer = e.pointerId; dragging = true;
    targetX = playerX; targetY = playerY;
    previousPointer = e.clientX; previousPointerY = e.clientY;
    pointerStart = performance.now(); pointerDistance = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== activePointer) return;
    const dx = e.clientX - previousPointer, dy = e.clientY - previousPointerY;
    pointerDistance += Math.hypot(dx, dy);
    targetX += dx; targetY += dy; clampTarget();
    previousPointer = e.clientX; previousPointerY = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerId !== activePointer) return;
    const now = performance.now();
    if (dragging) {
      // 짧은 탭 = 위장. 단, 드래그 직후 손가락을 다시 대는 순간(0.35초 이내)은 탭으로 보지 않습니다.
      if (pointerDistance < 9 && now - pointerStart < 250) { if (pointerStart - lastDragEnd > 350) useMask(); }
      else lastDragEnd = now;
    }
    dragging = false;
  });
  for (const type of ['pointercancel', 'lostpointercapture'])
    canvas.addEventListener(type, (e) => { if (e.pointerId === activePointer) { dragging = false; activePointer = null; } });

  // 키는 e.code 기준 — 한글 입력 상태에서도 WASD / M이 동작합니다.
  const BLOCK = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Escape', 'KeyM'];
  window.addEventListener('keydown', (e) => {
    const code = e.code || e.key;
    if (BLOCK.includes(code)) e.preventDefault();
    keys.add(code);
    if (e.repeat) return;
    if (code === 'Escape') {
      if (!$('share-panel').hidden) closeShare();
      else if (mode === 'book') closeBook();
      else if (mode === 'journey') closeJourney();
      else if (mode === 'intro') introSkip();
      else if (mode === 'board') closeBoard();
      else if (mode === 'hangar') closeHangar();
      else if (['playing', 'capture', 'paused'].includes(mode)) pause();
    }
    if (code === 'KeyM') useMask();
    if (code === 'Space') {
      if (mode === 'ready' || mode === 'over') start(mode === 'over' ? course : false);
      else if (mode === 'playing') useMask();
      else if (mode === 'paused') pause();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code || e.key));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ['playing', 'capture'].includes(mode)) pause();
    keys.clear(); dragging = false;
  });
  window.addEventListener('blur', () => { keys.clear(); if (['playing', 'capture'].includes(mode)) pause(); });

  // ═══════════════════════════════════════════════════════════════
  // 20. 메인 루프 — 고정 60Hz 로직: 화면 주사율과 관계없이 매 틱 같은 거리만 움직입니다.
  // ═══════════════════════════════════════════════════════════════
  function frame(t) {
    if ((!surfaceReady || low.width < 1 || low.height < 1 || canvas.width < 1 || canvas.height < 1) && !resize()) {
      acc = 0; last = t; requestAnimationFrame(frame); return;
    }
    acc += Math.min(t - last || 0, 250) / 1000;
    last = t;
    while (acc >= STEP) { update(STEP); tick++; acc -= STEP; }
    draw(t);
    requestAnimationFrame(frame);
  }
  $('mascot').src = iconURL.rocket;
  // 섹션 제목: data-h의 {아이콘}을 도트 그림으로, data-s는 오른쪽 작은 설명
  for (const h of document.querySelectorAll('[data-h]')) h.innerHTML = '<span>' + rich(h.dataset.h) + '</span>' + (h.dataset.s ? '<small>' + h.dataset.s + '</small>' : '');
  try { document.fonts && (document.fonts.load('40px OnePop'), document.fonts.load('900 40px NSN')); } catch {} // 결과 카드 캔버스에 쓰기 전 미리 로드
  { const tok = (location.hash || '').slice(1); const c = tok ? decodeCard(tok) : null; if (c) setTimeout(() => openChallenge(c), 200); }
  renderGoal();
  if (scoreReset) $('message').textContent = '점수 기준이 바뀌어서 최고 기록을 새로 시작해요. 도감·장식·친구는 그대로예요!';
  refreshSound();
  refreshHaptic();
  loadDaily(); saveDaily(); renderDaily();
  renderDebug();
  refreshBook();
  resize();
  sync();
  requestAnimationFrame((t) => { last = t; frame(t); });
})();

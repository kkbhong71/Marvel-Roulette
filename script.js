/* ==========================================================================
   Neon Marble Race - Core Logic & Physics Engine
   Powered by Matter.js & Web Audio API & HTML5 Canvas
   ========================================================================== */

// 1. Matter.js Module Aliases
const { Engine, World, Bodies, Body, Composite, Events, Vector } = Matter;

// 2. Application State Variables
let engine;
let world;
let canvas;
let ctx;

let marbles = [];
let staticObstacles = [];
let bumpers = [];
let spinners = [];
let portals = [];
let boostZones = [];
let confettiParticles = [];
let visualEffects = []; // 포탈 스파크, 충돌 플래시 등

let gameStatus = 'READY'; // READY, RACING, FINISHED
let winner = null;
let selectedTheme = 'plinko';
let leaderboardTimer = 0;

// 물리 세팅
let gravityVal = 1.0;
let bouncinessVal = 0.6;

// 3. 오디오 합성 모듈 (Web Audio API)
let audioCtx = null;
let soundEnabled = true;

const NEON_COLORS = [
    { color: '#ff007f', shadow: 'rgba(255, 0, 127, 0.6)', name: '네온 핑크' },
    { color: '#00f0ff', shadow: 'rgba(0, 240, 255, 0.6)', name: '네온 블루' },
    { color: '#39ff14', shadow: 'rgba(57, 255, 20, 0.6)', name: '네온 그린' },
    { color: '#bd00ff', shadow: 'rgba(189, 0, 255, 0.6)', name: '네온 퍼플' },
    { color: '#fff000', shadow: 'rgba(255, 240, 0, 0.6)', name: '네온 옐로우' },
    { color: '#ff5e00', shadow: 'rgba(255, 94, 0, 0.6)', name: '네온 오렌지' },
    { color: '#ff00f0', shadow: 'rgba(255, 0, 240, 0.6)', name: '네온 마젠타' },
    { color: '#00ffcc', shadow: 'rgba(0, 255, 204, 0.6)', name: '네온 아쿠아' }
];

// 초기 사운드 활성화 (사용자 액션 시 작동)
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 실시간 합성음 연주 함수
function playSynthSound(freqStart, freqEnd, type, duration = 0.1, volume = 0.3) {
    if (!soundEnabled || !audioCtx) return;
    
    try {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.frequency.setValueAtTime(freqStart, audioCtx.currentTime);
        
        if (type === 'bumper') {
            osc.type = 'triangle';
            osc.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + duration);
            gainNode.gain.setValueAtTime(volume * 1.5, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        } else if (type === 'warp') {
            osc.type = 'sine';
            osc.frequency.linearRampToValueAtTime(freqEnd, audioCtx.currentTime + duration);
            gainNode.gain.setValueAtTime(volume * 0.8, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        } else if (type === 'boost') {
            osc.type = 'triangle';
            osc.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + duration);
            gainNode.gain.setValueAtTime(volume * 0.4, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        } else if (type === 'win') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freqStart, audioCtx.currentTime);
            osc.frequency.setValueAtTime(freqEnd, audioCtx.currentTime + 0.15);
            gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        } else {
            // 일반 핀/벽 충돌
            osc.type = 'sine';
            osc.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + duration);
            gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        }
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn('Audio Synthesis Error:', e);
    }
}

// 4. 초기화 및 이벤트 리스너 바인딩
window.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('race-canvas');
    ctx = canvas.getContext('2d');
    
    // Matter.js 엔진 기동
    engine = Engine.create();
    world = engine.world;
    world.gravity.y = gravityVal;
    
    // UI 및 설정 이벤트 등록
    setupUIEventListeners();
    
    // 기본 후보 자동 생성
    document.getElementById('candidates-input').value = "홍길동, 임꺽정, 장길산, 전우치, 이순신, 세종대왕, 을지문덕, 광개토대왕";
    parseCandidates();
    
    // 첫 테마 로드
    loadCourseTheme('plinko');
    
    // Matter 엔진 업데이트 루프 및 커스텀 렌더 루프 가동
    requestAnimationFrame(renderLoop);
});

// UI 컨트롤 연동
function setupUIEventListeners() {
    const btnStart = document.getElementById('btn-start');
    const btnReset = document.getElementById('btn-reset');
    const btnSound = document.getElementById('btn-sound');
    const themeSelect = document.getElementById('theme-select');
    const textarea = document.getElementById('candidates-input');
    
    // 슬라이더들
    const gravitySlider = document.getElementById('gravity-slider');
    const bouncinessSlider = document.getElementById('bounciness-slider');
    const gravityValEl = document.getElementById('gravity-val');
    const bouncinessValEl = document.getElementById('bounciness-val');
    
    // 텍스트 입력 시 후보 카운터 갱신
    textarea.addEventListener('input', parseCandidates);
    
    // 슬라이더 조절
    gravitySlider.addEventListener('input', (e) => {
        gravityVal = parseFloat(e.target.value);
        gravityValEl.textContent = gravityVal.toFixed(1) + 'x';
        world.gravity.y = gravityVal;
    });
    
    bouncinessSlider.addEventListener('input', (e) => {
        bouncinessVal = parseFloat(e.target.value);
        bouncinessValEl.textContent = bouncinessVal.toFixed(2);
        marbles.forEach(m => {
            m.restitution = bouncinessVal;
        });
    });
    
    // 테마 전환
    themeSelect.addEventListener('change', (e) => {
        selectedTheme = e.target.value;
        loadCourseTheme(selectedTheme);
        resetRace();
    });
    
    // 시작 및 재설정
    btnStart.addEventListener('click', () => {
        initAudio();
        startRace();
    });
    
    btnReset.addEventListener('click', () => {
        initAudio();
        resetRace();
    });
    
    // 사운드 토글
    btnSound.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        if (soundEnabled) {
            btnSound.classList.add('active');
            document.getElementById('sound-status-text').textContent = '사운드 켬';
        } else {
            btnSound.classList.remove('active');
            document.getElementById('sound-status-text').textContent = '사운드 끔';
        }
        initAudio();
    });
    
    // 모달 닫기
    document.getElementById('btn-close-modal').addEventListener('click', () => {
        document.getElementById('winner-modal').classList.remove('show');
    });
}

// 후보 텍스트 줄바꿈/쉼표 기준으로 파싱
let candidatesList = [];
function parseCandidates() {
    const text = document.getElementById('candidates-input').value;
    // 쉼표와 줄바꿈 모두 처리
    candidatesList = text.split(/[\n,]+/)
        .map(name => name.trim())
        .filter(name => name.length > 0);
        
    document.getElementById('candidate-count').textContent = candidatesList.length;
}

// 5. 물리 월드 구성 및 6가지 테마 레이아웃 디자인

function loadCourseTheme(theme) {
    // 1. 기존 테마 장애물 비우기
    clearActiveThemeObstacles();
    
    // 2. 월드 테두리 벽 및 하단 골인 깔때기 생성
    createOuterBoundaries();
    
    // 3. 테마별 커스텀 장애물 건설
    const activeBadge = document.getElementById('active-theme-badge');
    
    switch (theme) {
        case 'plinko':
            activeBadge.textContent = '테마 1: 플린코 익스트림';
            buildPlinkoTheme();
            break;
        case 'vortex':
            activeBadge.textContent = '테마 2: 소용돌이 다운힐';
            buildVortexTheme();
            break;
        case 'zigzag':
            activeBadge.textContent = '테마 3: 지그재그 슬라이드';
            buildZigzagTheme();
            break;
        case 'pinball':
            activeBadge.textContent = '테마 4: 핀볼 범퍼 익스프레스';
            buildPinballTheme();
            break;
        case 'portal':
            activeBadge.textContent = '테마 5: 웜홀 포탈 레이싱';
            buildPortalTheme();
            break;
        case 'booster':
            activeBadge.textContent = '테마 6: 무중력 스페이스 부스터';
            buildBoosterTheme();
            break;
    }
}

// 테마 초기화
function clearActiveThemeObstacles() {
    if (world) {
        Composite.clear(world, false); // 모든 바디 제거 (컨페티 등 월드 외부 드로잉 제외)
        staticObstacles = [];
        bumpers = [];
        spinners = [];
        portals = [];
        boostZones = [];
        marbles = [];
    }
}

// 기본 경계 및 하단 골인 퍼널 설치
function createOuterBoundaries() {
    // 좌우 외곽 벽 (구슬이 나가지 않도록 두껍게 배치)
    const leftWall = Bodies.rectangle(-10, 600, 40, 1200, { isStatic: true, friction: 0 });
    const rightWall = Bodies.rectangle(610, 600, 40, 1200, { isStatic: true, friction: 0 });
    const topCeiling = Bodies.rectangle(300, -20, 600, 40, { isStatic: true });
    
    // 하단 깔때기 Chutes (X: 300 골인 게이트로 구슬을 유도)
    const leftSlope = Bodies.rectangle(135, 1130, 310, 16, { 
        isStatic: true, 
        angle: Math.PI / 11, // 사선 하강
        friction: 0.05,
        label: 'funnel'
    });
    const rightSlope = Bodies.rectangle(465, 1130, 310, 16, { 
        isStatic: true, 
        angle: -Math.PI / 11, // 사선 하강
        friction: 0.05,
        label: 'funnel'
    });
    
    // 우승 게이트 홀더 (구슬을 하나씩 진입하게 좁게 구성)
    const gateLeft = Bodies.rectangle(275, 1175, 10, 50, { isStatic: true, friction: 0, label: 'gate' });
    const gateRight = Bodies.rectangle(325, 1175, 10, 50, { isStatic: true, friction: 0, label: 'gate' });
    const bottomFloor = Bodies.rectangle(300, 1205, 60, 10, { isStatic: true, label: 'gate_floor' });
    
    // 우승 감지 센서 (물리 충돌은 없지만 터치 감지 가능)
    const goalSensor = Bodies.rectangle(300, 1192, 40, 10, {
        isStatic: true,
        isSensor: true,
        label: 'goal_sensor'
    });
    
    Composite.add(world, [leftWall, rightWall, topCeiling, leftSlope, rightSlope, gateLeft, gateRight, bottomFloor, goalSensor]);
    
    // 드로잉용 가이드
    staticObstacles.push({ body: leftSlope, color: '#ff007f', thickness: 4 });
    staticObstacles.push({ body: rightSlope, color: '#ff007f', thickness: 4 });
    staticObstacles.push({ body: gateLeft, color: '#ff007f', thickness: 2 });
    staticObstacles.push({ body: gateRight, color: '#ff007f', thickness: 2 });
}

/* --- 테마 1: 플린코 익스트림 --- */
function buildPlinkoTheme() {
    const rows = 18;
    const startY = 100;
    const endY = 1020;
    const gapY = (endY - startY) / (rows - 1);
    
    for (let i = 0; i < rows; i++) {
        const y = startY + i * gapY;
        const cols = (i % 2 === 0) ? 9 : 8;
        const startX = (i % 2 === 0) ? 40 : 75;
        const gapX = (600 - startX * 2) / (cols - 1);
        
        for (let j = 0; j < cols; j++) {
            const x = startX + j * gapX;
            // 촘촘히 배치된 static 핀 생성
            const peg = Bodies.circle(x, y, 6, { 
                isStatic: true, 
                restitution: 0.7, 
                label: 'peg'
            });
            Composite.add(world, peg);
            staticObstacles.push({ body: peg, type: 'peg', color: '#00f0ff', glow: true });
        }
    }
}

/* --- 테마 2: 소용돌이 다운힐 --- */
function buildVortexTheme() {
    const centerX = 300;
    const centerY = 450;
    const spiralPegCount = 100;
    
    // 수식에 의한 소용돌이 벽 핀 배치
    for (let i = 0; i < spiralPegCount; i++) {
        const theta = 0.08 * i * Math.PI;
        const radius = 380 - (i * 3.6);
        
        if (radius < 45) break; // 중앙 통과는 허용
        
        const x = centerX + radius * Math.cos(theta);
        const y = centerY + radius * Math.sin(theta);
        
        const peg = Bodies.circle(x, y, 5, { 
            isStatic: true, 
            restitution: 0.5, 
            label: 'peg' 
        });
        Composite.add(world, peg);
        staticObstacles.push({ body: peg, type: 'vortex_peg', color: '#bd00ff', glow: true });
    }
    
    // 소용돌이 바깥 가이드라인 추가
    const leftGuide = Bodies.rectangle(100, 160, 200, 10, { isStatic: true, angle: Math.PI / 12, label: 'guide' });
    const rightGuide = Bodies.rectangle(500, 160, 200, 10, { isStatic: true, angle: -Math.PI / 12, label: 'guide' });
    Composite.add(world, [leftGuide, rightGuide]);
    staticObstacles.push({ body: leftGuide, color: '#bd00ff' });
    staticObstacles.push({ body: rightGuide, color: '#bd00ff' });
    
    // 중앙 홀 통과 후 낙하지점 장애물들
    const underPeg1 = Bodies.circle(230, 960, 8, { isStatic: true, label: 'peg' });
    const underPeg2 = Bodies.circle(370, 960, 8, { isStatic: true, label: 'peg' });
    const centerPeg = Bodies.circle(300, 1020, 8, { isStatic: true, label: 'peg' });
    Composite.add(world, [underPeg1, underPeg2, centerPeg]);
    staticObstacles.push({ body: underPeg1, type: 'peg', color: '#ff007f' });
    staticObstacles.push({ body: underPeg2, type: 'peg', color: '#ff007f' });
    staticObstacles.push({ body: centerPeg, type: 'peg', color: '#00f0ff' });
}

/* --- 테마 3: 지그재그 슬라이드 --- */
function buildZigzagTheme() {
    const slideConfigs = [
        { x: 220, y: 150, w: 460, h: 12, angle: Math.PI / 16 },
        { x: 380, y: 280, w: 460, h: 12, angle: -Math.PI / 16 },
        { x: 220, y: 410, w: 460, h: 12, angle: Math.PI / 16 },
        { x: 380, y: 540, w: 460, h: 12, angle: -Math.PI / 16 },
        { x: 220, y: 670, w: 460, h: 12, angle: Math.PI / 16 },
        { x: 380, y: 800, w: 460, h: 12, angle: -Math.PI / 16 },
        { x: 220, y: 930, w: 460, h: 12, angle: Math.PI / 16 },
        { x: 250, y: 1050, w: 320, h: 12, angle: Math.PI / 20 }
    ];
    
    slideConfigs.forEach((cfg, idx) => {
        const slide = Bodies.rectangle(cfg.x, cfg.y, cfg.w, cfg.h, { 
            isStatic: true, 
            angle: cfg.angle, 
            friction: 0.01,
            label: 'slide'
        });
        Composite.add(world, slide);
        staticObstacles.push({ body: slide, color: '#39ff14', thickness: 3 });
        
        // 슬라이더 끝자락에 통통 튀는 탄성 범퍼 배치해 레이싱 가속
        const bumperX = (idx % 2 === 0) ? 470 : 130;
        const bumperY = cfg.y + 55;
        if (idx < 7) {
            const bumper = Bodies.circle(bumperX, bumperY, 15, { 
                isStatic: true, 
                restitution: 1.2, 
                label: 'bumper'
            });
            Composite.add(world, bumper);
            bumpers.push({ body: bumper, radius: 15, color: '#ff007f', hit: 0 });
        }
    });
}

/* --- 테마 4: 핀볼 범퍼 익스프레스 --- */
function buildPinballTheme() {
    // 1. 대형 핀볼 원형 범퍼들 (충돌 시 화려하게 반응하고 튕겨냄)
    const bumperPositions = [
        { x: 180, y: 220, r: 24, color: '#ff007f' },
        { x: 420, y: 220, r: 24, color: '#ff007f' },
        { x: 300, y: 340, r: 30, color: '#bd00ff' },
        { x: 150, y: 480, r: 24, color: '#00f0ff' },
        { x: 450, y: 480, r: 24, color: '#00f0ff' },
        { x: 300, y: 620, r: 28, color: '#39ff14' },
        { x: 180, y: 760, r: 24, color: '#ff007f' },
        { x: 420, y: 760, r: 24, color: '#ff007f' },
        { x: 300, y: 900, r: 20, color: '#fff000' }
    ];
    
    bumperPositions.forEach(pos => {
        const bumper = Bodies.circle(pos.x, pos.y, pos.r, {
            isStatic: true,
            restitution: 1.3,
            label: 'bumper'
        });
        Composite.add(world, bumper);
        bumpers.push({ body: bumper, radius: pos.r, color: pos.color, hit: 0 });
    });
    
    // 2. 강제로 쉬지 않고 돌아가는 모터 회전 바 (Spinners)
    const spinnerConfigs = [
        { x: 150, y: 340, w: 100, h: 10, speed: 0.04 },
        { x: 450, y: 340, w: 100, h: 10, speed: -0.04 },
        { x: 300, y: 480, w: 120, h: 10, speed: 0.05 },
        { x: 150, y: 880, w: 100, h: 10, speed: -0.04 },
        { x: 450, y: 880, w: 100, h: 10, speed: 0.04 }
    ];
    
    spinnerConfigs.forEach(cfg => {
        const bar = Bodies.rectangle(cfg.x, cfg.y, cfg.w, cfg.h, {
            isStatic: true,
            label: 'spinner'
        });
        Composite.add(world, bar);
        spinners.push({ body: bar, width: cfg.w, height: cfg.h, speed: cfg.speed });
    });
    
    // 3. 핀볼 슬링샷 삼각형 벽면 장식
    const leftSling = Bodies.rectangle(80, 1040, 100, 15, { isStatic: true, angle: Math.PI/6, restitution: 1.1 });
    const rightSling = Bodies.rectangle(520, 1040, 100, 15, { isStatic: true, angle: -Math.PI/6, restitution: 1.1 });
    Composite.add(world, [leftSling, rightSling]);
    staticObstacles.push({ body: leftSling, color: '#fff000' });
    staticObstacles.push({ body: rightSling, color: '#fff000' });
}

/* --- 테마 5: 웜홀 포탈 레이싱 --- */
function buildPortalTheme() {
    // 포탈 한 쌍씩 정의 (진입 -> 탈출 링크)
    const portalPairs = [
        { id: 1, name: '워프 A (블루)', entryX: 130, entryY: 220, exitX: 470, exitY: 550, color: '#00f0ff' },
        { id: 2, name: '워프 B (핑크)', entryX: 470, entryY: 220, exitX: 130, exitY: 550, color: '#ff007f' },
        { id: 3, name: '워프 C (옐로)', entryX: 300, entryY: 440, exitX: 300, exitY: 780, color: '#fff000' },
        { id: 4, name: '워프 D (그린)', entryX: 150, entryY: 720, exitX: 450, exitY: 920, color: '#39ff14' },
        { id: 5, name: '워프 E (퍼플)', entryX: 450, entryY: 720, exitX: 150, exitY: 920, color: '#bd00ff' }
    ];
    
    portalPairs.forEach(p => {
        // 입구 포탈 (센서용)
        const entryBody = Bodies.circle(p.entryX, p.entryY, 18, { isStatic: true, isSensor: true, label: 'portal_entry' });
        // 출구 포탈 (센서용)
        const exitBody = Bodies.circle(p.exitX, p.exitY, 18, { isStatic: true, isSensor: true, label: 'portal_exit' });
        
        Composite.add(world, [entryBody, exitBody]);
        
        portals.push({
            id: p.id,
            color: p.color,
            entryBody: entryBody,
            exitBody: exitBody,
            exitX: p.exitX,
            exitY: p.exitY,
            angle: 0
        });
    });
    
    // 추가적인 플린코 핀으로 경로 무작위성 확보
    const pins = [
        {x: 300, y: 150}, {x: 200, y: 150}, {x: 400, y: 150},
        {x: 150, y: 340}, {x: 450, y: 340},
        {x: 230, y: 480}, {x: 370, y: 480},
        {x: 200, y: 640}, {x: 400, y: 640}, {x: 300, y: 660},
        {x: 230, y: 840}, {x: 370, y: 840},
        {x: 300, y: 980}, {x: 180, y: 1020}, {x: 420, y: 1020}
    ];
    pins.forEach(pos => {
        const pin = Bodies.circle(pos.x, pos.y, 6, { isStatic: true, label: 'peg' });
        Composite.add(world, pin);
        staticObstacles.push({ body: pin, type: 'peg', color: '#bd00ff' });
    });
}

/* --- 테마 6: 무중력 스페이스 부스터 --- */
function buildBoosterTheme() {
    // 1. 역중력/상승 기류가 발생하는 특수 구역 (Green Neon Boxes)
    boostZones.push({
        x: 60, y: 340, w: 160, h: 460,
        forceX: 0, forceY: -0.00062, // 강력한 공중부양 힘
        color: 'rgba(57, 255, 20, 0.08)',
        particles: []
    });
    boostZones.push({
        x: 380, y: 340, w: 160, h: 460,
        forceX: 0, forceY: -0.00062,
        color: 'rgba(57, 255, 20, 0.08)',
        particles: []
    });
    
    // 기류 구역 파티클 초기화
    boostZones.forEach(zone => {
        for (let i = 0; i < 25; i++) {
            zone.particles.push({
                x: zone.x + Math.random() * zone.w,
                y: zone.y + Math.random() * zone.h,
                speed: 1 + Math.random() * 2,
                size: 1 + Math.random() * 2
            });
        }
    });
    
    // 2. 부스터를 향해 흘러가게 만드는 보조 빗면
    const slideL = Bodies.rectangle(120, 180, 240, 12, { isStatic: true, angle: Math.PI / 10, label: 'slide' });
    const slideR = Bodies.rectangle(480, 180, 240, 12, { isStatic: true, angle: -Math.PI / 10, label: 'slide' });
    
    // 3. 부스터 사이 탈출 구간 가이드
    const centerBlock = Bodies.rectangle(300, 650, 100, 30, { isStatic: true, label: 'slide' });
    
    // 4. 하단 떨어지는 곳의 범퍼 핀
    const bottomPeg1 = Bodies.circle(180, 1000, 10, { isStatic: true, label: 'peg' });
    const bottomPeg2 = Bodies.circle(420, 1000, 10, { isStatic: true, label: 'peg' });
    const centerBumper = Bodies.circle(300, 1030, 22, { isStatic: true, restitution: 1.2, label: 'bumper' });
    
    Composite.add(world, [slideL, slideR, centerBlock, bottomPeg1, bottomPeg2, centerBumper]);
    
    staticObstacles.push({ body: slideL, color: '#39ff14' });
    staticObstacles.push({ body: slideR, color: '#39ff14' });
    staticObstacles.push({ body: centerBlock, color: '#39ff14' });
    staticObstacles.push({ body: bottomPeg1, type: 'peg', color: '#ff007f' });
    staticObstacles.push({ body: bottomPeg2, type: 'peg', color: '#ff007f' });
    bumpers.push({ body: centerBumper, radius: 22, color: '#fff000', hit: 0 });
}

// 6. 구슬 생성 및 레이스 시작 로직

function spawnMarbles() {
    // 기존 구슬 완전 클리어
    marbles.forEach(m => Composite.remove(world, m));
    marbles = [];
    
    if (candidatesList.length === 0) {
        parseCandidates();
    }
    
    const count = candidatesList.length;
    
    // 시작 지점 분배 계산 (상단 40px ~ 80px 높이)
    candidatesList.forEach((name, i) => {
        // 서로 겹쳐서 폭발하지 않도록 일정한 그리드 배치
        const cols = Math.min(8, count);
        const colIdx = i % cols;
        const rowIdx = Math.floor(i / cols);
        
        // 캔버스 가로 600의 중앙 배치
        const startX = 300 - ((cols - 1) * 26) / 2 + colIdx * 26 + (Math.random() - 0.5) * 5;
        const startY = 40 + rowIdx * 26 + (Math.random() - 0.5) * 5;
        
        const radius = 11; // 구슬 반경
        const colorObj = NEON_COLORS[i % NEON_COLORS.length];
        
        const marble = Bodies.circle(startX, startY, radius, {
            restitution: bouncinessVal,
            friction: 0.005,
            density: 0.001,
            label: 'marble',
            collisionFilter: {
                group: 0
            }
        });
        
        // 구슬에 레이스 전용 메타데이터 커스텀 추가
        marble.candidateName = name;
        marble.color = colorObj.color;
        marble.shadow = colorObj.shadow;
        marble.trail = []; // 과거 궤적을 촘촘히 보관
        marble.portalCooldown = 0;
        marble.originalRadius = radius;
        
        Composite.add(world, marble);
        marbles.push(marble);
    });
}

function startRace() {
    if (gameStatus === 'RACING') return;
    
    // 상태 초기화
    winner = null;
    confettiParticles = [];
    visualEffects = [];
    
    // 구슬 젠
    spawnMarbles();
    
    gameStatus = 'RACING';
    document.getElementById('game-status-indicator').textContent = '🏎️ 레이스 진행 중!';
    document.getElementById('game-status-indicator').style.color = '#ff007f';
    document.getElementById('game-status-indicator').style.textShadow = '0 0 8px rgba(255, 0, 127, 0.4)';
    
    // 시작음 합성
    playSynthSound(440, 880, 'boost', 0.25, 0.4);
}

function resetRace() {
    gameStatus = 'READY';
    winner = null;
    confettiParticles = [];
    visualEffects = [];
    
    document.getElementById('game-status-indicator').textContent = '대기 중...';
    document.getElementById('game-status-indicator').style.color = '#39ff14';
    document.getElementById('game-status-indicator').style.textShadow = '0 0 8px rgba(57, 255, 20, 0.4)';
    
    // 모달 숨기기
    document.getElementById('winner-modal').classList.remove('show');
    
    // 구슬 다시 생성
    spawnMarbles();
    
    // 리더보드 초기화
    updateLeaderboardDOM(true);
}

// 7. 실시간 충돌 리스너 및 음향 재생 바인딩
Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        
        // 구슬이 어디에 부딪혔는지 감지
        const marble = (bodyA.label === 'marble') ? bodyA : (bodyB.label === 'marble') ? bodyB : null;
        const other = (marble === bodyA) ? bodyB : bodyA;
        
        if (marble && other) {
            // 충돌 상대 속도 측정하여 볼륨 조절
            const speed = Vector.magnitude(Vector.sub(marble.velocity, other.velocity)) || 1;
            const volume = Math.min(0.8, Math.max(0.1, speed * 0.15));
            
            // 1. 범퍼에 닿았을 때 (핀볼 및 무중력 하단)
            if (other.label === 'bumper') {
                // 부딪힌 범퍼 반짝이 및 팝업 효과
                const bumperObj = bumpers.find(b => b.body === other);
                if (bumperObj) {
                    bumperObj.hit = 1.0; // 충돌 시 최대 크기로 스케일 팽창 유발
                }
                
                // Matter.js 바디 밀어내기 효과 증폭 (범퍼 본연의 통통 튕김 강제력 부여)
                const pushDir = Vector.normalise(Vector.sub(marble.position, other.position));
                Body.applyForce(marble, marble.position, Vector.mult(pushDir, 0.005 * gravityVal));
                
                // 범퍼 특화 경쾌한 맑은 소리 합성
                playSynthSound(780, 260, 'bumper', 0.16, volume * 1.5);
                createSparks(marble.position.x, marble.position.y, marble.color, 8);
            }
            
            // 2. 일반 핀(Peg) 충돌
            else if (other.label === 'peg') {
                playSynthSound(420, 180, 'peg', 0.08, volume * 0.8);
                createSparks(marble.position.x, marble.position.y, '#ffffff', 3);
            }
            
            // 3. 외곽 슬라이드/가이드/깔때기
            else if (other.label === 'slide' || other.label === 'funnel') {
                if (speed > 1.5) {
                    playSynthSound(330, 110, 'slide', 0.05, volume * 0.5);
                }
            }
            
            // 4. 골인 센서 통과 시 우승 처리
            else if (other.label === 'goal_sensor' && gameStatus === 'RACING') {
                declareWinner(marble);
            }
        }
    });
});

// 우승 처리 및 세리머니 시작
function declareWinner(marbleBody) {
    if (winner) return; // 이미 우승 구슬이 골인함
    
    winner = marbleBody;
    gameStatus = 'FINISHED';
    
    document.getElementById('game-status-indicator').textContent = '🏁 레이스 종료!';
    document.getElementById('game-status-indicator').style.color = '#fff000';
    document.getElementById('game-status-indicator').style.textShadow = '0 0 10px rgba(255, 240, 0, 0.6)';
    
    // 실시간 리더보드 즉각 전체 갱신
    updateLeaderboardDOM(false);
    
    // 축하 멜로디 합성 재생 (Web Audio API)
    playSynthSound(523.25, 783.99, 'win', 0.4, 0.5); // C5 -> G5 멜로디
    setTimeout(() => playSynthSound(659.25, 1046.50, 'win', 0.6, 0.5), 180); // E5 -> C6 타건
    
    // 우승 모달 팝업
    const modal = document.getElementById('winner-modal');
    document.getElementById('winner-name-display').textContent = winner.candidateName;
    document.getElementById('winner-name-display').style.textShadow = `0 0 20px ${winner.shadow}`;
    modal.classList.add('show');
    
    // 디지털 폭죽 파티클 (컨페티) 대량 생성
    spawnConfettiShower();
}

// 8. 웜홀 순간이동 및 무중력 부스터 구역 특수 연산 (Tick-based)

function handleSpecialPhysics() {
    marbles.forEach(m => {
        // 쿨다운 차감
        if (m.portalCooldown > 0) {
            m.portalCooldown--;
        }
        
        // 궤적(Trail) 데이터 누적 (속도가 빠를수록 촘촘하게 궤적 렌더링하도록 꼬리 수 제한)
        m.trail.push({ x: m.position.x, y: m.position.y });
        if (m.trail.length > 12) {
            m.trail.shift();
        }
        
        // --- A. 테마 5: 포탈 웜홀 체크 ---
        if (selectedTheme === 'portal' && m.portalCooldown === 0) {
            portals.forEach(p => {
                const distToEntry = Vector.magnitude(Vector.sub(m.position, p.entryBody.position));
                if (distToEntry < 20) {
                    // 순간이동 실시!
                    playSynthSound(220, 880, 'warp', 0.22, 0.3);
                    
                    // 입구/출구 포탈 시각 효과 등록
                    createWarpRing(p.entryBody.position.x, p.entryBody.position.y, p.color);
                    createWarpRing(p.exitX, p.exitY, p.color);
                    
                    // 좌표 강제 순간이동 및 가속 방향 재설정
                    Body.setPosition(m, { x: p.exitX, y: p.exitY + 18 });
                    Body.setVelocity(m, { x: m.velocity.x * 0.7, y: Math.abs(m.velocity.y) + 3 }); // 아래 방향 사출 가속
                    m.portalCooldown = 70; // 재워프 방지 70프레임 홀딩
                }
            });
        }
        
        // --- B. 테마 6: 무중력/상승 기류 부스터 체크 ---
        if (selectedTheme === 'booster') {
            boostZones.forEach(zone => {
                if (m.position.x >= zone.x && m.position.x <= zone.x + zone.w &&
                    m.position.y >= zone.y && m.position.y <= zone.y + zone.h) {
                    
                    // 구역 내 구슬 부력 가속
                    Body.applyForce(m, m.position, { x: zone.forceX, y: zone.forceY * gravityVal });
                    
                    // 매 12프레임마다 슈우욱 상승음 방출
                    if (Math.random() < 0.04) {
                        playSynthSound(100, 300, 'boost', 0.08, 0.05);
                    }
                }
            });
        }
    });
}

// 9. 프리미엄 그래픽 렌더러 (Custom Canvas Draw)

function renderLoop() {
    // 1. Matter.js 엔진 프레임 스텝 업데이트
    Engine.update(engine, 1000 / 60);
    
    // 2. 물리 틱에 동기화되는 웜홀, 부스터 특수 연산 실행
    handleSpecialPhysics();
    
    // 3. 로터리 스피너 회전 각도 제어 (테마 4)
    if (selectedTheme === 'pinball') {
        spinners.forEach(spin => {
            Body.setAngle(spin.body, spin.body.angle + spin.speed);
        });
    }
    
    // 4. 화면 지우기 (반투명 블랙으로 자연스러운 Motion Trail 블러 효과 추가)
    ctx.fillStyle = 'rgba(6, 6, 8, 0.28)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 5. 사이버펑크 격자 백그라운드 라인 데코레이션
    drawCyberGrid();
    
    // 6. 특수 구역 데코 (부스터 존 기류 묘사)
    if (selectedTheme === 'booster') {
        drawBoosterZones();
    }
    
    // 7. 정적 물리 구조물 렌더링 (슬라이드, 벽면, 핀)
    drawStaticObstacles();
    
    // 8. 핀볼 범퍼/회전 바 그리기 (스케일 연동)
    drawInteractiveDevices();
    
    // 9. 포탈 웜홀 소용돌이 드로잉
    if (selectedTheme === 'portal') {
        drawWormholes();
    }
    
    // 10. 구슬(Marbles) 및 이름, 네온 꼬리 잔상 그리기
    drawMarbles();
    
    // 11. 화면상 휘발성 이펙트 (워프 플래시, 부딪힘 스파크) 처리
    drawVisualEffects();
    
    // 12. 우승 축하 컨페티(디지털 꽃가루) 렌더
    if (gameStatus === 'FINISHED') {
        drawConfettiShower();
    }
    
    // 13. 리더보드 데이터 정렬 및 DOM 갱신 (성능을 위해 10프레임에 한번만)
    leaderboardTimer++;
    if (leaderboardTimer >= 10) {
        updateLeaderboardDOM(false);
        leaderboardTimer = 0;
    }
    
    requestAnimationFrame(renderLoop);
}

// 백그라운드 격자 그리드 그리기
function drawCyberGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    const size = 40;
    for (let x = 0; x < canvas.width; x += size) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += size) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

// 정적 장애물 (핀, 사선벽) 그리기
function drawStaticObstacles() {
    staticObstacles.forEach(obs => {
        const body = obs.body;
        ctx.save();
        
        // 글로우 효과 장착
        if (obs.glow) {
            ctx.shadowBlur = 8;
            ctx.shadowColor = obs.color;
        }
        
        ctx.fillStyle = obs.color || '#909bb4';
        ctx.strokeStyle = obs.color || '#909bb4';
        
        // 원형 핀
        if (body.circleRadius) {
            ctx.beginPath();
            ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // 프리미엄 핀 마감: 정중앙에 아주 작고 어두운 도트 추가
            ctx.fillStyle = '#060608';
            ctx.beginPath();
            ctx.arc(body.position.x, body.position.y, 2, 0, Math.PI * 2);
            ctx.fill();
        } 
        // 사선 직사각형 벽면
        else {
            ctx.lineWidth = obs.thickness || 2;
            ctx.beginPath();
            const verts = body.vertices;
            ctx.moveTo(verts[0].x, verts[0].y);
            for (let i = 1; i < verts.length; i++) {
                ctx.lineTo(verts[i].x, verts[i].y);
            }
            ctx.closePath();
            
            if (obs.thickness) {
                ctx.stroke();
            } else {
                ctx.fill();
            }
        }
        
        ctx.restore();
    });
}

// 핀볼 범퍼, 스피너 장치들 그리기
function drawInteractiveDevices() {
    // 1. 범퍼 렌더
    bumpers.forEach(bump => {
        const body = bump.body;
        ctx.save();
        
        // hit 게이지에 따라 팽창하는 애니메이션 구현 (hit: 1.0 -> 0.0)
        const scale = 1.0 + (bump.hit * 0.25);
        const radius = bump.radius * scale;
        
        // 점차 쿨다운 복귀
        if (bump.hit > 0) {
            bump.hit -= 0.08;
            if (bump.hit < 0) bump.hit = 0;
        }
        
        // 네온 도넛 원형 렌더
        ctx.shadowBlur = 15 + bump.hit * 15;
        ctx.shadowColor = bump.color;
        ctx.strokeStyle = bump.color;
        ctx.lineWidth = 4;
        ctx.fillStyle = bump.hit > 0 ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.5)';
        
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // 범퍼 중심 코어 디자인
        ctx.fillStyle = bump.hit > 0 ? '#ffffff' : bump.color;
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    });
    
    // 2. 핀볼 회전바(스피너) 렌더
    spinners.forEach(spin => {
        const body = spin.body;
        ctx.save();
        
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        
        // 오렌지 네온 바
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#ff5e00';
        ctx.fillStyle = '#ff5e00';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.roundRect(-spin.width/2, -spin.height/2, spin.width, spin.height, 4);
        ctx.fill();
        ctx.stroke();
        
        // 중앙 회전축 캡
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI*2);
        ctx.fill();
        
        ctx.restore();
    });
}

// 웜홀 포탈 소용돌이 연출
function drawWormholes() {
    portals.forEach(p => {
        // 입구 포탈 그리기 (소용돌이 빨려 들어감)
        p.angle += 0.05; // 회전 속도
        
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = p.color;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        
        // 소용돌이 입구 링
        ctx.beginPath();
        ctx.arc(p.entryBody.position.x, p.entryBody.position.y, 18, 0, Math.PI * 2);
        ctx.stroke();
        
        // 내부 소용돌이 스파이럴 효과 그리기
        ctx.translate(p.entryBody.position.x, p.entryBody.position.y);
        ctx.rotate(p.angle);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(0, 0, 10 + i * 3, i, Math.PI + i, false);
            ctx.stroke();
        }
        
        ctx.restore();
        
        // 출구 포탈 그리기 (방출되는 듯한 역방향 링)
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = p.color;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5;
        
        ctx.beginPath();
        ctx.setLineDash([5, 5]); // 점선 형태
        ctx.arc(p.exitX, p.exitY, 18, -p.angle, Math.PI * 2 - p.angle);
        ctx.stroke();
        
        // 출구 코어
        ctx.restore();
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.exitX, p.exitY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

// 무중력 부스터 존 렌더링
function drawBoosterZones() {
    boostZones.forEach(zone => {
        // 구역 배경 그라데이션 필터
        ctx.save();
        const gradient = ctx.createLinearGradient(zone.x, zone.y + zone.h, zone.x, zone.y);
        gradient.addColorStop(0, 'rgba(57, 255, 20, 0.01)');
        gradient.addColorStop(1, 'rgba(57, 255, 20, 0.09)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
        
        // 부스터 테두리 가이드라인
        ctx.strokeStyle = 'rgba(57, 255, 20, 0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
        
        // 상승하는 먼지/기류 입자 렌더
        ctx.fillStyle = 'rgba(57, 255, 20, 0.4)';
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#39ff14';
        
        zone.particles.forEach(pt => {
            pt.y -= pt.speed;
            // 루프
            if (pt.y < zone.y) {
                pt.y = zone.y + zone.h;
                pt.x = zone.x + Math.random() * zone.w;
            }
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // 스페이스 부스터 엠블럼 간소 드로잉 (상승 쉐브론)
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = 'rgba(57, 255, 20, 0.08)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(zone.x + zone.w/2 - 20, zone.y + zone.h/2 + 10);
        ctx.lineTo(zone.x + zone.w/2, zone.y + zone.h/2 - 10);
        ctx.lineTo(zone.x + zone.w/2 + 20, zone.y + zone.h/2 + 10);
        ctx.stroke();
        ctx.restore();
    });
}

// 구슬(마블) 및 잔상 그리기
function drawMarbles() {
    marbles.forEach(m => {
        // A. 잔상 꼬리 (Neon Trail Line) 그리기
        if (m.trail.length > 1) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(m.trail[0].x, m.trail[0].y);
            for (let i = 1; i < m.trail.length; i++) {
                ctx.lineTo(m.trail[i].x, m.trail[i].y);
            }
            ctx.strokeStyle = m.color;
            ctx.lineWidth = m.originalRadius * 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // 부드러운 페이드아웃 효과 구현
            ctx.globalAlpha = 0.22;
            ctx.shadowBlur = 10;
            ctx.shadowColor = m.color;
            ctx.stroke();
            ctx.restore();
        }
        
        // B. 메인 구슬 원형 본체 그리기
        ctx.save();
        
        // 네온 빛 글로우
        ctx.shadowBlur = 16;
        ctx.shadowColor = m.color;
        
        // 1. 구슬 그라데이션 채우기 (3D 구슬 느낌 가미)
        const radGrad = ctx.createRadialGradient(
            m.position.x - m.originalRadius * 0.3,
            m.position.y - m.originalRadius * 0.3,
            m.originalRadius * 0.1,
            m.position.x,
            m.position.y,
            m.originalRadius
        );
        radGrad.addColorStop(0, '#ffffff'); // 중심 밝은 반사광
        radGrad.addColorStop(0.3, m.color);
        radGrad.addColorStop(1, 'rgba(10, 10, 15, 0.95)');
        
        ctx.fillStyle = radGrad;
        ctx.beginPath();
        ctx.arc(m.position.x, m.position.y, m.originalRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // 2. 구슬 네온 테두리 외선 마감
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // C. 구슬 내부 글자 렌더링 (참가자 이름 가독성 극대화)
        ctx.restore();
        ctx.save();
        
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 이름 길이 조정 (2글자 이하는 그대로, 3글자 이상은 첫글자와 끝글자 혹은 2글자로 축약)
        let displayStr = m.candidateName;
        if (displayStr.length > 2) {
            displayStr = displayStr.substring(0, 2); // 최대 2글자만 마킹
        }
        
        // 구슬 크기에 맞춰 폰트 픽셀 스케일
        ctx.font = `bold 10px ${varGet('font-cyber') || 'Rajdhani'}, sans-serif`;
        ctx.fillText(displayStr, m.position.x, m.position.y + 0.5);
        
        ctx.restore();
    });
}

// 임시 유틸: CSS 변수 값 획득용
function varGet(cssVar) {
    return getComputedStyle(document.documentElement).getPropertyValue('--' + cssVar).trim();
}

// 스파크 파티클 효과용 드로잉
function drawVisualEffects() {
    for (let i = visualEffects.length - 1; i >= 0; i--) {
        const fx = visualEffects[i];
        ctx.save();
        
        if (fx.type === 'spark') {
            fx.x += fx.vx;
            fx.y += fx.vy;
            fx.alpha -= 0.04;
            
            if (fx.alpha <= 0) {
                visualEffects.splice(i, 1);
                ctx.restore();
                continue;
            }
            
            ctx.globalAlpha = fx.alpha;
            ctx.fillStyle = fx.color;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, fx.size, 0, Math.PI * 2);
            ctx.fill();
        } 
        else if (fx.type === 'warp_ring') {
            fx.radius += 1.8;
            fx.alpha -= 0.035;
            
            if (fx.alpha <= 0) {
                visualEffects.splice(i, 1);
                ctx.restore();
                continue;
            }
            
            ctx.globalAlpha = fx.alpha;
            ctx.strokeStyle = fx.color;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, fx.radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        ctx.restore();
    }
}

// 충돌 스파크 파티클 생성
function createSparks(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.0 + Math.random() * 2.8;
        visualEffects.push({
            type: 'spark',
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 1.5 + Math.random() * 2.0,
            color: color,
            alpha: 1.0
        });
    }
}

// 포탈 워프 확장 링 이펙트 생성
function createWarpRing(x, y, color) {
    visualEffects.push({
        type: 'warp_ring',
        x: x,
        y: y,
        radius: 6,
        color: color,
        alpha: 1.0
    });
}

// 10. 우승 축하 컨페티 디지털 꽃가루 파티클 생성 및 드로잉

function spawnConfettiShower() {
    confettiParticles = [];
    const colors = ['#ff007f', '#00f0ff', '#39ff14', '#bd00ff', '#fff000', '#ff5e00'];
    
    // 캔버스 폭발 비산 120개 생성
    for (let i = 0; i < 130; i++) {
        confettiParticles.push({
            x: 300 + (Math.random() - 0.5) * 60,
            y: 1160 + (Math.random() - 0.5) * 30,
            vx: (Math.random() - 0.5) * 10,
            vy: -11 - Math.random() * 9, // 천장 위로 비산
            size: 4 + Math.random() * 6,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * Math.PI * 2,
            rSpeed: (Math.random() - 0.5) * 0.2,
            gravity: 0.28,
            friction: 0.98,
            opacity: 1.0
        });
    }
}

function drawConfettiShower() {
    confettiParticles.forEach((p, idx) => {
        // 물리 모사
        p.vx *= p.friction;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rSpeed;
        
        // 하단 유실 시 페이드아웃
        if (p.y > 1200) {
            p.opacity -= 0.02;
        }
        
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        
        // 사각형 또는 삼각형 꽃가루
        ctx.beginPath();
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        
        ctx.restore();
    });
    
    // 소멸 정리
    confettiParticles = confettiParticles.filter(p => p.opacity > 0);
}

// 11. 실시간 리더보드 데이터 처리 및 DOM 바인딩

function updateLeaderboardDOM(forceReset = false) {
    const listContainer = document.getElementById('leaderboard-list');
    
    if (forceReset || marbles.length === 0) {
        listContainer.innerHTML = `<div class="empty-leaderboard">구슬을 굴려 레이스를 시작하세요!</div>`;
        return;
    }
    
    // Y축이 가장 하단에 도달할수록 선두 (Y값이 클수록 선두)
    // 단, 골인 센서(Winner 변수 선언)가 지정되었다면 해당 구슬을 강제 1위 고정
    const sorted = [...marbles].sort((a, b) => {
        if (winner) {
            if (a === winner) return -1;
            if (b === winner) return 1;
        }
        return b.position.y - a.position.y;
    });
    
    let html = '';
    sorted.forEach((marble, idx) => {
        const rank = idx + 1;
        
        // 게이트 통과 진행률 계산 (출발 40px -> 결승 1130px 부근)
        const progress = Math.min(100, Math.max(0, ((marble.position.y - 40) / 1090) * 100));
        
        let rankClass = '';
        if (rank === 1) rankClass = 'rank-1';
        else if (rank === 2) rankClass = 'rank-2';
        else if (rank === 3) rankClass = 'rank-3';
        
        html += `
            <div class="leader-row ${rankClass}">
                <div class="leader-rank">${rank}</div>
                <div class="leader-color" style="color: ${marble.color}; background-color: ${marble.color}"></div>
                <div class="leader-name">${marble.candidateName}</div>
                <div class="leader-progress">${Math.round(progress)}%</div>
            </div>
        `;
    });
    
    listContainer.innerHTML = html;
}

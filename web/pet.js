// Copri 桌宠的画面与交互逻辑。窗口移动、游荡、菜单由 Swift 外壳负责，
// 两边通过 window.copri（Swift → JS）和 messageHandlers.copri（JS → Swift）通信。
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const root = document.documentElement;
  const svg = document.getElementById('copri');
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const pupils = document.querySelectorAll('.pupil');

  const LINES = {
    click: ['人家叫摩羯！', '你真行啊！', '嗯？', '什么？', '玩得开心点吧', '越来越有意思了', '怎么回事？', '别戳啦！'],
    idle: ['除了你，没人能听到或看到我', '你一直拽着我四处跑……', '今天也要好好干活哦', '好无聊——陪我玩嘛', '我可是数字化的灵魂'],
    drag: ['哇啊！放我下来！', '赶紧放我下来！', '要去哪儿？'],
    drop: ['哼……', '这回不是……'],
    wake: ['嗯？……我没睡！', '什么？'],
    sleep: ['你先睡会吧……不对，是我先睡'],
    sit: ['歇会儿～', '好——无——聊——', '嗯……在想事情', '坐一下下'],
  };

  function post(msg) {
    const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.copri;
    if (h) h.postMessage(msg);
  }

  // ---------- 泼墨闪粉 ----------
  // 不规则的白色墨点：大多很小，少数大块并带飞溅的小点；越靠上越密
  function splat(parent, x, y, r) {
    const n = 5 + Math.floor(Math.random() * 4);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const rr = r * (0.45 + Math.random() * 0.8);
      pts.push((x + Math.cos(a) * rr).toFixed(1) + ',' + (y + Math.sin(a) * rr).toFixed(1));
    }
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('points', pts.join(' '));
    p.setAttribute('fill', '#fff');
    p.setAttribute('opacity', (0.55 + Math.random() * 0.45).toFixed(2));
    parent.appendChild(p);
  }
  function seedSplatter(parent, x0, y0, w, h, count) {
    for (let i = 0; i < count; i++) {
      const x = x0 + Math.random() * w;
      const y = y0 + Math.pow(Math.random(), 2.2) * h; // 原图越往上越密越亮
      const big = Math.random() < 0.035;
      const r = big ? 0.7 + Math.random() * 0.9 : 0.14 + Math.pow(Math.random(), 2.6) * 0.6;
      splat(parent, x, y, r);
      if (big) {
        for (let k = 0; k < 3 + Math.random() * 4; k++) {
          splat(parent, x + (Math.random() - 0.5) * r * 7, y + (Math.random() - 0.5) * r * 7, 0.3 + Math.random() * 0.5);
        }
      }
    }
  }
  seedSplatter(document.getElementById('splatA'), 0, -52, 260, 225, 4800);
  seedSplatter(document.getElementById('splatB'), 0, -52, 260, 225, 2200);
  seedSplatter(document.getElementById('redGlit'), 0, 0, 40, 40, 30);
  seedSplatter(document.getElementById('splatBangs'), 100, 90, 90, 45, 90);
  // 细密闪粉底：均匀的小点铺满一块可平铺的图案
  const fine = document.getElementById('fineGlit');
  for (let i = 0; i < 260; i++) splat(fine, Math.random() * 36, Math.random() * 36, 0.1 + Math.random() * 0.28);

  // ---------- 状态 ----------
  // 持续状态：idle / sleep / drag / move-left / move-right；
  // 瞬时状态（flash）：happy / spin / arrive-* / land / zap-out / zap-in
  const FLASHES = ['happy', 'spin', 'arrive-left', 'arrive-right', 'land', 'zap-out', 'zap-in'];
  let state = 'idle';
  let flashTimer = null;

  function setState(s) {
    const prev = state;
    // 要走、被拎起来：先从坐姿站起来
    if (s === 'drag' || s.startsWith('move-')) root.classList.remove('sit');
    root.classList.remove('idle', 'sleep', 'drag', 'move-left', 'move-right');
    state = s;
    root.classList.add(s);
    // 走着走着停下：惯性往前冲一下再站稳
    if (s === 'idle' && prev.startsWith('move-')) flash(prev.replace('move', 'arrive'), 900);
  }

  function flash(cls, ms) {
    root.classList.remove(...FLASHES);
    void root.offsetWidth; // 重新触发 CSS 动画
    root.classList.add(cls);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => root.classList.remove(cls), ms);
  }

  // ---------- 电流 ----------
  // 身上冒出的小电光：和长距离电流同一个画法——细锯齿折线撑成两头尖的纯粉红多边形。
  // 两组交替闪，每次化成电流都重新生成
  const zapGroups = document.querySelectorAll('#zapsvg g');
  function arcPolygon() {
    let x = 100 + Math.random() * 62, y = 130 + Math.random() * 400;
    const a = (Math.random() - 0.5) * 1.4 + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const n = 3 + Math.floor(Math.random() * 2), seg = 11 + Math.random() * 7;
    const left = [], right = [];
    for (let k = 0; k <= n; k++) {
      const off = (k % 2 ? 1 : -1) * (4 + Math.random() * 5);
      const px = x + dx * seg * k + nx * off, py = y + dy * seg * k + ny * off;
      const w = k === 0 || k === n ? 0 : 0.9 + Math.random() * 1.1;
      left.push([px + nx * w, py + ny * w]);
      right.unshift([px - nx * w, py - ny * w]);
    }
    return left.concat(right).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  }
  function seedArcs() {
    zapGroups.forEach(g => {
      g.replaceChildren();
      for (let i = 0; i < 4; i++) {
        const p = document.createElementNS(SVG_NS, 'polygon');
        p.setAttribute('points', arcPolygon());
        p.setAttribute('class', i === 3 ? 'green' : 'zap-fill'); // 四道里一道绿
        g.appendChild(p);
      }
    });
  }

  // ---------- 凝缩 ----------
  // 时间轴 u：0～.3 身体蹲下再弹回（CSS）；.3 起画出来的脸正好盖在真脸上；.3～.45 张嘴（额头连面罩往上撑大、下巴掉到脚下）；
  // .5～.65 下巴合上来把身体扫进脸里；.65～1 合上的脸往一个方向扭着缩成一个点。到达时 u 从 1 倒放回 .3。
  // 每 50ms 换一帧（动画那种一拍几的顿感），所有形状每帧随机抖一下，绿面罩和眼睛越到后面变形越厉害
  const FACE = [[107, 104], [155, 104], [152.9, 115.5], [147.5, 133], [146, 138.6], [128, 146.8], [115, 139.6], [114.5, 133], [109.1, 115.5]];
  const UPPER = [0, 1, 2, 3, 7, 8], JAW = [3, 4, 5, 6, 7], MASK = [8, 2, 3, 7];
  const EYES = [[121.1, 126.4], [140.9, 126.4]];
  const svgCrumple = document.getElementById('crumplesvg');
  const cEl = id => document.getElementById(id);
  const cUpper = cEl('cUpper'), cJaw = cEl('cJaw'), cUpperOl = cEl('cUpperOl'), cJawOl = cEl('cJawOl'), cMask = cEl('cMask');
  const cEyes = svgCrumple.querySelectorAll('.c-eye');
  const cShards = cEl('cShards'), cArcs = cEl('cArcs'), cFace = cEl('cFace'), cMouth = cEl('cMouth'), cMouthOl = cEl('cMouthOl');
  const SHARDS = 7, ARCS = 3;
  // 粉多绿少，和她身上的配色比例差不多：发片 7 片里 2 片绿，冒的电 3 道里 1 道绿
  for (let i = 0; i < SHARDS; i++) {
    for (const cls of ['ol', i % 3 === 2 ? 'green' : 'zap-fill']) {
      const p = document.createElementNS(SVG_NS, 'polygon');
      p.setAttribute('class', cls);
      cShards.appendChild(p);
    }
  }
  for (let i = 0; i < ARCS; i++) {
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('class', i === ARCS - 1 ? 'green' : 'zap-fill');
    cArcs.appendChild(p);
  }
  const ss = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fmt = pts => pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  let crumpleTimer = null, cState = null;

  // 额头 / 下巴各是一条开口的轮廓线（两头是嘴角 V7、V3，固定不动），再用直线连回去。
  // 要更多顶点：反复把最长的一段从中间偏一点切开（新点记作 s0、s1……）；要更少：反复删掉删了以后形状变化最小的点。
  // 都在原始脸的坐标里算，同一个顶点数每帧得到同一组点，形状才是连续变形而不是乱跳
  const mkPath = (idx) => {
    const pts = idx.map(i => ({ x: FACE[i][0], y: FACE[i][1], key: 'v' + i, orig: true }));
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const size = Math.max(...pts.map(p => Math.hypot(p.x - mx, p.y - my)));
    return { pts, mx, my, size, cache: {} };
  };
  const UPPER_PATH = mkPath([7, 8, 0, 1, 2, 3]), JAW_PATH = mkPath([3, 4, 5, 6, 7]);
  const SPLIT = [.42, .6, .36, .55, .47, .64, .4, .52, .58, .45, .38, .62];
  function piecePoints(piece, n) {
    if (piece.cache[n]) return piece.cache[n];
    let pts = piece.pts.slice();
    let sid = 0;
    while (pts.length < n) {
      let best = 0, bl = -1;
      for (let i = 0; i < pts.length - 1; i++) {
        const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        if (l > bl) { bl = l; best = i; }
      }
      const f = SPLIT[sid % SPLIT.length], A = pts[best], B = pts[best + 1];
      pts.splice(best + 1, 0, { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, key: 's' + sid++, orig: false });
    }
    while (pts.length > n) {
      let best = 1, ba = Infinity;
      for (let i = 1; i < pts.length - 1; i++) {
        const A = pts[i - 1], P = pts[i], B = pts[i + 1];
        const area = Math.abs((P.x - A.x) * (B.y - A.y) - (B.x - A.x) * (P.y - A.y));
        if (area < ba) { ba = area; best = i; }
      }
      pts.splice(best, 1);
    }
    // 每个点往外的方向（从这块脸的中心指出去）
    pts = pts.map(p => { const l = Math.hypot(p.x - piece.mx, p.y - piece.my) || 1; return { ...p, ox: (p.x - piece.mx) / l, oy: (p.y - piece.my) / l }; });
    return (piece.cache[n] = pts);
  }
  // 每个顶点一个「往外戳多少」的随机量，每帧只漂一点：形状是慢慢扭动着变，不是原地抖
  function drift() {
    const nz = cState.noise;
    for (const key in nz) nz[key] = Math.max(-.6, Math.min(1.3, nz[key] + rnd(-.14, .14)));
    for (const r of cState.ringNoise) for (let q = 0; q < r.length; q++) r[q] = Math.max(-1, Math.min(1, r[q] + rnd(-.25, .25)));
  }

  function drawCrumple(u) {
    if (u < 0.3) {
      cFace.style.display = cShards.style.display = cArcs.style.display = cMouth.parentNode.style.display = 'none';
      root.classList.remove('c-face');
      return;
    }
    cFace.style.display = cMouth.parentNode.style.display = '';
    root.classList.add('c-face');
    const open = ss(.3, .45, u), close = ss(.5, .65, u), shrink = ss(.65, 1, u);
    const k = Math.pow(1 - shrink, 1.4);
    const sx = (1 + 1 * open) * k, sy = (1 + .7 * open) * k;
    const cx = 131, cy = 128 - 12 * open * (1 - shrink);
    const drop = 330 * open * (1 - close) * k;
    const rot = cState.dir * shrink * 2.2; // 只往一个方向扭，不左右抖
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const place = (lx, ly) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
    drift();
    // 脸的轮廓：张嘴时一边变大一边长出越来越多的顶点、往外戳成不规整的多边形；缩小时顶点一个个并掉，最后剩个三角
    const amp = .5 * open;
    const nUp = Math.max(3, 6 + Math.round(10 * open) - Math.round(13 * shrink));
    const nJaw = Math.max(3, 5 + Math.round(5 * open) - Math.round(7 * shrink));
    const morph = (piece, n, dy) => piecePoints(piece, n).map(q => {
      const m = q.orig ? .35 : 1; // 原来的角只微微动，新长出来的顶点才大幅往外戳 / 往里凹
      const d = amp * m * cState.noise[q.key] * piece.size;
      return place((q.x - 131 + q.ox * d) * sx, (q.y - 128 + q.oy * d) * sy + dy);
    });
    const upper = morph(UPPER_PATH, nUp, 0), jaw = morph(JAW_PATH, nJaw, drop);
    cUpper.setAttribute('points', fmt(upper));
    cJaw.setAttribute('points', fmt(jaw));
    const ol = 'translate(-1.5,1.5)';
    cUpperOl.setAttribute('points', fmt(upper)); cUpperOl.setAttribute('transform', ol);
    cJawOl.setAttribute('points', fmt(jaw)); cJawOl.setAttribute('transform', ol);
    // 嘴里面：额头下沿到下巴上沿之间，两边腮帮往外鼓成不规整的折线（每帧乱跳一点）
    // 额头的路径从 V7 走到 V3，下巴从 V3 走到 V7：两头就是嘴角
    const bulge = 34 * open * (1 - close) * k;
    const corner = (v, sgn, f) => place((FACE[v][0] - 131) * sx + sgn * bulge * rnd(.35, 1.1) * (f === .5 ? 1.2 : .7), (FACE[v][1] - 128) * sy + drop * (f + rnd(-.06, .06)));
    const mouth = [upper[upper.length - 1], ...[.22, .5, .78].map(f => corner(3, 1, f)), jaw[0], jaw[jaw.length - 1], ...[.78, .5, .22].map(f => corner(7, -1, f)), upper[0]];
    cMouth.setAttribute('points', fmt(mouth));
    cMouthOl.setAttribute('points', fmt(mouth)); cMouthOl.setAttribute('transform', ol);
    // 绿面罩：额头那段脸的一条横带，上下沿各多一个随机折点，越缩越歪
    const mw = 0.08 + 0.35 * shrink;
    const mpt = (x, y) => place((x - 131 + rnd(-1, 1) * mw * 22) * sx, (y - 128 + rnd(-1, 1) * mw * 14) * sy);
    const [a, b, c, d] = MASK.map(i => FACE[i]);
    cMask.setAttribute('points', fmt([mpt(...a), mpt((a[0] + b[0]) / 2 + rnd(-6, 6), a[1]), mpt(...b), mpt(...c), mpt((c[0] + d[0]) / 2 + rnd(-5, 5), c[1]), mpt(...d)]));
    // 眼睛：跟着脸走，后半段每帧随机压扁、拉长、歪一下（像在挤眉弄眼）；外圈的绿环也变成一圈会变形的多边形
    const ringAmp = .18 * open + .55 * shrink;
    cEyes.forEach((g, i) => {
      const [ex, ey] = place((EYES[i][0] - 131) * sx, (EYES[i][1] - 128) * sy);
      const base = 4.8 * Math.sqrt(sx * sy);
      const ex2 = base * (1 + rnd(-0.4, 0.3) * shrink * 1.6), ey2 = base * (1 + rnd(-0.7, 0.4) * shrink * 1.6);
      g.setAttribute('transform', `translate(${ex.toFixed(1)},${ey.toFixed(1)}) rotate(${(rot * 57.3 + rnd(-25, 25) * shrink).toFixed(0)}) scale(${Math.max(.05, ex2).toFixed(2)},${Math.max(.05, ey2).toFixed(2)})`);
      const n = 10, ring = [];
      for (let q = 0; q < n; q++) {
        const ang = (q + cState.ringNoise[i][q] * .35) / n * Math.PI * 2;
        const r = 1 + ringAmp * cState.ringNoise[i][(q + 3) % n] * (q % 2 ? 1 : .6);
        ring.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }
      g.querySelector('.c-ring').setAttribute('points', ring.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '));
    });
    // 粉色发片：不规整的细长多边形，绕着脸转、一圈圈被吸进去
    const shardOn = u > .33 && u < .97;
    cShards.style.display = shardOn ? '' : 'none';
    if (shardOn) {
      const pull = ss(.33, .95, u);
      const ps = cShards.children;
      cState.shards.forEach((s, i) => {
        const ang = s.a + cState.dir * pull * 3.2;
        const r = s.r * (1 - 0.88 * pull);
        const px = cx + Math.cos(ang) * r, py = cy + 40 * (1 - pull) + Math.sin(ang) * r * 1.6;
        const len = s.len * (1 - 0.7 * pull), wid = s.wid * (1 - 0.6 * pull);
        const ta = ang + Math.PI / 2 + rnd(-.5, .5), tx = Math.cos(ta), ty = Math.sin(ta);
        // 沿一条线来回折的不规整多边形：一边走一边左右乱跳，有的顶点缩进去成缺口
        const n = 6 + (i % 3), pts = [];
        for (let q = 0; q < n; q++) {
          const along = (q < n / 2 ? q / (n / 2 - 1) : (n - 1 - q) / (n / 2 - 1)) - .5;
          const side = (q < n / 2 ? 1 : -1) * wid * rnd(.15, 1.1);
          pts.push([px + tx * along * len * rnd(.8, 1.15) - ty * side, py + ty * along * len * rnd(.8, 1.15) + tx * side]);
        }
        const str = fmt(pts);
        ps[i * 2].setAttribute('points', str); ps[i * 2].setAttribute('transform', 'translate(-1.5,1.5)');
        ps[i * 2 + 1].setAttribute('points', str);
      });
    }
    // 往外噼啪冒的电：从脸边上随机甩出去的细锯齿
    const arcOn = u > .42;
    cArcs.style.display = arcOn ? '' : 'none';
    if (arcOn) {
      const size = 30 * Math.max(sx, sy) + 6;
      [...cArcs.children].forEach(p => {
        const a = rnd(0, Math.PI * 2), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
        let x = cx + dx * size * .5, y = cy + dy * size * .6;
        const seg = rnd(5, 9) * (0.5 + k), left = [], right = [];
        for (let q = 0; q <= 3; q++) {
          const off = (q % 2 ? 1 : -1) * rnd(2, 5);
          const qx = x + dx * seg * q + nx * off, qy = y + dy * seg * q + ny * off;
          const w = q === 0 || q === 3 ? 0 : rnd(.6, 1.2);
          left.push([qx + nx * w, qy + ny * w]); right.unshift([qx - nx * w, qy - ny * w]);
        }
        p.setAttribute('points', fmt(left.concat(right)));
      });
    }
  }
  function stopCrumple() {
    clearInterval(crumpleTimer);
    cState = null;
    drawCrumple(0);
  }
  // out：0.8 秒从完整的人凝缩成一个点；in：0.52 秒从点里倒放回来
  function runCrumple(dir) {
    clearInterval(crumpleTimer);
    cState = {
      dir: Math.random() < .5 ? 1 : -1,
      shards: Array.from({ length: SHARDS }, (_, i) => ({ a: i / SHARDS * Math.PI * 2 + rnd(-.4, .4), r: rnd(60, 105), len: rnd(28, 50), wid: rnd(5, 11) })),
      noise: {},
      ringNoise: [0, 1].map(() => Array.from({ length: 10 }, () => rnd(-1, 1))),
    };
    for (let i = 0; i < 9; i++) cState.noise['v' + i] = rnd(-.2, .5);
    for (let i = 0; i < 24; i++) cState.noise['s' + i] = i % 3 === 2 ? rnd(-.6, -.1) : rnd(.3, 1.2); // 大多往外戳，隔几个往里凹
    const t0 = performance.now();
    const ms = dir === 'out' ? 800 : 520;
    const frame = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      if (cState) drawCrumple(dir === 'out' ? t : 1 - 0.7 * t);
      if (t >= 1) { clearInterval(crumpleTimer); if (dir === 'in') drawCrumple(0); }
    };
    frame();
    crumpleTimer = setInterval(frame, 50);
  }

  // ---------- 说话 ----------
  let bubbleTimer = null;
  function say(text, ms) {
    bubbleText.textContent = text;
    bubble.classList.remove('hidden');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms || 2600);
  }
  function sayRandom(kind) {
    const list = LINES[kind] || LINES.click;
    say(list[Math.floor(Math.random() * list.length)]);
  }

  // ---------- 眨眼 ----------
  function blinkLoop() {
    setTimeout(() => {
      if (state !== 'sleep') {
        root.classList.add('blink');
        setTimeout(() => root.classList.remove('blink'), 120);
      }
      blinkLoop();
    }, 2200 + Math.random() * 3500);
  }
  blinkLoop();

  // ---------- 视线跟随 ----------
  // mx, my：鼠标在页面坐标系中的位置（可以在窗口外）
  function gaze(mx, my) {
    const r = svg.getBoundingClientRect();
    const k = r.width / 260;
    const ex = r.left + 131 * k, ey = r.top + 142.4 * k;
    const dx = mx - ex, dy = my - ey;
    const d = Math.hypot(dx, dy) || 1;
    const m = Math.min(1, d / 160) * 0.22; // 眼睛组的单位是绿环半径
    const t = `translate(${(dx / d * m).toFixed(2)}px, ${(dy / d * m).toFixed(2)}px)`;
    pupils.forEach(p => { p.style.transform = t; });
  }

  // ---------- 命中测试：只有画到的像素才接收鼠标，其余点击穿透 ----------
  function hit(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    if (el.closest('#bubble')) return !bubble.classList.contains('hidden');
    return !!el.closest('#pet');
  }

  // ---------- 鼠标交互 ----------
  let down = null;
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !hit(e.clientX, e.clientY)) return;
    down = { x: e.screenX, y: e.screenY, dragging: false };
    post({ type: 'press' });
  });
  document.addEventListener('mousemove', e => {
    if (!down || down.dragging) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down.dragging = true;
      root.classList.remove(...FLASHES); // 化成电流途中被抓住也要立刻现形
      stopCrumple();
      setState('drag');
      sayRandom('drag');
      post({ type: 'dragStart' });
    }
  });
  document.addEventListener('mouseup', () => {
    if (!down) return;
    if (!down.dragging) onClick();
    down = null;
  });
  document.addEventListener('dblclick', e => {
    if (!hit(e.clientX, e.clientY)) return;
    flash('spin', 800);
    post({ type: 'interact' });
  });
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    post({ type: 'menu' });
  });

  function onClick() {
    if (root.classList.contains('sit') && state !== 'sleep') {
      // 坐着被点：先站起来再蹦一下
      root.classList.remove('sit');
      setTimeout(() => { flash('happy', 900); sayRandom('click'); }, 450);
      post({ type: 'interact' });
      return;
    }
    if (state === 'sleep') {
      setState('idle');
      sayRandom('wake');
    } else {
      flash('happy', 900);
      sayRandom('click');
    }
    post({ type: 'interact' });
  }

  // ---------- 暴露给 Swift ----------
  window.copri = {
    tick(mx, my) { gaze(mx, my); return hit(mx, my); },
    setState(s) { if (s !== state) setState(s); },
    getState() { return state; },
    dropped() { if (state === 'drag') { setState('idle'); flash('land', 700); sayRandom('drop'); } },
    // 化成电流：脸张开把身体吞进去、扭着缩成一个点（0.8 秒，Swift 等这么久再从脸的位置放电流）；到了以后倒放
    zapOut() { setState('idle'); seedArcs(); flash('zap-out', 5000); runCrumple('out'); },
    zapIn() { root.classList.remove('sit'); seedArcs(); flash('zap-in', 700); runCrumple('in'); },
    // 坐下 / 站起来（Swift 决定时机：游荡途中偶尔歇一会儿，或者待机久了）
    sit() { if (state === 'idle' || state === 'sleep') { root.classList.add('sit'); if (Math.random() < 0.4) sayRandom('sit'); } },
    stand() { root.classList.remove('sit'); },
    sleep() { setState('sleep'); sayRandom('sleep'); },
    wake() { if (state === 'sleep') { setState('idle'); sayRandom('wake'); } },
    talk() { flash('happy', 900); sayRandom('idle'); },
    sayRandom,
    say,
    flash,
  };

  setState('idle');
  post({ type: 'ready' });
})();

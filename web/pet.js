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
        p.setAttribute('class', 'zap-fill');
        g.appendChild(p);
      }
    });
  }

  // 凝缩多边形：一圈长短交替的尖角（像被揉皱的纸团），每帧角度、长短都随机抖一下再整体转一点，
  // 逐帧（20 帧/秒，动画那种一拍几的顿感）由大缩到一个点；反过来就是从点里长出来。
  // 粉色外层 + 紫色错位描边 + 里面一块黑，和她身上同一套配色
  const svgCrumple = document.getElementById('crumplesvg');
  const crumple = svgCrumple.querySelectorAll('polygon');
  let crumpleTimer = null;
  function jagged(cx, cy, rx, ry, rot, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i + (Math.random() - 0.5) * 0.5) / n * Math.PI * 2;
      const r = i % 2 ? 0.45 + Math.random() * 0.3 : 0.85 + Math.random() * 0.25;
      pts.push((cx + Math.cos(a) * rx * r).toFixed(1) + ',' + (cy + Math.sin(a) * ry * r).toFixed(1));
    }
    return pts.join(' ');
  }
  function stopCrumple() {
    clearInterval(crumpleTimer);
    crumple.forEach(p => p.removeAttribute('points'));
  }
  // from / to：0 = 一个点，1 = 罩住整个人；ms 内从 from 变到 to，delay 后才出现
  function runCrumple(from, to, ms, delay) {
    clearInterval(crumpleTimer);
    const t0 = performance.now() + delay;
    let rot = Math.random() * 6;
    const frame = () => {
      const t = (performance.now() - t0) / ms;
      if (t < 0) return;
      if (t >= 1) { stopCrumple(); return; }
      const k = from + (to - from) * (t * t * (3 - 2 * t)); // 两头慢中间快
      const cx = 131, cy = 360 - 75 * k, rx = 3 + 100 * k, ry = 3 + 205 * k;
      rot += 0.5 + Math.random() * 0.4;
      const outer = jagged(cx, cy, rx, ry, rot, 11);
      crumple[0].setAttribute('points', outer);
      crumple[0].setAttribute('transform', 'translate(-2.5,2.5)');
      crumple[1].setAttribute('points', outer);
      crumple[2].setAttribute('points', jagged(cx + 3, cy - 4, rx * 0.38, ry * 0.34, -rot * 1.3, 7));
      svgCrumple.style.opacity = Math.min(1, t * 5, (1 - t) * 8).toFixed(2); // 刚出现和收尾时淡一下
    };
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
    // 化成电流：先凝缩成一个点（0.7 秒，Swift 等这么久再放电流）；到了以后从点里长出来
    zapOut() { setState('idle'); seedArcs(); flash('zap-out', 5000); runCrumple(0.9, 0, 520, 180); },
    zapIn() { root.classList.remove('sit'); seedArcs(); flash('zap-in', 650); runCrumple(0, 0.9, 260, 0); },
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

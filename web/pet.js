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
  // 身上随机的锯齿电弧：两组交替闪，每次化成电流都重新生成
  const zapGroups = document.querySelectorAll('#zapsvg g');
  function seedArcs() {
    zapGroups.forEach(g => {
      g.replaceChildren();
      for (let i = 0; i < 4; i++) {
        let x = 100 + Math.random() * 62, y = 130 + Math.random() * 400;
        const pts = [[x, y]];
        for (let k = 0; k < 5 + Math.random() * 4; k++) {
          const a = Math.PI / 2 + (Math.random() - 0.5) * 2.2;
          const len = 8 + Math.random() * 12;
          x += Math.cos(a) * len * (Math.random() < 0.5 ? -1 : 1);
          y += Math.sin(a) * len * (Math.random() < 0.5 ? -1 : 1);
          pts.push([x, y]);
        }
        const str = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        for (const cls of ['zap-glow', 'zap-core']) {
          const l = document.createElementNS(SVG_NS, 'polyline');
          l.setAttribute('points', str);
          l.setAttribute('class', cls);
          g.appendChild(l);
        }
      }
    });
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
    zapOut() { setState('idle'); seedArcs(); flash('zap-out', 5000); },
    zapIn() { seedArcs(); flash('zap-in', 480); },
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

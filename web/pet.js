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

  // ---------- 闪粉 ----------
  function seedGlitter(id, size, count) {
    const p = document.getElementById(id);
    for (let i = 0; i < count; i++) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', (Math.random() * size).toFixed(1));
      c.setAttribute('cy', (Math.random() * size).toFixed(1));
      c.setAttribute('r', (Math.random() < 0.12 ? 1.1 : 0.35 + Math.random() * 0.45).toFixed(2));
      c.setAttribute('fill', '#fff');
      c.setAttribute('opacity', (0.45 + Math.random() * 0.55).toFixed(2));
      p.appendChild(c);
    }
  }
  seedGlitter('glitterA', 60, 90);
  seedGlitter('glitterB', 47, 45);
  seedGlitter('redGlit', 40, 40);

  // ---------- 状态 ----------
  // 持续状态：idle / sleep / drag / move-left / move-right；瞬时状态：happy / spin
  let state = 'idle';
  let flashTimer = null;

  function setState(s) {
    root.classList.remove('idle', 'sleep', 'drag', 'move-left', 'move-right');
    state = s;
    root.classList.add(s);
  }

  function flash(cls, ms) {
    root.classList.remove('happy', 'spin');
    void root.offsetWidth; // 重新触发 CSS 动画
    root.classList.add(cls);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => root.classList.remove(cls), ms);
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
    const ex = r.left + 131 * k, ey = r.top + 125 * k;
    const dx = mx - ex, dy = my - ey;
    const d = Math.hypot(dx, dy) || 1;
    const m = Math.min(1, d / 160) * 2.4;
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
    dropped() { if (state === 'drag') { setState('idle'); sayRandom('drop'); } },
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

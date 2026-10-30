window.TR21_BASE = "/w/5b1c4a39";
window.TR21_VERSION = "20261030-004";

/* ── карта теории: граф страниц по перекрёстным ссылкам ────────────────────
   Данные лежат в самой странице (#tg-data, то есть внутри шифра), код — здесь.
   Зависимостей нет: узлов семь десятков, своя пружинная раскладка на canvas
   справляется, а тянуть d3 ради одной страницы незачем. Чистые функции
   вынесены наверх — их гоняет tests/js/graph.test.mjs. */
(() => {
  const BASE = window.TR21_BASE || '';
  const PALETTE = ['#d9534f', '#3b82c4', '#3aa655', '#9b59b6', '#e67e22', '#17a398',
                   '#c9a227', '#e84393', '#8d6e63', '#6c5ce7', '#00897b', '#c2185b', '#607d8b'];

  /* ── чистые функции карты ── */
  /* подпись узла: у «Первая шкала — ипохондрический характер» на карте
     помещается только первая половина; полное имя — в панели и в поиске */
  function shortName(t) { const i = t.indexOf(' — '); return i > 0 ? t.slice(0, i) : t; }
  function plural(n, one, few, many) {
    const m = n % 100, k = n % 10;
    return n + ' ' + (m > 10 && m < 20 ? many : k === 1 ? one : k > 1 && k < 5 ? few : many);
  }
  /* рёбра текущего режима не слабее порога */
  function graphFilter(data, mode, min) {
    return (mode === 'co' ? data.co : data.links).filter(e => e[2] >= min);
  }
  /* порог по умолчанию: самый мягкий, при котором рёбер не больше трёх на
     узел — иначе семь десятков страниц с девятью сотнями связей сливаются
     в клубок, где не видно ни одной */
  function defaultMin(data, mode) {
    const n = data.nodes.length;
    for (let m = 1; m < 1000; m++) if (graphFilter(data, mode, m).length <= 3 * n) return m;
    return 1;
  }
  function maxWeight(data, mode) {
    return (mode === 'co' ? data.co : data.links).reduce((a, e) => Math.max(a, e[2]), 1);
  }
  /* списки соседей на каждый режим: у ссылки две подписи — что страница A
     говорит о B в своих «Связях» (e[3]) и что B говорит об A (e[4]) */
  function adjacency(data) {
    const adj = {links: data.nodes.map(() => []), co: data.nodes.map(() => [])};
    data.links.forEach(e => {
      adj.links[e[0]].push({j: e[1], w: e[2], l: e[3]});
      adj.links[e[1]].push({j: e[0], w: e[2], l: e[4]});
    });
    data.co.forEach(e => {
      adj.co[e[0]].push({j: e[1], w: e[2]});
      adj.co[e[1]].push({j: e[0], w: e[2]});
    });
    const byW = (a, b) => b.w - a.w || a.j - b.j;
    adj.links.forEach(l => l.sort(byW));
    adj.co.forEach(l => l.sort(byW));
    return adj;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function pageUrl(t) { return BASE + '/теория/' + encodeURIComponent(t) + '/'; }

  function init() {
    const root = document.getElementById('tg-root');
    const dataEl = document.getElementById('tg-data');
    if (!root || !dataEl || root.dataset.ready) return;
    root.dataset.ready = '1';
    const data = JSON.parse(dataEl.textContent);
    const N = data.nodes.length;
    const adj = adjacency(data);
    let mode = 'links', min = 1, wmax = 1, secFilter = -1, selected = -1, hover = -1;
    let showAll = false, dirty = true;

    /* на широком экране граф слева, панель справа (класс на body снимает
       ограничение ширины контента); на узком — одно под другим */
    document.body.classList.add('tr21-map');
    root.innerHTML = '<div class="tg-left"><div id="tg-bar">'
      + '<span class="tg-modes"><label><input type="radio" name="tg-mode" value="links" checked> по ссылкам</label>'
      + '<label><input type="radio" name="tg-mode" value="co"> по общим занятиям</label></span>'
      + '<label class="tg-min">связи от <input type="range" id="tg-min" min="1"> <b id="tg-min-v"></b></label>'
      + '<button id="tg-reset" type="button">Разложить заново</button>'
      + '</div><div id="tg-legend"></div>'
      + '<div class="tg-stage"><canvas id="tg-canvas"></canvas>'
      + '<button id="tg-zoom0" type="button" hidden>весь граф</button></div></div>'
      + '<div id="tg-panel"></div>';
    const $ = sel => root.querySelector(sel);
    const color = p => PALETTE[p.s % PALETTE.length];

    /* легенда разделов — чипы, клик подсвечивает раздел */
    const legend = $('#tg-legend');
    data.sections.forEach((s, i) => {
      const chip = document.createElement('span');
      chip.className = 'tg-chip'; chip.dataset.i = i;
      chip.innerHTML = '<i class="tg-dot" style="background:' + PALETTE[i % PALETTE.length] + '"></i>' + esc(s);
      chip.onclick = () => { secFilter = secFilter === i ? -1 : i; paintLegend(); dirty = true; };
      legend.appendChild(chip);
    });
    function paintLegend() {
      legend.querySelectorAll('.tg-chip').forEach(c => {
        const i = +c.dataset.i;
        c.classList.toggle('on', secFilter === i);
        c.classList.toggle('off', secFilter >= 0 && secFilter !== i);
      });
    }

    /* ── узлы и пружины ── */
    const nodes = data.nodes.map((d, i) => ({
      i, t: d.t, s: d.s, n: d.n, h: d.h, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null,
      r: 4 + Math.sqrt(d.n) * 1.6,
    }));
    function scatter() {
      const R = 60 + Math.sqrt(N) * 30;
      nodes.forEach((p, i) => {
        /* страницы одного раздела стартуют рядом: раскладка тогда сходится
           к картине «кластеры разделов», а не к случайному клубку */
        const a = (p.s + 0.5) / data.sections.length * Math.PI * 2 + (i % 7) * 0.08;
        const rr = R * (0.6 + 0.4 * ((i * 7919) % 100) / 100);
        p.x = Math.cos(a) * rr; p.y = Math.sin(a) * rr; p.vx = p.vy = 0;
      });
    }
    let edges = [], alpha = 0;
    function rebuild() {
      wmax = maxWeight(data, mode);
      edges = graphFilter(data, mode, min).map(e => ({a: nodes[e[0]], b: nodes[e[1]], w: e[2]}));
      dirty = true;
    }
    function heat(a) { alpha = Math.max(alpha, a); }
    function tick() {
      if (alpha < 0.003) { alpha = 0; return; }
      alpha *= 0.99;
      for (let i = 0; i < N; i++) {
        const p = nodes[i];
        for (let j = i + 1; j < N; j++) {
          const q = nodes[j];
          let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = 0.5 - ((i * 31 + j) % 10) / 10; dy = 0.5 - ((i + j * 17) % 10) / 10; d2 = 1; }
          const d = Math.sqrt(d2);
          let f = 6000 * alpha / d2;
          const minD = p.r + q.r + 22;
          if (d < minD) f += (minD - d) * 0.25;   /* наложившиеся раздвигаем жёстче */
          const fx = dx / d * f, fy = dy / d * f;
          p.vx -= fx; p.vy -= fy; q.vx += fx; q.vy += fy;
        }
      }
      edges.forEach(e => {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const L = 100 + e.a.r + e.b.r;
        const k = 0.01 + 0.05 * Math.min(1, e.w / wmax);
        const f = (d - L) * k * alpha;
        const fx = dx / d * f, fy = dy / d * f;
        e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
      });
      nodes.forEach(p => {
        if (p.fx != null) { p.x = p.fx; p.y = p.fy; p.vx = p.vy = 0; return; }
        p.vx -= p.x * 0.03 * alpha; p.vy -= p.y * 0.03 * alpha;
        p.vx *= 0.6; p.vy *= 0.6; p.x += p.vx; p.y += p.vy;
      });
    }

    /* ── холст: вписываем всю картину, подписи учтены полями ── */
    const canvas = $('#tg-canvas'), ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, dragging = null;
    /* base — автоматическое вписывание всей картины, user — то, что человек
       накрутил щипком или колесом поверх него; view — их произведение */
    const base = {k: 1, tx: 0, ty: 0}, user = {z: 1, x: 0, y: 0};
    const view = {k: 1, tx: 0, ty: 0};
    const zoom0 = root.querySelector('#tg-zoom0');
    function applyView() {
      view.k = base.k * user.z; view.tx = base.tx * user.z + user.x; view.ty = base.ty * user.z + user.y;
      zoom0.hidden = user.z === 1 && !user.x && !user.y;
      dirty = true;
    }
    /* масштаб вокруг точки экрана: то, что под пальцами, остаётся на месте */
    function zoomAt(m, s) {
      const z = Math.min(8, Math.max(0.4, user.z * s)); s = z / user.z;
      user.z = z; user.x = m.x - (m.x - user.x) * s; user.y = m.y - (m.y - user.y) * s;
    }
    function zoomReset() { user.z = 1; user.x = user.y = 0; applyView(); }
    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      dirty = true;
    }
    function fit() {
      if (dragging || pinch || !W) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      nodes.forEach(p => {
        x0 = Math.min(x0, p.x - p.r); x1 = Math.max(x1, p.x + p.r);
        y0 = Math.min(y0, p.y - p.r); y1 = Math.max(y1, p.y + p.r);
      });
      const k = Math.min(W / (x1 - x0 + 170), H / (y1 - y0 + 80), 1.5);
      const tx = W / 2 - (x0 + x1) / 2 * k, ty = H / 2 - (y0 + y1) / 2 * k - 6;
      if (Math.abs(k - base.k) + Math.abs(tx - base.tx) + Math.abs(ty - base.ty) > 0.05) dirty = true;
      base.k += (k - base.k) * 0.15; base.tx += (tx - base.tx) * 0.15; base.ty += (ty - base.ty) * 0.15;
      applyView();
    }
    const sx = p => p.x * view.k + view.tx, sy = p => p.y * view.k + view.ty;
    function css(v) { return getComputedStyle(document.body).getPropertyValue(v).trim(); }
    function line(a, b) { ctx.beginPath(); ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b), sy(b)); ctx.stroke(); }
    function draw() {
      const fg = css('--md-default-fg-color') || '#333';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';
      const active = hover >= 0 ? hover : selected;
      const dimSec = p => secFilter >= 0 && p.s !== secFilter;
      if (active < 0) {
        edges.forEach(e => {
          const t = Math.min(1, e.w / wmax);
          ctx.globalAlpha = dimSec(e.a) && dimSec(e.b) ? 0.04 : 0.16 + 0.4 * t;
          ctx.lineWidth = 0.6 + 2.6 * t; ctx.strokeStyle = fg; line(e.a, e.b);
        });
      } else {
        ctx.globalAlpha = 0.04; ctx.lineWidth = 0.8; ctx.strokeStyle = fg;
        edges.forEach(e => { if (e.a.i !== active && e.b.i !== active) line(e.a, e.b); });
        const p = nodes[active];
        adj[mode][active].forEach(n => {
          const t = Math.min(1, n.w / wmax);
          ctx.globalAlpha = 0.35 + 0.6 * t; ctx.lineWidth = 0.8 + 3.2 * t;
          ctx.strokeStyle = color(p); line(p, nodes[n.j]);
        });
      }
      const neigh = active >= 0 ? new Set(adj[mode][active].map(n => n.j)) : null;
      const fs = Math.max(9.5, Math.min(12.5, 11.5 * view.k));
      ctx.font = fs + 'px ' + (css('--md-text-font-family') || 'sans-serif');
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      nodes.forEach(p => {
        const dim = dimSec(p) || (neigh && p.i !== active && !neigh.has(p.i));
        const x = sx(p), y = sy(p), r = p.r * view.k;
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color(p); ctx.fill();
        if (p.i === selected || p.i === hover) { ctx.lineWidth = 2.5; ctx.strokeStyle = fg; ctx.stroke(); }
      });
      /* подписи — без наложений: первым подписывается активный узел, за ним
         его соседи, потом остальные по размеру; подпись достаётся, только
         если место свободно (у узла с полусотней соседей иначе выходит пятно
         из букв). Непомеченные узлы подписываются при наведении. */
      const placed = [];
      const must = p => p.i === active;
      const rank = p => (p.i === active ? 2 : neigh && neigh.has(p.i) ? 1 : 0);
      const order = nodes.slice().sort((a, b) => (rank(b) - rank(a)) || (b.r - a.r));
      order.forEach(p => {
        const dim = dimSec(p) || (neigh && p.i !== active && !neigh.has(p.i));
        if (dim && !must(p)) return;
        const label = shortName(p.t), w = ctx.measureText(label).width + 6;
        const x = sx(p), y = sy(p) + p.r * view.k + 2;
        const box = [x - w / 2, y, x + w / 2, y + fs + 3];
        if (!must(p) && placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
        placed.push(box);
        ctx.globalAlpha = dim ? 0.3 : 0.9;
        ctx.fillStyle = fg;
        ctx.fillText(label, x, y);
      });
      ctx.globalAlpha = 1;
    }
    function frame() {
      if (!root.isConnected) return;
      const steps = alpha > 0.3 ? 3 : 1;
      for (let s = 0; s < steps; s++) if (alpha) tick();
      fit();
      if (alpha || dirty) { draw(); dirty = false; }
      requestAnimationFrame(frame);
    }

    /* ── мышь и палец: наведение, перетаскивание, выбор ── */
    function pos(ev) { const r = canvas.getBoundingClientRect(); return {x: ev.clientX - r.left, y: ev.clientY - r.top}; }
    function hit(m) {
      let best = -1, bd = Infinity;
      nodes.forEach(p => {
        const d = Math.hypot(sx(p) - m.x, sy(p) - m.y);
        if (d < p.r * view.k + 6 && d < bd) { bd = d; best = p.i; }
      });
      return best;
    }
    let downAt = null, moved = false, panning = false;
    const ptrs = new Map();      /* активные указатели: id → точка */
    let pinch = null;            /* два пальца: прошлое расстояние и середина */
    function dropDrag() {
      if (dragging) { dragging.fx = dragging.fy = null; dragging = null; canvas.classList.remove('drag'); }
    }
    function two() {
      const [a, b] = [...ptrs.values()];
      return {d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2};
    }
    canvas.addEventListener('pointerdown', ev => {
      const m = pos(ev);
      ptrs.set(ev.pointerId, m);
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* синтетические события без захвата */ }
      if (ptrs.size === 2) { dropDrag(); pinch = two(); downAt = null; panning = false; return; }
      if (ptrs.size > 2) return;
      const i = hit(m);
      downAt = m; moved = false; panning = false;
      if (i >= 0) { dragging = nodes[i]; canvas.classList.add('drag'); }
      /* мышью по пустому месту — тянем весь граф; пальцем нет: вертикальный
         свайп по холсту должен прокручивать страницу (touch-action: pan-y) */
      else if (ev.pointerType === 'mouse') panning = true;
    });
    canvas.addEventListener('pointermove', ev => {
      const m = pos(ev), prev = ptrs.get(ev.pointerId);
      if (prev) ptrs.set(ev.pointerId, m);
      if (pinch && ptrs.size >= 2) {
        const t = two();
        zoomAt({x: t.mx, y: t.my}, t.d / (pinch.d || t.d));
        user.x += t.mx - pinch.mx; user.y += t.my - pinch.my;
        pinch = t; applyView();
        return;
      }
      if (dragging) {
        if (downAt && Math.hypot(m.x - downAt.x, m.y - downAt.y) > 3) moved = true;
        dragging.fx = (m.x - view.tx) / view.k; dragging.fy = (m.y - view.ty) / view.k;
        heat(0.12); dirty = true;
        return;
      }
      if (panning && prev) {
        if (downAt && Math.hypot(m.x - downAt.x, m.y - downAt.y) > 3) moved = true;
        if (moved) { user.x += m.x - prev.x; user.y += m.y - prev.y; applyView(); }
        return;
      }
      const h = hit(m);
      if (h !== hover) { hover = h; dirty = true; canvas.style.cursor = h >= 0 ? 'pointer' : ''; }
    });
    function release(ev, tap) {
      ptrs.delete(ev.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (dragging) {
        const d = dragging; dropDrag();
        if (tap && !moved) select(d.i);
      } else if (tap && downAt && !moved) select(-1);
      downAt = null; panning = false; dirty = true;
    }
    canvas.addEventListener('pointerup', ev => release(ev, true));
    canvas.addEventListener('pointercancel', ev => release(ev, false));
    /* колесо с ctrl — так трекпад отдаёт щипок; обычное колесо листает страницу */
    canvas.addEventListener('wheel', ev => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      zoomAt(pos(ev), Math.exp(-ev.deltaY * 0.01)); applyView();
    }, {passive: false});
    zoom0.addEventListener('click', zoomReset);
    canvas.addEventListener('pointerleave', () => { if (hover >= 0) { hover = -1; dirty = true; } });

    /* ── панель под холстом ── */
    const panelEl = $('#tg-panel');
    function select(i) { if (i !== selected) showAll = false; selected = i; dirty = true; panel(); }
    const chip = i => '<a href="#" class="tg-chip" data-i="' + i + '"><i class="tg-dot" style="background:'
      + color(nodes[i]) + '"></i>' + esc(shortName(nodes[i].t)) + '</a>';
    function panel() {
      if (selected < 0) {
        const deg = nodes.map(p => adj[mode][p.i].length);
        const order = nodes.map(p => p.i).sort((a, b) => deg[b] - deg[a] || a - b);
        panelEl.innerHTML = '<p class="tg-hint">Нажмите на точку — здесь появится, с чем связана страница и почему. '
          + 'Точки можно таскать; чипы разделов сверху подсвечивают свой раздел.</p>'
          + '<h4>Через эти страницы проходит почти всё</h4><p class="tg-chips">' + order.slice(0, 6).map(chip).join(' ') + '</p>'
          + '<h4>На отшибе</h4><p class="tg-chips">' + order.slice(-6).reverse().map(chip).join(' ') + '</p>';
        return;
      }
      const p = nodes[selected];
      const li = (n, w) => '<li><a href="#" data-i="' + n.j + '">' + esc(nodes[n.j].t) + '</a> <span class="tg-w">' + w + '</span>'
        + (n.l ? ' <span class="tg-why">— ' + esc(n.l) + '</span>' : '') + '</li>';
      const cut = (list, f) => (showAll ? list : list.slice(0, 10)).map(f).join('')
        + (!showAll && list.length > 10 ? '<li class="tg-more"><a href="#" class="tg-all">все ' + list.length + '</a></li>' : '');
      const links = adj.links[p.i], co = adj.co[p.i];
      panelEl.innerHTML = '<h3><i class="tg-dot" style="background:' + color(p) + '"></i> <a href="' + pageUrl(p.t) + '">' + esc(p.t) + '</a>'
        + ' <small class="tg-sec">' + esc(data.sections[p.s]) + '</small></h3>'
        + (p.h ? '<p class="tg-hook">' + esc(p.h) + '</p>' : '')
        + '<p class="tg-meta">Страница опирается на ' + plural(p.n, 'занятие', 'занятия', 'занятий')
        + ' · <a href="' + pageUrl(p.t) + '">открыть страницу</a></p>'
        + '<div class="tg-cols"><div><h4>Ссылки · ' + links.length + '</h4><ul>'
        + (links.length ? cut(links, n => li(n, '×' + n.w)) : '<li class="tg-none">ни одной</li>') + '</ul></div>'
        + '<div><h4>Общие занятия · ' + co.length + '</h4><ul>'
        + (co.length ? cut(co, n => li(n, plural(n.w, 'занятие', 'занятия', 'занятий'))) : '<li class="tg-none">ни одного</li>')
        + '</ul></div></div>';
    }
    panelEl.addEventListener('click', ev => {
      const a = ev.target.closest('a[data-i]');
      if (a) { ev.preventDefault(); select(+a.dataset.i); return; }
      if (ev.target.closest('.tg-all')) { ev.preventDefault(); showAll = true; panel(); }
    });

    /* ── управление ── */
    const minEl = $('#tg-min'), minV = $('#tg-min-v');
    function syncMin() {
      minV.textContent = mode === 'co'
        ? plural(min, 'общего занятия', 'общих занятий', 'общих занятий')
        : plural(min, 'упоминания', 'упоминаний', 'упоминаний');
      minV.textContent += ' · ' + plural(edges.length, 'связь', 'связи', 'связей');
    }
    function setMode(m) {
      mode = m; min = defaultMin(data, mode);
      minEl.max = Math.max(2, maxWeight(data, mode)); minEl.value = min;
      rebuild(); syncMin(); heat(0.7);
      if (selected < 0) panel();
    }
    root.querySelectorAll('input[name=tg-mode]').forEach(r => r.addEventListener('change', () => setMode(r.value)));
    minEl.addEventListener('input', () => { min = +minEl.value; rebuild(); syncMin(); heat(0.4); });
    $('#tg-reset').addEventListener('click', () => { scatter(); heat(1); });
    new ResizeObserver(resize).observe(canvas);
    new MutationObserver(() => { dirty = true; }).observe(document.body, {attributes: true, attributeFilter: ['data-md-color-scheme']});
    resize(); scatter(); setMode('links'); panel(); heat(1);
    requestAnimationFrame(frame);
  }

  const safe = () => { try { init(); } catch (e) { console.warn('tr21: сбой в карте теории', e); } };
  document.addEventListener('DOMContentLoaded', () => {
    safe();
    new MutationObserver(safe).observe(document.body, {childList: true, subtree: true});
  });
  window.addEventListener('encryptcontent_event', safe);
})();

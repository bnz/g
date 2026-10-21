window.TR21_BASE = "/w/5b1c4a39";
window.TR21_VERSION = "20261021-001";

/* ── тренажёр: карточки по глоссарию, шкалам СМИЛ и цитатам ───────────────
   Данные лежат в странице (#tr-data, внутри шифра); код здесь. Счёт за день
   хранится в localStorage у читателя. Чистые функции вынесены наверх — их
   гоняет tests/js/train.test.mjs. */
(() => {
  const BASE = window.TR21_BASE || '';

  /* ── чистые функции тренажёра ── */
  function trPlural(n, one, few, many) {
    const m = n % 100, k = n % 10;
    return n + ' ' + (m > 10 && m < 20 ? many : k === 1 ? one : k > 1 && k < 5 ? few : many);
  }
  /* варианты ответа: правильный плюс n-1 случайных других, перемешанные;
     rnd — источник случайности (в тестах подставляется свой) */
  function trOptions(pool, correct, n, rnd) {
    const others = pool.filter(x => x !== correct);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1)); [others[i], others[j]] = [others[j], others[i]];
    }
    const out = others.slice(0, Math.max(0, n - 1)).concat([correct]);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  /* устойчивый ключ карточки: у понятия — якорь глоссария, у абзаца — хеш
     текста. Индекс не годится: колоды растут с каждой выкладкой, и прогресс
     по индексам поехал бы */
  function trHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  function trKey(mode, it) { return mode === 'terms' ? it.a : trHash(it.x); }
  /* выбор карточки по прогрессу {ключ: 1 верно | 0 ошибка}: сначала
     непройденные, но каждая четвёртая — из ошибок, чтобы они возвращались;
     когда непройденных нет — только ошибки; когда и их нет — колода пройдена */
  function trPick(keys, prog, rnd) {
    const unseen = [], wrong = [];
    keys.forEach((k, i) => { if (!(k in prog)) unseen.push(i); else if (prog[k] === 0) wrong.push(i); });
    let pool = unseen;
    if (wrong.length && (!unseen.length || rnd() < 0.25)) pool = wrong;
    if (!pool.length) return -1;
    return pool[Math.floor(rnd() * pool.length)];
  }
  function trStats(keys, prog) {
    let seen = 0, wrong = 0;
    keys.forEach(k => { if (k in prog) { seen++; if (prog[k] === 0) wrong++; } });
    return {seen, wrong, total: keys.length};
  }
  /* в определении само понятие прячется: иначе ответ написан в вопросе */
  function trMask(text, term) {
    const core = term.replace(/\s*\(.*?\)/g, '').replace(/[«»"]/g, '').trim();
    const words = core.split(/\s+/).filter(w => w.length >= 4);
    let out = text;
    words.forEach(w => {
      const stem = w.slice(0, Math.max(4, Math.min(5, w.length - 2))).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[её]/gi, '[её]');
      out = out.replace(new RegExp('(^|[^а-яёa-z])' + stem + '[а-яёa-z]*', 'gi'), '$1…');
    });
    return out;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function init() {
    const root = document.getElementById('tr-root');
    const dataEl = document.getElementById('tr-data');
    if (!root || !dataEl || root.dataset.ready) return;
    root.dataset.ready = '1';
    const data = JSON.parse(dataEl.textContent);
    const MODES = [
      {key: 'terms', title: 'Понятия', ask: 'Какое понятие описано так?', items: data.terms},
      {key: 'scales', title: 'Шкалы СМИЛ', ask: 'О какой шкале речь?', items: data.scales},
      {key: 'theory', title: 'Теория', ask: 'С какой страницы теории этот абзац?', items: data.theory},
    ].filter(m => m.items && m.items.length >= 8);
    if (!MODES.length) { root.innerHTML = '<p>Для тренажёра пока мало материала.</p>'; return; }

    /* счёт за день — у читателя, в его браузере */
    const today = new Date().toISOString().slice(0, 10);
    let score;
    try { score = JSON.parse(localStorage.getItem('tr21-train') || 'null'); } catch (e) { score = null; }
    if (!score || score.date !== today) score = {date: today, ok: 0, all: 0, streak: 0, best: 0};
    /* прогресс по колодам — тоже у читателя; переживает обновление страницы
       и выкладки (ключи устойчивые), но не синхронизируется между устройствами */
    let progress;
    try { progress = JSON.parse(localStorage.getItem('tr21-train-progress') || 'null'); } catch (e) { progress = null; }
    if (!progress || typeof progress !== 'object') progress = {};
    const save = () => {
      try {
        localStorage.setItem('tr21-train', JSON.stringify(score));
        localStorage.setItem('tr21-train-progress', JSON.stringify(progress));
      } catch (e) { /* приватное окно */ }
    };
    const keysOf = {};
    MODES.forEach(m => { keysOf[m.key] = m.items.map(it => trKey(m.key, it)); });

    root.innerHTML = '<div class="tr-modes">' + MODES.map((m, i) =>
        '<button type="button" class="tr-mode' + (i ? '' : ' on') + '" data-i="' + i + '">' + m.title
        + ' <span class="tr-n">' + m.items.length + '</span></button>').join('') + '</div>'
      + '<div class="tr-progress"><span class="tr-prog-text"></span>'
      + '<button type="button" class="tr-reset">Сбросить прогресс колоды</button></div>'
      + '<div class="tr-score"></div>'
      + '<div class="tr-card"><div class="tr-ask"></div><div class="tr-q"></div><div class="tr-opts"></div>'
      + '<div class="tr-after" hidden><p class="tr-verdict"></p><p class="tr-src"></p>'
      + '<button type="button" class="tr-next">Дальше</button></div></div>';
    const $ = sel => root.querySelector(sel);
    let mode = MODES[0], cur = null, answered = false;

    function paintScore() {
      $('.tr-score').textContent = score.all
        ? 'Сегодня: ' + score.ok + ' из ' + trPlural(score.all, 'карточки', 'карточек', 'карточек')
          + ' · серия ' + score.streak + (score.best > 1 ? ' · лучшая ' + score.best : '')
        : 'Отвечайте цифрами 1–4 или кликом; Enter — дальше.';
    }
    function paintProgress(note) {
      const st = trStats(keysOf[mode.key], progress[mode.key] || {});
      $('.tr-prog-text').textContent = (note ? note + ' · ' : '')
        + 'Пройдено ' + st.seen + ' из ' + st.total
        + (st.wrong ? ', ' + trPlural(st.wrong, 'ошибка', 'ошибки', 'ошибок') + ' на повтор' : '');
      const r = $('.tr-reset');
      r.hidden = !st.seen; r.textContent = 'Сбросить прогресс колоды'; delete r.dataset.arm;
    }
    function card() {
      answered = false;
      const items = mode.items;
      const prog = progress[mode.key] || (progress[mode.key] = {});
      let note = '';
      let i = trPick(keysOf[mode.key], prog, Math.random);
      if (i < 0) {           /* всё пройдено без ошибок — круг заново */
        progress[mode.key] = {}; save();
        note = '🎉 Колода пройдена без ошибок, начинаем заново';
        i = trPick(keysOf[mode.key], progress[mode.key], Math.random);
      }
      const it = items[i];
      cur = null;
      let q, opts, correct, labelOf, src;
      if (mode.key === 'terms') {
        q = trMask(it.d, it.t);
        const pool = items.map(x => x.t);
        correct = it.t; opts = trOptions(pool, correct, 4, Math.random); labelOf = x => x;
        src = '<a href="' + BASE + '/теория/глоссарий/#' + it.a + '">' + esc(it.t) + '</a> в глоссарии'
          + (it.n ? ' · занятие <a href="' + BASE + '/занятия/' + String(it.n).padStart(3, '0') + '/">№' + it.n + '</a>' : '');
      } else if (mode.key === 'scales') {
        q = it.x;
        const pool = data.scaleNames.map((_, k) => k);
        correct = it.s; opts = trOptions(pool, correct, 4, Math.random); labelOf = k => data.scaleNames[k].split(' — ')[0];
        src = 'страница <a href="' + BASE + '/теория/' + encodeURIComponent(data.scaleNames[it.s]) + '/">' + esc(data.scaleNames[it.s]) + '</a>';
      } else {
        q = it.x;
        /* варианты — страницы того же раздела: угадать травму среди травм
           труднее и полезнее, чем среди случайных тем; если раздел мал,
           добираем из остальных */
        const sec = data.theorySec[it.p];
        let pool = data.theoryNames.map((_, k) => k).filter(k => data.theorySec[k] === sec);
        if (pool.length < 4) pool = data.theoryNames.map((_, k) => k);
        correct = it.p; opts = trOptions(pool, correct, 4, Math.random); labelOf = k => data.theoryNames[k];
        src = 'страница <a href="' + BASE + '/теория/' + encodeURIComponent(data.theoryNames[it.p]) + '/">' + esc(data.theoryNames[it.p]) + '</a>'
          + (sec ? ' · раздел «' + esc(sec) + '»' : '');
      }
      cur = {opts, correct, labelOf, src, key: keysOf[mode.key][i]};
      paintProgress(note);
      $('.tr-ask').textContent = mode.ask;
      $('.tr-q').textContent = q;
      $('.tr-opts').innerHTML = opts.map((o, k) =>
        '<button type="button" class="tr-opt" data-k="' + k + '"><span class="tr-key">' + (k + 1) + '</span>' + esc(labelOf(o)) + '</button>').join('');
      $('.tr-after').hidden = true;
      paintScore();
    }
    function answer(k) {
      if (answered || !cur || k < 0 || k >= cur.opts.length) return;
      answered = true;
      const right = cur.opts[k] === cur.correct;
      root.querySelectorAll('.tr-opt').forEach((b, j) => {
        b.disabled = true;
        if (cur.opts[j] === cur.correct) b.classList.add('ok');
        else if (j === k) b.classList.add('bad');
      });
      score.all++;
      if (right) { score.ok++; score.streak++; score.best = Math.max(score.best, score.streak); }
      else score.streak = 0;
      (progress[mode.key] || (progress[mode.key] = {}))[cur.key] = right ? 1 : 0;
      save();
      paintProgress();
      $('.tr-verdict').innerHTML = right ? '✓ Верно' : '✗ Нет, это ' + esc(cur.labelOf(cur.correct));
      $('.tr-verdict').className = 'tr-verdict ' + (right ? 'ok' : 'bad');
      $('.tr-src').innerHTML = 'Источник: ' + cur.src;
      $('.tr-after').hidden = false;
      $('.tr-next').focus();
      paintScore();
    }
    root.addEventListener('click', ev => {
      const m = ev.target.closest('.tr-mode');
      if (m) { mode = MODES[+m.dataset.i]; root.querySelectorAll('.tr-mode').forEach(b => b.classList.toggle('on', b === m)); card(); return; }
      const o = ev.target.closest('.tr-opt');
      if (o) { answer(+o.dataset.k); return; }
      const rs = ev.target.closest('.tr-reset');
      if (rs) {              /* сброс в два нажатия: случайный клик не должен стирать прогресс */
        if (!rs.dataset.arm) { rs.dataset.arm = '1'; rs.textContent = 'Точно сбросить? Нажмите ещё раз'; return; }
        progress[mode.key] = {}; save(); card(); return;
      }
      if (ev.target.closest('.tr-next')) card();
    });
    document.addEventListener('keydown', ev => {
      if (!root.isConnected || ev.target.matches('input, textarea')) return;
      if (ev.key >= '1' && ev.key <= '4') { answer(+ev.key - 1); ev.preventDefault(); }
      else if ((ev.key === 'Enter' || ev.key === ' ') && answered) { card(); ev.preventDefault(); }
    });
    card();
  }

  const safe = () => { try { init(); } catch (e) { console.warn('tr21: сбой в тренажёре', e); } };
  document.addEventListener('DOMContentLoaded', () => {
    safe();
    new MutationObserver(safe).observe(document.body, {childList: true, subtree: true});
  });
  window.addEventListener('encryptcontent_event', safe);
})();

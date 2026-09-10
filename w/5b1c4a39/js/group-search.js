window.TR21_BASE = "/w/5b1c4a39";
window.TR21_VERSION = "20260910-006";

/* Поиск по зашифрованной вики: ключи — из sessionStorage (кладёт encryptcontent
   после ввода пароля), индекс — search_index.json + encrypted_search_index.json. */
(function () {
  let docs = null;

  function fromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
  function fromHex(s) { return new Uint8Array(s.match(/.{1,2}/g).map(b => parseInt(b, 16))); }

  function sessionKeys() {
    const keys = {};
    Object.keys(sessionStorage).forEach(id => {
      const v = sessionStorage.getItem(id);
      if (v && v.length === 64 && /^[0-9a-f]+$/i.test(v)) keys[id] = fromHex(v);
    });
    return keys;
  }

  async function decryptBundle(rawKey, bundle) {
    const [ivB64, ctB64] = bundle.split(';');
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-CBC', true, ['decrypt']);
    try {
      const plain = await crypto.subtle.decrypt({name: 'AES-CBC', iv: fromB64(ivB64)}, key, fromB64(ctB64));
      return new TextDecoder().decode(plain);
    } catch (e) { return null; }
  }

  async function loadDocs() {
    if (docs) return docs;
    docs = [];
    try {
      const clear = await fetch('/w/5b1c4a39/search/search_index.json').then(r => r.json());
      docs.push(...(clear.docs || []));
    } catch (e) {}
    try {
      const enc = await fetch('/w/5b1c4a39/search/encrypted_search_index.json').then(r => r.json());
      const keys = sessionKeys();
      for (const id in enc) {
        for (const kid in keys) {
          const plain = await decryptBundle(keys[kid], enc[id]);
          if (plain) { docs.push(...JSON.parse(plain)); break; }
        }
      }
    } catch (e) {}
    prepare(docs);
    return docs;
  }

  /* Сборка по окну живёт в подпапке /w/<хеш>/. Статические адреса в файлах
     переписывает _rebase, но js строит и сравнивает пути НА ЛЕТУ, и туда он
     не достаёт: location.pathname возвращает путь с префиксом, поэтому
     сравнения вида path.startsWith('/люди/') молча переставали срабатывать, а
     собранные адреса уводили в корневую сборку. relPath() снимает префикс,
     BASE — добавляет. */
  const BASE = (typeof window !== 'undefined' && window.TR21_BASE) || '';
  function relPath() {
    const p = decodeURIComponent(location.pathname);
    return BASE && p.indexOf(BASE) === 0 ? p.slice(BASE.length) : p;
  }

  function esc(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  /* Разделы вики — по первому сегменту адреса; порядок как в меню.
     Последний ловит всё остальное (главная, динамика, дни рождения). */
  const SECTIONS = [
    ['занятия', 'Занятия', p => p.indexOf('занятия/') === 0],
    ['люди',    'Люди',    p => p.indexOf('люди/') === 0],
    ['теория',  'Теория',  p => p.indexOf('теория/') === 0],
    ['вопросы', 'Вопросы', p => p.indexOf('вопросы/') === 0],
    ['истории', 'Истории', p => p.indexOf('истории/') === 0 || p.indexOf('картотека') === 0],
    ['разное',  'Разное',  () => true],
  ];
  const LABEL = {}; SECTIONS.forEach(s => LABEL[s[0]] = s[1]);

  /* Карта «слаг портрета → имя» лежит на самой (зашифрованной) странице поиска:
     сам индекс знает портреты только по нейтральному адресу. */
  let PERSONS = {};
  function loadPersons() {
    const box = document.getElementById('gs-persons');
    if (!box) return;
    try { PERSONS = JSON.parse(box.textContent) || {}; } catch (e) { PERSONS = {}; }
  }
  function personOf(loc) {
    let base = loc.split('#')[0];
    try { base = decodeURIComponent(base); } catch (e) {}
    return PERSONS[base] || '';
  }

  /* Разметить записи индекса: раздел, имя владельца портрета, название страницы,
     к которой относится найденный кусок. Вынесено из loadDocs, чтобы тест
     проверял ровно этот код, а не свою копию. */
  function prepare(docs) {
    const pages = {};
    docs.forEach(d => { if (d.location.indexOf('#') < 0) pages[d.location] = d.title || ''; });
    docs.forEach(d => {
      const person = personOf(d.location);
      if (person && d.location.indexOf('#') < 0) d.title = person;   // сама страница портрета
      d._t = (d.title || '').toLowerCase();
      d._x = (d.text || '').toLowerCase();
      d._s = sectionOf(d.location);
      d._p = person || pages[d.location.split('#')[0]] || '';
    });
    return docs;
  }

  function sectionOf(loc) {
    let p = loc;
    try { p = decodeURIComponent(loc); } catch (e) {}
    for (const s of SECTIONS) if (s[2](p)) return s[0];
    return 'разное';
  }

  /* Совпадения ищем не подстрокой: «сила» не должна находиться в «попросила».
     Целое слово ценится выше начала слова (оно ловит склонения), совпадение
     внутри слова почти ничего не стоит — оно лишь не даёт документу выпасть. */
  const W = '\\p{L}\\p{N}_';
  const _rx = {};
  function rx(term, whole) {
    const k = (whole ? 'w' : 'p') + ':' + term;
    if (_rx[k]) return _rx[k];
    const t = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tail = whole ? '(?![' + W + '])' : '';
    let r;
    try { r = new RegExp('(?<![' + W + '])' + t + tail, 'giu'); }
    catch (e) { r = new RegExp('(^|[^' + W + '])' + t + tail, 'giu'); }
    return (_rx[k] = r);
  }
  function count(hay, re) { const m = hay.match(re); return m ? m.length : 0; }

  /* Режим «фразой целиком»: слова должны идти подряд и в том же порядке.
     Между ними допускается разделитель — запятая, тире, перенос строки, — но не
     конец предложения: «их три. Невроза не было» фразой «три невроза» не является. */
  function phraseRx(q) {
    const k = 'f:' + q;
    if (_rx[k]) return _rx[k];
    const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const body = words.join('[^' + W + '.!?]+');
    let r;
    try { r = new RegExp('(?<![' + W + '])' + body, 'giu'); }
    catch (e) { r = new RegExp('(^|[^' + W + '])' + body, 'giu'); }
    return (_rx[k] = r);
  }

  /* Возвращает вес поля и оценку каждого слова запроса по отдельности:
     2 — целым словом, 1 — началом слова (склонение), 0 — только внутри слова. */
  function scoreField(hay, terms, phrase) {
    const marks = terms.map(() => 0);
    let score = 0;
    if (!hay) return [0, marks];
    if (terms.length > 1 && count(hay, rx(phrase, false))) score += 10;
    terms.forEach((t, i) => {
      const whole = count(hay, rx(t, true));
      if (whole) { score += 4 * Math.min(whole, 3); marks[i] = 2; return; }
      const pre = count(hay, rx(t, false));
      if (pre) { score += 2 * Math.min(pre, 3); marks[i] = 1; return; }
      if (hay.indexOf(t) >= 0) score += 0.2;
    });
    return [score, marks];
  }

  function snippet(text, terms, phrase) {
    if (!text) return '';
    let at = -1, len = terms[0].length;
    const seek = t => {
      if (at >= 0) return;
      const r = rx(t, false); r.lastIndex = 0;
      const m = r.exec(text);
      if (m) { at = m.index + (m[1] ? m[1].length : 0); len = t.length; }
    };
    if (terms.length > 1) seek(phrase);
    terms.forEach(seek);
    if (at < 0) at = Math.max(0, text.toLowerCase().indexOf(terms[0]));
    const a = Math.max(0, at - 80), b = Math.min(text.length, at + len + 140);
    let out = esc(text.slice(a, b));
    for (const t of terms) out = out.replace(rx(t, false), m => {
      const k = m.toLowerCase().indexOf(t);
      return m.slice(0, k) + '<mark>' + m.slice(k) + '</mark>';
    });
    return (a ? '…' : '') + out + (b < text.length ? '…' : '');
  }

  /* Отмеченные разделы держим в localStorage — выбор переживает перезагрузку. */
  const PICK = 'gs-sections', PHRASE = 'gs-phrase';
  function phraseOn() { return localStorage.getItem(PHRASE) === '1'; }
  function picked() {
    try {
      const v = JSON.parse(localStorage.getItem(PICK));
      if (Array.isArray(v) && v.length) return v;
    } catch (e) {}
    return SECTIONS.map(s => s[0]);
  }

  /* История запросов — только то, что отправлено по Enter: набор по букве
     засорял бы её каждым промежуточным словом. */
  const HIST = 'gs-history', HIST_ON = 'gs-history-open';
  function history() {
    try {
      const v = JSON.parse(localStorage.getItem(HIST));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function remember(q) {
    q = q.trim();
    if (q.length < 3) return;
    const v = history().filter(x => x.toLowerCase() !== q.toLowerCase());
    v.unshift(q);
    localStorage.setItem(HIST, JSON.stringify(v.slice(0, 20)));
  }
  function drawHistory(box) {
    const v = history();
    box.innerHTML = v.length
      ? v.map(q => '<button type="button" class="gs-q">' + esc(q) + '</button>').join('')
        + '<button type="button" class="gs-clear">очистить</button>'
      : '<span class="gs-empty">Пусто: запрос запоминается, когда нажимаешь Искать</span>';
  }

  function drawFacets(box, onChange) {
    const on = picked();
    box.innerHTML = SECTIONS.map(s =>
      '<label class="gs-facet"><input type="checkbox" value="' + s[0] + '"'
      + (on.indexOf(s[0]) >= 0 ? ' checked' : '') + '> ' + s[1]
      + ' <span class="gs-n" data-s="' + s[0] + '"></span></label>').join('')
      + '<label class="gs-facet gs-mode" title="слова идут подряд и в том же порядке">'
      + '<input type="checkbox" class="gs-phrase"' + (phraseOn() ? ' checked' : '')
      + '> фразой целиком</label>'
      + '<button type="button" class="gs-all">отметить все</button>'
      + '<button type="button" class="gs-hist">история</button>';
    box.addEventListener('change', e => {
      const ids = SECTIONS.map(s => s[0]);
      const v = [...box.querySelectorAll('input:checked')]
        .map(i => i.value).filter(x => ids.indexOf(x) >= 0);
      const mode = box.querySelector('.gs-phrase');
      if (!v.length && e.target && ids.indexOf(e.target.value) >= 0) {
        e.target.checked = true;          // искать негде — последнюю галочку не отдаём
        return;
      }
      if (v.length) localStorage.setItem(PICK, JSON.stringify(v));
      localStorage.setItem(PHRASE, mode && mode.checked ? '1' : '0');
      onChange();
    });
    box.querySelector('.gs-all').addEventListener('click', () => {
      box.querySelectorAll('input').forEach(i => { i.checked = true; });
      localStorage.setItem(PICK, JSON.stringify(SECTIONS.map(s => s[0])));
      onChange();
    });
  }

  async function run(q, out, cnt) {
    q = q.trim().toLowerCase();
    if (q.length < 3) { out.innerHTML = ''; cnt.textContent = ''; return; }
    const all = await loadDocs();
    const terms = q.split(/\s+/).filter(t => t.length >= 2);
    if (!terms.length) { out.innerHTML = ''; cnt.textContent = ''; return; }
    const on = picked(), per = {}, scored = [];
    const exact = phraseOn() ? phraseRx(q) : null;
    SECTIONS.forEach(s => per[s[0]] = 0);
    for (const d of all) {
      if (exact && !count(d._t, exact) && !count(d._x, exact)) continue;
      if (!terms.every(t => d._t.indexOf(t) >= 0 || d._x.indexOf(t) >= 0)) continue;
      const t = scoreField(d._t, terms, q), x = scoreField(d._x, terms, q);
      // каждое слово запроса должно найтись словом, а не куском чужого слова:
      // иначе «сила» цепляет «попросила», и выдача забивается случайным
      if (!terms.every((_, i) => t[1][i] || x[1][i])) continue;
      // длинные страницы-агрегаторы (буквы глоссария, списки занятий) совпадают
      // со всем подряд — вес их текста делим на логарифм длины
      const long = Math.max(1, (d.text || '').length / 400);
      let score = t[0] * 6 + x[0] / (1 + Math.log10(long));
      if (d._t === q) score += 100;                        // заголовок ровно то, что искали
      if (t[1].every(Boolean)) score += 20;                // все слова запроса в заголовке
      if (x[1].every(v => v === 2)) score += 6;            // все слова целиком в тексте
      per[d._s]++;
      if (on.indexOf(d._s) < 0) continue;
      scored.push([score, d]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    document.querySelectorAll('.gs-n').forEach(el => {
      const n = per[el.dataset.s] || 0;
      el.textContent = n ? '(' + n + ')' : '';
    });
    const hidden = Object.keys(per).reduce((n, k) => n + (on.indexOf(k) < 0 ? per[k] : 0), 0);
    const why = exact ? ' — искали фразой целиком' : '';
    cnt.textContent = scored.length
      ? 'Найдено: ' + scored.length + (hidden ? ' (ещё ' + hidden + ' в снятых разделах)' : '')
      : (hidden ? 'В отмеченных разделах ничего; ещё ' + hidden + ' в снятых'
                : 'Ничего не найдено' + why);
    out.innerHTML = scored.slice(0, 40).map(pair => {
      const d = pair[1];
      const path = d._p && d._p !== d.title ? ' · ' + esc(d._p) : '';
      const body = snippet(d.text || '', terms, q);
      return '<article><div class="gs-meta">' + LABEL[d._s] + path + '</div>'
        + '<h4><a href="' + BASE + '/' + d.location + '">' + esc(d.title || d.location) + '</a></h4>'
        + (body ? '<p>' + body + '</p>' : '') + '</article>';
    }).join('');
  }

  function bind() {
    const inp = document.getElementById('gs-input');
    if (!inp || inp._bound) return;
    inp._bound = true;
    const out = document.getElementById('gs-results'), cnt = document.getElementById('gs-count');
    const box = document.getElementById('gs-facets');
    const hist = document.getElementById('gs-history');
    loadPersons();
    const go = () => run(inp.value, out, cnt);
    const submit = () => { remember(inp.value); if (hist) drawHistory(hist); go(); };
    if (box) drawFacets(box, go);
    if (hist) {
      drawHistory(hist);
      if (localStorage.getItem(HIST_ON) === '1') hist.classList.add('on');
      hist.addEventListener('click', e => {
        const b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        if (b.className === 'gs-clear') { localStorage.removeItem(HIST); drawHistory(hist); return; }
        inp.value = b.textContent;
        remember(inp.value);
        drawHistory(hist);
        go();
      });
      const btn = box && box.querySelector('.gs-hist');
      if (btn) btn.addEventListener('click', () => {
        const on = hist.classList.toggle('on');
        localStorage.setItem(HIST_ON, on ? '1' : '0');
        if (on) drawHistory(hist);
      });
    }
    // ищем только по явной команде: Enter или кнопка. Поиск по каждой букве
    // засорял историю и дёргал выдачу, пока запрос ещё не дописан
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    const btn = document.getElementById('gs-go');
    if (btn) btn.addEventListener('click', submit);
    inp.focus();
    loadDocs();
  }

  /* шапка матрицы посещаемости: прижимается под хедер сайта при скролле страницы
     (CSS-sticky тут не работает — таблица внутри overflow-x контейнера) */
  function matrixSticky() {
    document.querySelectorAll('.matrix-wrap').forEach(wrap => {
      if (wrap._sticky) return;
      wrap._sticky = true;
      const ths = wrap.querySelectorAll('thead th');
      function upd() {
        const hdr = document.querySelector('.md-header');
        const off = hdr ? hdr.getBoundingClientRect().bottom : 0;
        const r = wrap.getBoundingClientRect();
        const hh = ths[0].getBoundingClientRect().height;
        const y = (r.top < off && r.bottom > off + hh) ? off - r.top : 0;
        ths.forEach(t => { t.style.transform = y > 0 ? 'translateY(' + y + 'px)' : ''; });
      }
      window.addEventListener('scroll', upd, {passive: true});
      window.addEventListener('resize', upd, {passive: true});
      upd();
    });
  }

  /* ── доводка штатной навигации ──────────────────────────────────────
     Штатный nav mkdocs есть на КАЖДОЙ странице (на зашифрованном сайте
     его содержимое восстанавливает плагин после ввода пароля) и уже
     несёт логотип, все восемь разделов, их эмодзи, стрелки и вложенные
     панели. Страницы вне nav (разборы вопросов, истории, персоны,
     избранное) раньше ЗАМЕНЯЛИ его самодельным меню — из-за этого там
     пропадали логотип и вложенность остальных разделов. Теперь nav не
     заменяем, а доводим: помечаем текущий раздел активным и раскрытым
     (drawer откроется сразу на его панели, десктопный lifted-режим его
     покажет) и подкладываем в панель то, чего в nav нет (список людей,
     разделы избранного, активный год). Маркеры идемпотентности живут на
     ВНУТРЕННИХ элементах nav: плагин при расшифровке пересоздаёт их, и
     доводка честно повторяется. */
  function plainLabel(s) { return s.trim().replace(/^\S+\s+/, ''); }
  function yearOf(path) {
    const m = decodeURIComponent(path).match(/\/вопросы\/(\d{4})/);
    return m ? m[1] : '';
  }
  function navRoot() {
    const nav = document.querySelector('.md-sidebar--primary .md-nav--primary');
    /* до расшифровки вместо списка внутри лежит cipher-блоб */
    return nav && nav.querySelector('.md-nav__list') ? nav : null;
  }
  function topItem(nav, name) {
    const list = nav.querySelector('.md-nav__list');
    if (!list) return null;
    for (const li of list.children) {
      const lbl = li.querySelector('.md-ellipsis');
      if (lbl && plainLabel(lbl.textContent) === name) return li;
    }
    return null;
  }
  function activate(li) {
    li.classList.add('md-nav__item--active');
    const t = li.querySelector('input.md-nav__toggle');
    if (t) t.checked = true;
  }
  /* содержимое пункта «Избранное», развёрнутого во вложенную панель
     (вынесено в чистую функцию ради тестов; зовёт group-fav.js) */
  function favPanel(items) {
    return '<input class="md-nav__toggle md-toggle" type="checkbox" id="__nav_fav" checked>'
      + '<label class="md-nav__link md-nav__link--active" for="__nav_fav">'
      +   '<span class="md-ellipsis">⭐ Избранное</span>'
      +   '<span class="md-nav__icon md-icon"></span></label>'
      + '<nav class="md-nav" data-md-level="1" aria-label="Избранное">'
      +   '<label class="md-nav__title" for="__nav_fav">'
      +     '<span class="md-nav__icon md-icon"></span>⭐ Избранное</label>'
      +   '<ul class="md-nav__list">' + items + '</ul>'
      + '</nav>';
  }
  /* group-fav.js (грузится вторым) доводит пункт «Избранное» этим же кодом */
  window.gsNavRoot = navRoot; window.gsTopItem = topItem; window.gsFavPanel = favPanel;

  /* секция «Динамика»: nav строим целиком сами (НЕ зависим от расшифровки
     плагином — он на этих страницах nav не восстанавливает), но родной
     разметкой Material: верхний уровень — разделы сайта, «Динамика» —
     вложенная панель с людьми (checked → drawer открывается сразу на ней,
     в шапке панели стрелка «назад» к списку разделов). На десктопе
     lifted-режим показывает только «Динамика» + людей — прежний вид. */
  function personsSidebar() {
    /* .roster-all хук кладёт в каждую страницу — люди в панели «Люди»
       видны из любого раздела; .roster — прежний блок страниц раздела */
    const roster = document.querySelector('.roster-all, .roster');
    const nav = navRoot();
    if (!roster || !nav) return;
    const li = topItem(nav, 'Люди');
    if (!li || li.querySelector('.roster-li')) return;
    const sub = li.querySelector('nav .md-nav__list');
    if (!sub) return;
    const here = relPath().replace(/\/$/, '');
    /* страницы персон в nav mkdocs не входят — раздел раскрываем сами;
       на обзоре/динамике/днях рождения это делает штатная сборка, на
       остальных страницах раздел должен остаться свёрнутым */
    if (here.includes('/люди/') && !here.endsWith('/люди')) activate(li);
    let ppl = '';
    roster.querySelectorAll('a').forEach(a => {
      const slug = a.getAttribute('href');
      const base = '/люди/' + slug;
      const on = here === base || here.indexOf(base + '/') === 0;
      let toc = '';
      if (on) {
        /* портрет разложен по подстраницам: в сайдбаре у активного человека
           показываем его разделы (ссылки на страницы), а не якоря одной
           простыни. Список берём из скрытого .person-nav — названия разделов
           и имена живут только в зашифрованном контенте. */
        const pn = document.querySelector('.person-nav');
        if (pn) {
          pn.querySelectorAll('a').forEach(s => {
            const sub = s.getAttribute('href');
            const url = sub ? base + '/' + sub : base;
            toc += '<li class="md-nav__item"><a class="md-nav__link'
              + (here === url ? ' md-nav__link--active' : '')
              + '" href="' + BASE + url + '/"><span class="md-ellipsis">'
              + s.textContent + '</span></a></li>';
          });
        } else {
          document.querySelectorAll('.md-content h2[id]').forEach(h => {
            toc += '<li class="md-nav__item"><a class="md-nav__link" href="#' + h.id
              + '"><span class="md-ellipsis">' + h.textContent.replace(/§/g, '').trim()
              + '</span></a></li>';
          });
        }
        if (toc) toc = '<ul class="drawer-toc">' + toc + '</ul>';
      }
      ppl += '<li class="md-nav__item roster-li"><a class="md-nav__link'
        + (on ? ' md-nav__link--active' : '')
        + '" href="' + BASE + '/люди/' + slug + '/"><span class="md-ellipsis">'
        + a.textContent + '</span></a>' + toc + '</li>';
    });
    sub.insertAdjacentHTML('beforeend', ppl);
  }

  /* тема строго по системной настройке устройства: кнопка скрыта, а ранее
     сохранённый в браузере выбор стираем (Material иначе применяет его вечно) */
  (function () {
    try {
      localStorage.removeItem('/.__palette');
      const apply = dark => {
        document.body.setAttribute('data-md-color-scheme', dark ? 'slate' : 'default');
      };
      const mq = matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      mq.addEventListener('change', e => apply(e.matches));
    } catch (e) {}
  })();

  /* правый toc «Содержание»: плагин шифрования прячет его инлайн-стилем и не
     восстанавливает — строим сами из заголовков расшифрованного контента */
  function buildToc() {
    const hs = document.querySelectorAll('.md-content h2[id], .md-content h3[id]');
    if (!hs.length) return;
    /* h3 подчиняем ближайшему h2: на хронике это «занятия внутри года».
       Когда подпунктов много (хроника — под две сотни занятий), плоский
       список бесполезен: группы сворачиваем, клик по году и перематывает
       страницу, и раскрывает его занятия. */
    const item = (h, cls) => '<li class="md-nav__item' + cls + '">'
      + '<a class="md-nav__link" href="#' + h.id + '"><span class="md-ellipsis">'
      /* из заголовка убираем служебные значки: «§» ставит mkdocs постоянной
         ссылкой, «☆»/«★» и «✎» — наши кнопки избранного, которые к этому
         моменту уже дописаны в заголовок */
      + (h.dataset.toc
         || h.textContent.replace(/[\u00a7\u2606\u2605\u270e]/g, '').trim())
      + '</span></a>';
    const groups = [];
    hs.forEach(h => {
      if (h.tagName === 'H3' && groups.length) groups[groups.length - 1].subs.push(h);
      else groups.push({top: h, subs: []});
    });
    const fold = groups.reduce((n, g) => n + g.subs.length, 0) > 20;
    let list = '<ul class="md-nav__list">';
    groups.forEach(g => {
      if (!g.subs.length) { list += item(g.top, '') + '</li>'; return; }
      list += item(g.top, fold ? ' toc-group' : '')
        + '<ul class="md-nav__list toc-subs"' + (fold ? ' hidden' : '') + '>'
        + g.subs.map(s => item(s, ' toc-sub') + '</li>').join('')
        + '</ul></li>';
    });
    list += '</ul>';
    /* сворачивание вешаем делегированно и один раз на контейнер */
    const foldable = el => {
      if (!fold || el.dataset.tocFold) return;
      el.dataset.tocFold = '1';
      el.addEventListener('click', e => {
        const a = e.target.closest('.toc-group > .md-nav__link');
        if (!a) return;
        const subs = a.parentNode.querySelector('.toc-subs');
        if (subs) subs.hidden = !subs.hidden;
      });
    };
    const key = Array.from(hs).map(h => h.id).join('|');
    /* Оглавлений в разметке два: одно в правом сайдбаре (десктоп), второе
       Material кладёт в выдвижное меню — но ТОЛЬКО для страниц, которые есть
       в nav. У нас в nav лежит один пункт-обложка, поэтому у занятий,
       портретов и историй второго нет, и на телефоне содержания не было
       вовсе. Дорисовываем его ШТАТНОЙ разметкой на штатное же место — внутрь
       активного пункта меню, — чтобы вид и поведение не отличались от тех
       страниц, где его сделал сам Material.

       ВАЖНО: пока навигация не расшифрована, в .md-nav--primary лежит строка
       «iv;шифротекст» — любой дописанный узел ломает расшифровку. Поэтому
       ждём настоящий список (`.md-nav__list` внутри активного пункта). */
    const navs = Array.from(document.querySelectorAll('.md-nav--secondary'));
    const drawer = document.querySelector('.md-sidebar--primary');
    if (drawer && relPath() !== '/' && !navs.some(n => drawer.contains(n))) {
      const list = drawerList();
      if (list) {
        /* Штатная тройка Material, иначе не работает ничего: галочка
           .md-nav__toggle#__toc, метка-открывашка [for=__toc] и сам блок.
           Панель видна по правилу «.md-nav__toggle:checked ~ .md-nav», так
           что без галочки блок не прячется вовсе — открываешь меню, а поверх
           него висит содержание, и стрелка «назад» в его шапке (та же метка
           for=__toc) ничего не переключает. */
        const item = document.createElement('li');
        item.className = 'md-nav__item tr21-toc-item';
        item.innerHTML =
            '<input class="md-nav__toggle md-toggle" id="__toc" type="checkbox">'
          + '<label class="md-nav__link" for="__toc">'
          + '<span class="md-ellipsis">📄 Содержание страницы</span>'
          + '<span class="md-nav__icon md-icon"></span></label>';
        const extra = document.createElement('nav');
        extra.className = 'md-nav md-nav--secondary';
        extra.setAttribute('aria-label', 'Содержание');
        item.appendChild(extra);
        list.insertBefore(item, list.firstChild);
        navs.push(extra);
      }
    }
    navs.forEach(nav => {
      if (nav.dataset.tocKey === key) return;
      nav.dataset.tocKey = key;
      nav.innerHTML = '<label class="md-nav__title" for="__toc">'
        + '<span class="md-nav__icon md-icon"></span>Содержание</label>' + list;
      nav.style.removeProperty('display');
      foldable(nav);
    });
  }

  /* Переход из содержания закрывает выдвижное меню: страница перескакивает
     к разделу, а меню оставалось поверх него и его приходилось закрывать
     руками. Слушаем на document — узлы меню плагин пересоздаёт. */
  function tocClose() {
    if (document.body.dataset.tocClose === '1') return;
    document.body.dataset.tocClose = '1';
    document.addEventListener('click', e => {
      const a = e.target.closest
             && e.target.closest('.md-sidebar--primary .md-nav--secondary a');
      if (!a) return;
      ['__drawer', '__toc'].forEach(id => {
        const box = document.getElementById(id);
        if (box) box.checked = false;
      });
    });
  }

  /* ── складные разделы страницы занятия ──────────────────────────────
     «Ключевое», «Разногласия и позиции», «Истории в картотеке» и
     «Открытые темы» — самые длинные блоки. По умолчанию виден анонс в несколько строк, дальше
     содержимое градиентом уходит в фон, под ним ссылка «Показать
     целиком» (в развёрнутом виде — «Свернуть»). Короткий раздел не
     сворачивается вовсе. Переход по ссылке на раздел (из «Содержания»
     или извне по hash) раскрывает его автоматически. Разделы ищутся по
     тексту заголовка: их id (_4, _5…) плавают от занятия к занятию. */
  const FOLD_EP = ['Ключевое', 'Разногласия и позиции', 'Истории в картотеке', 'Открытые темы'];
  /* На портретах не сворачиваем ничего: раздел портрета теперь сам по себе
     страница, и прятать её содержимое под «Показать целиком» бессмысленно —
     человек уже кликнул именно в этот раздел. Складными остались только
     длинные блоки страницы занятия, где всё лежит на одном листе. */
  function foldNames() {
    const p = relPath();
    return /\/занятия\/\d/.test(p) ? FOLD_EP : null;
  }
  function setFold(body, closed) {
    body.classList.toggle('fold-closed', closed);
    const a = body.nextElementSibling.querySelector('a');
    a.textContent = closed ? 'Показать целиком' : 'Свернуть';
  }
  /* Главная: во всю ширину и с акцентом на «Актуальном».

     Оба — работа по готовому DOM, а не по разметке страницы: «Актуальное»
     приходит из разбора обычным markdown (ссылки на занятия и людей), и
     завернуть его в <div> в исходнике нельзя — markdown внутри html не
     разбирается. Поэтому заголовок и всё до следующего h2 переносим в панель
     здесь, тем же приёмом, что и складные разделы занятия. */
  function homeLayout() {
    if (relPath() !== '/') return;
    document.body.classList.add('tr21-home');
    const content = document.querySelector('.md-content__inner');
    if (!content || content.querySelector('.home-live')) return;
    /* «Актуальное» и «Открытые темы» — то, ради чего сюда заходят между
       занятиями. Ставим их рядом в две колонки: на широком экране один
       длинный столбец текста во всю ширину читать неудобно. */
    const wrap = (h2, cls) => {
      const box = document.createElement('div');
      box.className = cls;
      h2.parentNode.insertBefore(box, h2);
      let n = h2;
      while (n && !(n !== h2 && n.nodeType === 1 && n.tagName === 'H2')) {
        const next = n.nextSibling;
        box.appendChild(n);
        n = next;
      }
      return box;
    };
    let hot = null, open = null;
    content.querySelectorAll('h2').forEach(h => {
      if (!hot && h.textContent.indexOf('Актуальное') >= 0) hot = wrap(h, 'home-hot');
      else if (!open && h.textContent.indexOf('Открытые темы') >= 0) open = wrap(h, 'home-open');
    });
    if (!hot) return;
    const live = document.createElement('div');
    live.className = 'home-live';
    hot.parentNode.insertBefore(live, hot);
    live.appendChild(hot);
    if (open) live.appendChild(open);
  }

  function episodeFolds() {
    const names = foldNames();
    if (!names) return;
    document.querySelectorAll('.md-content h2').forEach(h => {
      const name = h.textContent.replace(/§/g, '').trim();
      if (!names.some(nm => name.indexOf(nm) === 0)) return;
      /* обёртка тела — один раз; решение о сворачивании — отдельно ниже */
      let body = h.nextElementSibling;
      if (!(body && body.classList && body.classList.contains('fold-body'))) {
        body = document.createElement('div');
        body.className = 'fold-body';
        let n = h.nextSibling;
        while (n && !(n.nodeType === 1 && n.tagName === 'H2')) {
          const next = n.nextSibling;
          body.appendChild(n);
          n = next;
        }
        h.parentNode.insertBefore(body, h.nextSibling);
      }
      if (h.dataset.fold) return;
      /* на зашифрованном сайте плагин сперва вставляет контент и лишь потом
         снимает display:none — у скрытого блока scrollHeight нулевой, и
         решение «сворачивать ли» принимать рано; дождёмся следующего вызова
         (encryptcontent_event стреляет после показа контента) */
      if (!body.scrollHeight && !body.clientHeight) return;
      h.dataset.fold = '1';
      /* раздел, который и так помещается в анонс, складывать нечего */
      if (body.scrollHeight < 280) return;
      const more = document.createElement('p');
      more.className = 'fold-more';
      more.innerHTML = '<a href="javascript:void(0)"></a>';
      body.parentNode.insertBefore(more, body.nextSibling);
      more.querySelector('a').addEventListener('click', () => {
        const closed = !body.classList.contains('fold-closed');
        setFold(body, closed);
        /* после «Свернуть» длинного блока заголовок мог уехать за экран */
        if (closed && h.getBoundingClientRect().top < 0) h.scrollIntoView();
      });
      setFold(body, true);
    });
    unfoldByHash();
  }
  /* плагин шифрования стреляет этим событием, когда контент расшифрован и
     показан, — к этому моменту высоты уже измеримы */
  window.addEventListener('encryptcontent_event', episodeFolds);
  function unfoldByHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    let body = null;
    if (el.dataset && el.dataset.fold) body = el.nextElementSibling;
    else if (el.closest) body = el.closest('.fold-body');
    if (body && body.classList.contains('fold-closed')) {
      setFold(body, false);
      /* свёрнутый блок не имел высоты — прокрутка промахнулась, доехать */
      setTimeout(() => el.scrollIntoView(), 0);
    }
  }
  window.addEventListener('hashchange', unfoldByHash);

  /* на страницах людей page.title — нейтральный слаг (имя не должно попасть в
     статичный html); после расшифровки подставляем имя из h1 в хедер и заголовок вкладки */
  function personTopic() {
    const path = relPath();
    if (!path.startsWith('/люди/') && !/^\/вопросы\/\d{4}-\d\d-\d\d-/.test(path)) return;
    const h1 = document.querySelector('.md-content h1');
    if (!h1) return;
    const name = h1.textContent.replace(/§/g, '').trim();
    if (!name) return;
    const topics = document.querySelectorAll('.md-header__topic .md-ellipsis');
    const t = topics[topics.length - 1];
    if (t && topics.length > 1 && t.textContent.trim() !== name) t.textContent = name;
    const title = name + ' — Тренинг 21+';
    if (document.title !== title) document.title = title;
  }

  /* страницы вопросов не входят в nav mkdocs — раскрываем штатный раздел
     «Вопросы» и подсвечиваем год текущего вопроса */
  /* ── меню одним файлом ────────────────────────────────────────────────
     В каждой странице сайта лежит только верхний уровень меню с одним
     подпунктом-обложкой: полный список из 157 пунктов давал 60 КБ шифрованной
     навигации в КАЖДОЙ из 4234 страниц — 283 МБ, 70% веса сайта. Остальное
     лежит одним зашифрованным файлом (страница «меню») и подкладывается сюда:
     браузер тянет его один раз за сессию, дальше — из sessionStorage.
     Расшифровка — тем же ключом из sessionStorage, что и индекс поиска. */
  /* Меню НЕ кешируем в sessionStorage. Так было — и браузер, у которого лежала
     копия от прошлой версии сайта, продолжал ею пользоваться после обновления:
     адреса, уже содержавшие базу, получали её второй раз, выходило
     /w/<хеш>/w/<хеш>/динамика/. Выигрыш от кеша был копеечный (файл меню и так
     кешируется браузером, расшифровка — миллисекунды), а риск устаревания
     касался любой правки формата или состава меню. Держим только промис на
     время жизни страницы, чтобы не тянуть файл дважды. */
  let menuPromise = null;

  async function fetchMenu() {
    let html;
    try { html = await fetch('/w/5b1c4a39/меню/').then(r => r.text()); } catch (e) { return null; }
    const m = html.match(/id="mkdocs-encrypted-content"[^>]*>([^<]+)</);
    if (!m) return null;
    const keys = sessionKeys();
    for (const kid in keys) {
      const plain = await decryptBundle(keys[kid], m[1].trim());
      if (!plain) continue;
      const box = document.createElement('div');
      box.innerHTML = plain;
      const data = box.querySelector('#nav-data');
      if (!data) return null;
      return JSON.parse(data.textContent);
    }
    return null;
  }
  function loadMenu() {
    if (!menuPromise) menuPromise = fetchMenu().catch(() => null);
    return menuPromise;
  }

  function herePath() {
    return relPath().replace(/\/$/, '');
  }
  function menuHasHere(item, here) {
    if (item.url) return item.url.replace(/\/$/, '') === here;
    return (item.items || []).some(sub => menuHasHere(sub, here));
  }
  /* пункт меню родной разметкой Material: лист — ссылка, группа — вложенная
     панель с чекбоксом-раскрывашкой (открыта, если текущая страница внутри) */
  function menuItem(item, level, id, here) {
    if (!item.items) {
      const url = item.url.replace(/\/$/, '');
      return '<li class="md-nav__item menu-li"><a class="md-nav__link'
        + (url === here ? ' md-nav__link--active' : '')
        + '" href="' + BASE + encodeURI(item.url) + '"><span class="md-ellipsis">'
        + esc(item.title) + '</span></a></li>';
    }
    const open = menuHasHere(item, here);
    return '<li class="md-nav__item md-nav__item--nested menu-li">'
      + '<input class="md-nav__toggle md-toggle" type="checkbox" id="' + id + '"'
      + (open ? ' checked' : '') + '>'
      + '<label class="md-nav__link" for="' + id + '">'
      +   '<span class="md-ellipsis">' + esc(item.title) + '</span>'
      +   '<span class="md-nav__icon md-icon"></span></label>'
      + '<nav class="md-nav" data-md-level="' + level + '" aria-label="' + esc(item.title) + '">'
      +   '<label class="md-nav__title" for="' + id + '">'
      +     '<span class="md-nav__icon md-icon"></span>' + esc(item.title) + '</label>'
      +   '<ul class="md-nav__list">'
      +     item.items.map((sub, i) => menuItem(sub, level + 1, id + '_' + i, here)).join('')
      +   '</ul></nav></li>';
  }

  /* сама раскладка вынесена из загрузки — её и проверяют тесты */
  function applyMenu(nav, menu, here) {
    menu.forEach((sec, si) => {
      if (!sec.items) return;
      const li = topItem(nav, plainLabel(sec.title));
      if (!li) return;
      const list = li.querySelector('.md-nav__list');
      /* плагин при расшифровке пересоздаёт nav — метку ищем внутри списка,
         иначе после пересоздания пункты не вернулись бы */
      if (!list || list.querySelector('.menu-li')) return;
      /* Первый пункт раздела уже есть в самой странице — это его обложка;
         остальные вставляем СРАЗУ ЗА НЕЙ, а не в конец списка. Меню грузится
         асинхронно, и синхронные доводчики (список людей, занятия года)
         успевают вставить своё раньше — в конце «Динамика» и «Дни рождения»
         оказывались после всех людей. */
      /* Уровень 2, а не 1: панель с data-md-level="1" тема показывает ВСЕГДА
         («содержимое текущей вкладки»), и галочка на неё не действует — группы
         теории оказывались вечно раскрытыми и не сворачивались. Сворачиваемые
         панели у Material начинаются с уровня 2. */
      const html = sec.items.slice(1)
        .map((it, i) => menuItem(it, 2, '__nav_m' + si + '_' + i, here)).join('');
      if (list.children && list.children.length) {
        list.children[0].insertAdjacentHTML('afterend', html);
      } else {
        list.insertAdjacentHTML('beforeend', html);
      }
      if (menuHasHere(sec, here)) activate(li);
    });
  }

  async function menuSidebarAsync() {
    const nav = navRoot();
    if (!nav) return;
    const menu = await loadMenu();
    if (menu) applyMenu(nav, menu, herePath());
  }
  function menuSidebar() {
    menuSidebarAsync().catch(e => console.warn('tr21: сбой в menuSidebar', e));
  }

  function questionsSidebar() {
    if (!document.querySelector('.qyears')) return;
    const nav = navRoot();
    if (!nav) return;
    const li = topItem(nav, 'Вопросы');
    if (!li || li.dataset.aug) return;
    li.dataset.aug = '1';
    activate(li);
    const year = yearOf(relPath());
    if (!year) return;
    const links = li.querySelectorAll('a.md-nav__link');
    for (const a of links) {
      if (a.textContent.trim() === year) { a.classList.add('md-nav__link--active'); break; }
    }
  }

  /* страницы историй тоже вне nav mkdocs (их сотни) — раскрываем штатный
     раздел «Картотека»: рубрики в его панели уже есть */
  function storiesSidebar() {
    if (!document.querySelector('.cnav')) return;
    const nav = navRoot();
    if (!nav) return;
    const li = topItem(nav, 'Картотека');
    if (!li || li.dataset.aug) return;
    li.dataset.aug = '1';
    activate(li);
  }

  /* страницы занятий тоже вне nav mkdocs (их больше двух сотен) — раскрываем
     штатный раздел «Занятия», помечаем год активным и подкладываем под него
     занятия этого года: список лежит в скрытом .ep-siblings самой страницы */
  function episodesSidebar() {
    const box = document.querySelector('.ep-siblings');
    const nav = navRoot();
    if (!box || !nav) return;
    const li = topItem(nav, 'Занятия');
    if (!li || li.querySelector('.ep-li')) return;
    activate(li);
    const year = box.dataset.year || '';
    const here = relPath().replace(/\/$/, '');
    let items = '';
    box.querySelectorAll('a').forEach(a => {
      /* адрес берётся из готовой разметки, где база УЖЕ проставлена
         генератором (_rebase), — второй раз её добавлять нельзя, иначе
         выходит /w/<хеш>/w/<хеш>/занятия/225/. Для сравнения с текущим
         путём базу, наоборот, снимаем: here её не содержит. */
      const full = a.getAttribute('href').replace(/\/$/, '');
      const rel = BASE && full.indexOf(BASE) === 0 ? full.slice(BASE.length) : full;
      items += '<li class="md-nav__item ep-li"><a class="md-nav__link'
        + (here === rel ? ' md-nav__link--active' : '')
        + '" href="' + full + '/"><span class="md-ellipsis">'
        + a.textContent + '</span></a></li>';
    });
    if (!items) return;
    for (const a of li.querySelectorAll('a.md-nav__link')) {
      const t = a.querySelector('.md-ellipsis');
      if (!t || t.textContent.trim() !== year) continue;
      a.classList.add('md-nav__link--active');
      a.insertAdjacentHTML('afterend',
        '<ul class="drawer-toc">' + items + '</ul>');
      break;
    }
  }

  /* Ссылка с якорем (#31-мая--юра, #y2024, любая) на зашифрованном сайте
     сама по себе не работает: браузер прыгает к якорю сразу после загрузки,
     когда контента ещё нет — он появляется только после расшифровки. Плагин
     это знает и делает потом `location.href = location.hash`, но хэш в адресе
     уже стоит, и присвоение того же значения — не переход: Safari (в том
     числе на iOS) остаётся наверху страницы. Поэтому доводим скролл сами.
     Обработчик крутится на каждом тике наблюдателя, отсюда отметка hjumped:
     доехали один раз — больше не мешаем человеку листать. */
  function hashScroll() {
    const raw = location.hash || '';
    if (!raw || document.body.dataset.hjumped === raw) return;
    let id = raw.slice(1);
    try { id = decodeURIComponent(id); } catch (e) { /* кривой процент-код */ }
    const el = document.getElementById(id) || document.getElementById(raw.slice(1));
    if (!el) return;            /* ещё не расшифровано — вернёмся следующим тиком */
    document.body.dataset.hjumped = raw;
    requestAnimationFrame(() => el.scrollIntoView({block: 'start'}));
  }

  /* тире в пунктах «№N — дата» делаем блеклым (nav не принимает html — правим DOM) */
  function dimNavDashes() {
    document.querySelectorAll('.md-nav__link .md-ellipsis').forEach(el => {
      if (el.dataset.dimmed || !/№\d+ — /.test(el.textContent)) return;
      el.dataset.dimmed = '1';
      el.innerHTML = el.innerHTML.replace(/ — /, ' <span class="nav-dim">—</span> ');
    });
  }

  /* лупа в шапке — ссылка на страницу поиска (штатное поле скрыто) */
  function headerButton() {
    const inner = document.querySelector('.md-header__inner');
    const had = document.getElementById('gs-header-btn');
    /* на незалогиненной странице кнопки не нужны; признак тот же, что в
       group-fav.js (файлы грузятся порознь, общей функции нет): пока на
       странице есть форма входа — не вошли. Контейнер расшифровки для этого
       не годится: форма лежит ВНУТРИ него, и он показан с самого начала. */
    const open = !document.getElementById('mkdocs-decrypt-form');
    if (!open) { if (had) had.remove(); return; }
    if (!inner || had) return;
    const a = document.createElement('a');
    a.id = 'gs-header-btn';
    a.href = '/w/5b1c4a39/поиск/';
    a.className = 'md-header__button md-icon';
    a.title = 'Поиск';
    a.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg>';
    const opt = inner.querySelector('.md-header__option, .md-header__source');
    inner.insertBefore(a, opt || null);
  }

  /* Material определяет, показывать ли в шапке название страницы, по положению
     <h1>: элемент он находит один раз при старте и запоминает его координаты.
     На этом сайте контент подставляется ПОСЛЕ расшифровки, а до неё внутри
     <article> лежит только пустой <h1> формы пароля — Material цепляется за него,
     тот исчезает вместе с формой, и дальше расчёт идёт по «мёртвому» элементу:
     заголовок залипает на названии страницы и не возвращается к названию сайта.
     Поэтому считаем сами — по живому <h1> и текущей высоте шапки. */
  /* Кто смотрит эту сборку — подписью в шапке, слева от кнопок.

     Текст приходит из скрытого .wiki-who: его вкладывает в каждую страницу
     search_hooks, то есть он лежит внутри шифра. Брать имя из адреса или из
     js нельзя — в открытой части сайта имён участников быть не должно. */
  /* Почему кнопка «Войти» может не работать молча.

     Расшифровка идёт через window.crypto.subtle, а он существует только в
     защищённом контексте: по http (не https) или на старом браузере его нет
     вовсе. Плагин вызывает crypto.subtle.importKey вне try/catch — промис
     тихо падает, и на экране НИЧЕГО не происходит: ни ошибки, ни «неверного
     пароля». Пишем причину прямо в форму, иначе это неотличимо от «сайт
     сломался». */
  function loginDiag() {
    const form = document.getElementById('mkdocs-decrypt-form');
    if (!form) return;
    const msg = document.getElementById('mkdocs-decrypt-msg');
    if (!msg || msg.dataset.diag) return;
    const subtle = window.crypto && window.crypto.subtle;
    if (subtle) return;
    msg.dataset.diag = '1';
    msg.style.color = 'var(--md-typeset-color)';
    msg.innerHTML = 'Расшифровка недоступна в этом окне браузера: нет '
      + '<code>crypto.subtle</code>.<br>'
      + 'Адрес открыт как <b>' + location.protocol + '//' + location.host + '</b>'
      + (location.protocol === 'https:' ? '' : ' — нужен <b>https://</b>')
      + '. Защищённый контекст: <b>'
      + (window.isSecureContext ? 'да' : 'нет') + '</b>.';
  }

  function headerWho() {
    const inner = document.querySelector('.md-header__inner');
    const had = document.getElementById('gs-header-who');
    const src = document.querySelector('.wiki-who');
    const who = src ? src.textContent.trim() : '';
    if (!who) { if (had) had.remove(); return; }
    if (!inner) return;
    /* ВАЖНО: текст переписываем, только если он изменился. Присваивание
       textContent пересоздаёт текстовый узел, а это правка childList — её
       ловит наш же MutationObserver, снова зовёт все доводчики, и страница
       уходит в бесконечный круг: вкладка виснет молча, без ошибок в консоли. */
    if (had) { if (had.textContent !== who) had.textContent = who; return; }
    const el = document.createElement('span');
    el.id = 'gs-header-who';
    el.className = 'md-header__who';
    el.title = who === 'Полная' ? 'Полная сборка — все занятия'
                                : 'Ваша сборка: занятия вашего периода участия';
    el.textContent = who;
    const btn = document.getElementById('gs-header-btn');
    inner.insertBefore(el, btn || inner.querySelector('.md-header__option') || null);
  }

  /* Версия сайта и кто вошёл.

     На десктопе версия стоит в подвале справа, имя — в шапке. На телефоне
     шапке места нет, а подвал лежит под всей страницей, поэтому и то и другое
     уезжает вниз выдвижного меню — что показывать, решает css.

     Обе вставки обязаны быть идемпотентны: доводчики вызываются на каждую
     правку DOM, и запись в DOM при каждом вызове разбудила бы наблюдатель
     заново (так вкладка уже виснула на подписи в шапке). Поэтому пишем,
     только когда текст изменился. */
  const VER = (typeof window !== 'undefined' && window.TR21_VERSION) || '';
  function whoText() {
    const el = document.querySelector('.wiki-who');
    return el ? el.textContent.trim() : '';
  }

  /* Вкладки на «Истории». Обработчик вешается ОДИН раз (dataset.bound):
     доводчики зовутся на каждую правку DOM, и переподписка плодила бы
     обработчики, а переключение класса — правку DOM, то есть новый круг. */
  /* Страницы истории в nav mkdocs не входят (их десятки) — раскрываем
     штатный пункт «История» списком дат из скрытого .hist-nav. Тот же приём,
     что у занятий: адрес берём из разметки, где база уже проставлена. */
  /* «показать все (N)»: раскрывает остаток списка и убирает саму себя.
     Обработчик вешается ОДИН раз — доводчики зовутся на каждую правку DOM. */
  function historyShowAll() {
    document.querySelectorAll('.hist-showall').forEach(b => {
      if (b.dataset.bound) return;
      b.dataset.bound = '1';
      b.addEventListener('click', () => {
        const rest = b.parentNode.querySelector('.hist-rest');
        if (rest) rest.hidden = false;
        b.remove();
      });
    });
  }

  /* Куда класть свои блоки в выдвижном меню.

     Не соседом списка: .md-nav--primary — флекс-колонка высотой 100%, где
     .md-nav__list растянут (flex:1). Любой div рядом со списком забирает
     высоту себе, список сжимается до нуля, и меню исчезает вместе с
     прокруткой — ровно это и случилось с оглавлением на 110 пунктов.

     Кладём в тот список, который СЕЙЧАС на экране: у Material панели меню
     вложенные, и на странице занятия открыт не верхний список, а панель
     «Все занятия». Всё, что попало в верхний, там просто не видно.

     ВАЖНО: пока навигация не расшифрована, в ней лежит строка
     «iv;шифротекст» — дописанный узел ломает расшифровку, и на телефоне
     сайдбар открывается пустым. Ждём настоящий список. */
  function drawerList() {
    const nav = document.querySelector('.md-nav--primary');
    if (!nav) return null;
    const list = nav.querySelector('.md-nav__list');
    if (!list) return null;
    return nav.querySelector('.md-nav__item--active .md-nav__list') || list;
  }

  /* в список кладут пункты, в пункт — что угодно */
  function drawerPut(host, el) {
    if (host.tagName !== 'UL') { host.appendChild(el); return; }
    /* обёртку метим: узнавать её по тегу родителя нельзя — у активного
       пункта родитель сам <li>, и блок принимал бы за обёртку хозяина,
       переставляя себя на каждом проходе наблюдателя (страница замирала) */
    let li = el.parentNode;
    if (!li || li.dataset.navWrap !== '1') {
      li = document.createElement('li');
      li.className = 'md-nav__item';
      li.dataset.navWrap = '1';
      li.appendChild(el);
    }
    host.appendChild(li);
  }

  function historySidebar() {
    const box = document.querySelector('.hist-nav');
    const nav = navRoot();
    if (!box || !nav) return;
    const li = topItem(nav, 'История');
    if (!li || li.querySelector('.hist-li')) return;
    activate(li);
    const here = relPath().replace(/\/$/, '');
    let items = '';
    box.querySelectorAll('a').forEach(a => {
      const full = a.getAttribute('href').replace(/\/$/, '');
      const rel = BASE && full.indexOf(BASE) === 0 ? full.slice(BASE.length) : full;
      items += '<li class="md-nav__item hist-li"><a class="md-nav__link'
        + (here === rel ? ' md-nav__link--active' : '')
        + '" href="' + full + '/"><span class="md-ellipsis">'
        + a.textContent + '</span></a></li>';
    });
    if (!items) return;
    const link = li.querySelector('a.md-nav__link');
    if (link) link.insertAdjacentHTML('afterend',
      '<ul class="drawer-toc">' + items + '</ul>');
  }

  /* Фильтр по авторам на «Юморе» и «Притчах»: клик по имени оставляет только
     его записи, «Все» возвращает список. Год без единой видимой записи прячем
     заодно — иначе остаются пустые заголовки. */
  function digestFilter() {
    const box = document.querySelector('.dg-filter');
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.addEventListener('click', e => {
      const b = e.target.closest('.dg-who');
      if (!b) return;
      const who = b.dataset.who || '';
      box.querySelectorAll('.dg-who').forEach(
        x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.dg-item').forEach(li => {
        li.hidden = !!who && li.dataset.who !== who;
      });
      document.querySelectorAll('.md-content ul.dg-list').forEach(ul => {
        const any = [...ul.querySelectorAll('.dg-item')].some(li => !li.hidden);
        ul.hidden = !any;
        /* заголовок года стоит прямо перед списком */
        const h = ul.previousElementSibling;
        if (h && /^H[23]$/.test(h.tagName)) h.hidden = !any;
      });
    });
  }

  function historyTabs() {
    const tabs = document.querySelectorAll('.hist-tab');
    if (!tabs.length) return;
    tabs.forEach(t => {
      if (t.dataset.bound) return;
      t.dataset.bound = '1';
      t.addEventListener('click', () => {
        const want = t.dataset.tab;
        document.querySelectorAll('.hist-tab').forEach(
          b => b.classList.toggle('on', b.dataset.tab === want));
        document.querySelectorAll('.hist-pane').forEach(
          p => { p.hidden = p.dataset.pane !== want; });
      });
    });
  }

  function siteVersion() {
    if (!VER) return;
    const meta = document.querySelector('.md-footer-meta__inner');
    if (meta) {
      let el = document.getElementById('tr21-ver');
      if (!el) {
        el = document.createElement('span');
        el.id = 'tr21-ver';
        el.className = 'tr21-ver';
        el.title = 'Версия сайта: дата выкладки и её номер за день';
        meta.appendChild(el);
      }
      if (el.textContent !== VER) el.textContent = VER;
    }
    /* Подвал выдвижного меню: тот же номер и имя вошедшего.

       ВАЖНО: до расшифровки в .md-nav--primary лежит НЕ разметка, а строка
       «iv;шифротекст». Плагин берёт её из innerHTML целиком, поэтому любой
       дописанный туда узел ломает расшифровку: строка перестаёт делиться на
       две части, навигация остаётся скрытой — и на телефоне выдвижной сайдбар
       открывается пустым. Ждём, пока в навигации появится настоящий список. */
    const nav = drawerList();
    if (!nav) return;
    const who = whoText();
    let box = document.getElementById('tr21-navfoot');
    if (!box) {
      box = document.createElement('div');
      box.id = 'tr21-navfoot';
      box.className = 'tr21-navfoot';
      box.innerHTML = '<span class="tr21-navfoot__who"></span>'
                    + '<span class="tr21-navfoot__ver"></span>';
      drawerPut(nav, box);
    } else {
      /* после расшифровки плагин подменяет саму навигацию — переносим блок
         в новую, иначе он остаётся в выброшенной и на экране его нет.
         И держим его последним: оглавление страницы дорисовывается позже,
         а подпись сборки должна оставаться внизу. */
      const own = box.parentNode && box.parentNode.dataset
               && box.parentNode.dataset.navWrap === '1' ? box.parentNode : box;
      if (own.parentNode !== nav || nav.lastElementChild !== own) drawerPut(nav, box);
    }
    const w = box.querySelector('.tr21-navfoot__who');
    /* дальше — только текст: обёртку и место больше не трогаем */
    const v = box.querySelector('.tr21-navfoot__ver');
    if (w.textContent !== who) w.textContent = who;
    if (v.textContent !== VER) v.textContent = VER;
  }

  function headerTitleSync() {
    const title = document.querySelector('[data-md-component="header-title"]');
    if (!title || title._sync) return;
    title._sync = true;
    let queued = false;
    function upd() {
      queued = false;
      const h1 = document.querySelector('.md-content h1');
      const hdr = document.querySelector('.md-header');
      if (!h1 || !hdr) return;
      /* активно, когда заголовок страницы полностью ушёл под шапку */
      const active = h1.getBoundingClientRect().bottom
                   <= hdr.getBoundingClientRect().bottom;
      title.classList.toggle('md-header__title--active', active);
    }
    function schedule() { if (!queued) { queued = true; requestAnimationFrame(upd); } }
    addEventListener('scroll', schedule, {passive: true});
    addEventListener('resize', schedule, {passive: true});
    window.addEventListener('encryptcontent_event', schedule);
    upd();
  }

  /* поле появляется только после расшифровки страницы */
  window.addEventListener('encryptcontent_event', bind);
  /* Каждый доводчик — сам по себе. Раньше они шли одной цепочкой, и исключение
     в любом из них молча отменяло все следующие: страница выглядела «через раз
     сломанной» — то без содержания, то без складных разделов, — и в консоли была
     одна ошибка вместо понятного места отказа. */
  /* siteVersion идёт ПОСЛЕДНИМ: он держит подпись сборки последним пунктом
     меню, а «Историю», «Избранное» и оглавление страницы дописывают соседние
     доводчики — отработай он раньше, подпись оказалась бы посреди списка. */
  const HANDLERS = [headerButton, loginDiag, headerWho, historyTabs, historySidebar, historyShowAll, digestFilter, menuSidebar, bind, matrixSticky, dimNavDashes, personsSidebar, questionsSidebar,
                    storiesSidebar, episodesSidebar, hashScroll, personTopic,
                    buildToc, tocClose, episodeFolds, homeLayout, headerTitleSync, siteVersion];
  const tick = () => HANDLERS.forEach(fn => {
    try { fn(); } catch (e) { console.warn('tr21: сбой в ' + (fn.name || '?'), e); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    try { headerButton(); } catch (e) { console.warn('tr21: сбой в headerButton', e); }
    tick();
    new MutationObserver(tick).observe(document.body, {childList: true, subtree: true});
  });
})();

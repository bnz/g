
/* Избранное. Хранится только на устройстве пользователя: localStorage, ключ tr21:favs.
   Формат записи: {u: путь, t: заголовок, s: раздел, ts: когда добавлено}.
   Заголовок сохраняем в момент добавления — страницы зашифрованы, и достать его
   потом, не открыв страницу, нельзя.

   Порядок внутри раздела берём из js/fav-order.json — списка всех адресов в том
   порядке, в каком они идут по структуре сайта (из URL его не вывести: страницы
   теории идут по SECTIONS, термины глоссария — по алфавиту русских названий). */
(function () {
  const KEY = 'tr21:favs';
  /* Запись: {u, t, s, ts} — адрес, заголовок, раздел, когда добавлено.
     Комментарий необязателен и лежит в тех же полях, добавленных позже:
       c  — текст, ca — когда создан, cu — когда обновлён.
     Старые записи без этих полей читаются как есть — формат расширяется,
     а не меняется. */
  const TAG_RE = /#([\wА-Яа-яЁё][\wА-Яа-яЁё-]*)/g;
  const SECT = {
    'занятия':   'Занятия',
    'вопросы':   'Вопросы',
    'истории':   'Истории',
    'теория':    'Теория',
    'глоссарий': 'Глоссарий',
  };
  let order = null;

  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
    window.dispatchEvent(new CustomEvent('tr21_favs_changed'));
  }
  function has(u) { return load().some(f => f.u === u); }
  function add(u, t, s) {
    const list = load();
    if (list.some(f => f.u === u)) return;
    list.push({u: u, t: t, s: s, ts: Date.now()});
    save(list);
  }
  function del(u) { save(load().filter(f => f.u !== u)); }

  function comment(u) { const f = load().find(x => x.u === u); return (f && f.c) || ''; }

  /* даты ведём сами: ca ставится один раз, cu — при каждом изменении */
  function setComment(u, text) {
    const list = load();
    const f = list.find(x => x.u === u);
    if (!f) return;
    const body = (text || '').trim();
    const now = Date.now();
    if (!body) { delete f.c; delete f.ca; delete f.cu; }
    else { if (!f.ca) f.ca = now; f.c = body; f.cu = now; }
    save(list);
  }

  function tagsOf(text) {
    const out = [];
    (String(text || '').match(TAG_RE) || []).forEach(t => {
      const v = t.slice(1);
      if (out.indexOf(v) < 0) out.push(v);
    });
    return out;
  }

  /* {тег: сколько записей} по всем комментариям */
  function allTags(list) {
    const cnt = {};
    list.forEach(f => tagsOf(f.c).forEach(t => { cnt[t] = (cnt[t] || 0) + 1; }));
    return cnt;
  }

  /* в показе комментария хештеги становятся бейджами */
  function commentHtml(text) {
    return esc(text).replace(TAG_RE, (m, t) => '<span class="fav-tag">#' + t + '</span>')
                    .replace(/\n/g, '<br>');
  }
  function toggle(u, t, s) { has(u) ? del(u) : add(u, t, s); return has(u); }

  /* тот же FNV-1a, что в wiki_group.py: индекс порядка отдан хешами, чтобы
     незашифрованный файл не раскрывал якоря глоссария (среди них есть личные) */
  function fnv1a(str) {
    const b = new TextEncoder().encode(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i++) {
      h ^= b[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  async function loadOrder() {
    if (order) return order;
    try {
      const arr = await fetch('/w/61677d08/js/fav-order.json').then(r => r.json());
      order = new Map(arr.map((h, i) => [h, i]));
    } catch (e) { order = new Map(); }
    return order;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
  function here() { return decodeURIComponent(location.pathname); }

  /* какой раздел у адреса; null — этот адрес в избранное не кладётся */
  function sectionOf(path) {
    const m = decodeURIComponent(path).match(/^\/([^\/]+)\//);
    if (!m) return null;
    const s = m[1];
    if (s === 'теория') return decodeURIComponent(path).indexOf('/теория/глоссарий') === 0 ? null : 'теория';
    return SECT[s] && s !== 'глоссарий' ? s : null;
  }

  /* ── звёздочка ──────────────────────────────────────────────────────── */
  function starEl(u, t, s) {
    const b = document.createElement('button');
    b.className = 'fav-star';
    b.type = 'button';
    const sync = () => {
      const on = has(u);
      b.classList.toggle('fav-star--on', on);
      b.title = on ? 'Убрать из избранного' : 'В избранное';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? '★' : '☆';
    };
    b.addEventListener('click', e => { e.preventDefault(); toggle(u, t, s); sync(); });
    window.addEventListener('tr21_favs_changed', sync);
    sync();
    return b;
  }

  /* Кнопка комментария рядом со звездой: видна только когда звезда стоит.
     Есть комментарий — «изменить» и точка-индикатор, нет — «добавить».
     Оба состояния приглушённые, цветом не выделяются. */
  function noteEl(u, host) {
    const b = document.createElement('button');
    b.className = 'fav-note';
    b.type = 'button';
    const sync = () => {
      const starred = has(u);
      const c = comment(u);
      b.style.display = starred ? '' : 'none';
      b.classList.toggle('fav-note--on', !!c);
      b.title = c ? 'Изменить комментарий' : 'Добавить комментарий';
      b.innerHTML = c ? '✎<span class="fav-note__dot"></span>' : '✎';
    };
    b.addEventListener('click', e => { e.preventDefault(); openEditor(u, host, sync); });
    window.addEventListener('tr21_favs_changed', sync);
    sync();
    return b;
  }

  /* редактор — простая панель под заголовком, без модалок */
  function openEditor(u, host, done) {
    if (!host) return;
    /* форма вставляется СОСЕДОМ к host, поэтому искать её внутри host бесполезно
       (так и появлялись копии от повторных кликов). Держим одну на документ:
       клик по тому же карандашу закрывает, по другому — переносит форму. */
    const old = document.querySelector('.fav-editor');
    if (old) {
      const same = old.dataset.u === u;
      if (old.__done) old.__done();
      old.remove();
      if (same) return;
    }
    const box = document.createElement('div');
    box.className = 'fav-editor';
    box.dataset.u = u;
    box.__done = done;
    const ta = document.createElement('textarea');
    ta.value = comment(u);
    ta.rows = 3;
    ta.placeholder = 'Комментарий. Хештеги (#важное) станут разделами в избранном.';
    const bar = document.createElement('div');
    bar.className = 'fav-editor__bar';
    const mk = (label, cls, fn) => {
      const x = document.createElement('button');
      x.type = 'button'; x.textContent = label; x.className = cls;
      x.addEventListener('click', fn);
      return x;
    };
    const close = () => { box.__done = null; box.remove(); if (done) done(); };
    bar.appendChild(mk('Сохранить', 'fav-editor__save',
      () => { setComment(u, ta.value); close(); }));
    bar.appendChild(mk('Отмена', 'fav-editor__cancel', close));
    if (comment(u)) bar.appendChild(mk('Удалить', 'fav-editor__del',
      () => { setComment(u, ''); close(); }));
    box.appendChild(ta); box.appendChild(bar);
    host.parentNode.insertBefore(box, host.nextSibling);
    ta.focus();
  }

  /* звезда у заголовка страницы (занятия, вопросы, истории, теория) */
  function pageStar() {
    const s = sectionOf(location.pathname);
    if (!s) return;
    const h1 = document.querySelector('.md-content h1');
    if (!h1 || h1.querySelector('.fav-star')) return;
    const t = h1.textContent.replace(/§\s*$/, '').trim();
    if (!t) return;
    const u = here();
    h1.appendChild(starEl(u, t, s));
    h1.appendChild(noteEl(u, h1));
  }

  /* звёзды у терминов глоссария: <a id="t-..."></a><strong>Термин</strong> */
  function glossaryStars() {
    if (here().indexOf('/теория/глоссарий') !== 0) return;
    document.querySelectorAll('.md-content a[id^="t-"]').forEach(a => {
      const p = a.parentElement;
      if (!p || p.querySelector('.fav-star')) return;
      const strong = p.querySelector('strong');
      if (!strong) return;
      const u = '/теория/глоссарий/#' + a.id;
      strong.appendChild(starEl(u, strong.textContent.trim(), 'глоссарий'));
      strong.appendChild(noteEl(u, p));
    });
  }

  /* ── пункт «Избранное» в навигации ──────────────────────────────────
     Показан всегда, даже когда ничего не отмечено: иначе о разделе не узнать,
     пока в нём что-нибудь не появится. */
  function navMark() {
    document.querySelectorAll('.md-tabs__item a, .md-nav--primary > .md-nav__list > .md-nav__item > a')
      .forEach(a => {
        /* именно a.href (абсолютный), а не getAttribute: тот отдаёт ссылку
           относительной — на «Главной» это «избранное/» без ведущего слэша, а
           на самой странице избранного вообще «.», и проверка не срабатывала */
        if (decodeURIComponent(a.href || '').indexOf('/избранное') < 0) return;
        const li = a.closest('li');
        if (!li) return;
        li.style.removeProperty('display');
        /* .md-tabs__list — флексбокс, margin-left:auto отжимает пункт вправо;
           по href в css не зацепиться, адрес там процентно-закодирован */
        li.classList.add('fav-tab');
      });
  }

  /* ── страница «Избранное» ───────────────────────────────────────────── */
  function curSection() {
    const m = location.hash.match(/^#s=(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function curTag() {
    const m = location.hash.match(/^#h=(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* Перерисовываем ТОЛЬКО когда состояние изменилось: MutationObserver следит за
     тем же body, куда мы пишем innerHTML, и без этой проверки рендер вызывает сам
     себя бесконечно — вкладка намертво зависает. Подпись держим на самом элементе:
     после расшифровки плагин заново подставляет контент, элемент создаётся новый,
     и рендер честно повторится. */
  let favsBusy = false;

  /* «Избранное › Занятия 7» при выбранном разделе, иначе просто «Избранное».
     Правим сам h1: Material и наш headerTitleSync читают именно его. */
  function pageTitle(sec, n, tag) {
    const h1 = document.querySelector('.md-content h1');
    if (!h1) return;
    /* без выбранного раздела — просто «Избранное», без звезды и счётчика;
       с разделом или тегом — крошка и число найденных */
    const num = '<span class="fav-crumb-n">' + n + '</span>';
    const crumb = t => 'Избранное<span class="fav-crumb">›</span>' + t + num;
    const want = tag ? crumb('<span class="fav-tag">#' + esc(tag) + '</span>')
               : sec ? crumb(esc(SECT[sec] || sec))
                     : 'Избранное';
    if (h1.dataset.favTitle !== want) {
      h1.dataset.favTitle = want;
      h1.innerHTML = want;
    }
  }

  async function renderFavs() {
    const box = document.getElementById('favs-body');
    if (!box) return;
    const list = load();
    const sig = JSON.stringify([list.map(f => [f.u, f.c || '']), curSection(), curTag()]);
    if (favsBusy || box.dataset.sig === sig) return;
    favsBusy = true;
    try { await renderInto(box, list, sig); } finally { favsBusy = false; }
  }

  async function renderInto(box, list, sig) {
    if (!list.length) {
      pageTitle('', 0, '');
      box.dataset.sig = sig;
      box.innerHTML = '<p>Пока пусто. Откройте занятие, вопрос, историю, страницу теории '
        + 'или термин глоссария и нажмите звёздочку рядом с заголовком.</p>';
      favsSidebar();
      return;
    }
    const ord = await loadOrder();
    const idx = u => { const i = ord.get(fnv1a(u)); return i === undefined ? 1e9 : i; };
    const sec = curSection();

    /* сводки на странице нет: разделы и счётчики показывает сайдбар */
    let html = '';

    const tag = curTag();
    const shown = tag ? list.filter(f => tagsOf(f.c).indexOf(tag) >= 0)
                : sec ? list.filter(f => f.s === sec)
                      : list.slice();
    /* общий список — в порядке добавления; раздел или тег — в порядке сайта */
    shown.sort((sec || tag) ? (a, b) => idx(a.u) - idx(b.u)
                            : (a, b) => (a.ts || 0) - (b.ts || 0));

    html += '<ul class="fav-list">';
    shown.forEach(f => {
      html += '<li class="fav-item">'
        + '<div class="fav-item__row">'
        +   '<a href="' + esc(f.u) + '">' + esc(f.t) + '</a>'
        +   '<button class="fav-edit" type="button" data-u="' + esc(f.u) + '" title="'
        +     (f.c ? 'Изменить комментарий' : 'Добавить комментарий') + '">✎</button>'
        +   '<span class="fav-list__sec">' + esc(SECT[f.s] || f.s) + '</span>'
        +   '<button class="fav-del" type="button" data-u="' + esc(f.u)
        +     '" title="Убрать">×</button>'
        + '</div>'
        + (f.c ? '<div class="fav-item__note">' + commentHtml(f.c) + '</div>' : '')
        + '</li>';
    });
    html += '</ul>';
    /* кнопка очистки — под списком и справа */
    if (!sec) html += '<p class="fav-actions">'
      + '<button type="button" id="fav-clear">Очистить избранное</button></p>';
    box.dataset.sig = sig;
    box.innerHTML = html;
    pageTitle(sec, shown.length, tag);
    box.querySelectorAll('.fav-del').forEach(b =>
      b.addEventListener('click', () => del(b.dataset.u)));
    /* карандаш в конце заголовка: форма встаёт НА МЕСТО текста комментария
       (а если комментария нет — просто под заголовком записи) */
    box.querySelectorAll('.fav-edit').forEach(b =>
      b.addEventListener('click', () => {
        const li = b.closest('li');
        const note = li.querySelector('.fav-item__note');
        const row = li.querySelector('.fav-item__row');
        if (note) note.style.display = 'none';
        openEditor(b.dataset.u, note || row,
          () => { if (note) note.style.removeProperty('display'); });
      }));
    const clr = document.getElementById('fav-clear');
    if (clr) clr.addEventListener('click', clearAll);
    favsSidebar();
  }

  /* сайдбар на странице избранного: штатный nav НЕ заменяем (в нём логотип
     и все разделы с вложенностью) — разворачиваем его плоский пункт
     «Избранное» во вложенную панель с непустыми разделами и хештегами */
  function favsSidebar() {
    if (here().indexOf('/избранное') !== 0) return;
    if (!window.gsNavRoot) return;
    const nav = window.gsNavRoot();
    if (!nav) return;
    const item = window.gsTopItem(nav, 'Избранное');
    if (!item) return;
    const list = load();
    const cnt = {};
    list.forEach(f => { cnt[f.s] = (cnt[f.s] || 0) + 1; });
    const sec = curSection();
    const tag = curTag();
    const tags = allTags(list);
    /* защита от самовызова из MutationObserver: подпись живёт на самом li —
       плагин при расшифровке пересоздаёт его, и панель честно рисуется заново */
    const sig = JSON.stringify([Object.keys(SECT).map(k => cnt[k] || 0), sec, tag,
                                list.length, tags]);
    if (item.dataset.favsig === sig) return;
    const li = (label, href, active, n) =>
      '<li class="md-nav__item"><a class="md-nav__link' + (active ? ' md-nav__link--active' : '')
      + '" href="' + href + '"><span class="md-ellipsis">' + esc(label)
      + (n ? ' <span class="fav-n">' + n + '</span>' : '') + '</span></a></li>';
    let items = li('Всё избранное', '#', !sec && !tag, list.length);
    Object.keys(SECT).forEach(k => {
      if (cnt[k]) items += li(SECT[k], '#s=' + encodeURIComponent(k), sec === k, cnt[k]);
    });
    /* хештеги из комментариев — своими пунктами, по алфавиту */
    Object.keys(tags).sort((a, b) => a.localeCompare(b, 'ru')).forEach(t => {
      items += li('#' + t, '#h=' + encodeURIComponent(t), tag === t, tags[t]);
    });
    item.dataset.favsig = sig;
    item.classList.add('md-nav__item--active', 'md-nav__item--nested');
    item.innerHTML = window.gsFavPanel(items);
    item.style.removeProperty('display');
  }

  /* ── выход ──────────────────────────────────────────────────────────
     Пароль плагин помнит в localStorage['encryptcontent_credentials'], а ключи
     расшифровки кладёт в sessionStorage. Чистим и то и другое и перезагружаем —
     дальше сайт снова попросит пароль. Избранное при выходе НЕ трогаем: это
     данные пользователя, для них отдельная кнопка. */
  function logout() {
    if (!confirm('Выйти? Сайт снова спросит пароль.\n\nИзбранное останется на месте.')) return;
    try {
      localStorage.removeItem('encryptcontent_credentials');
      sessionStorage.removeItem('encryptcontent_credentials');
      Object.keys(sessionStorage).forEach(k => {
        const v = sessionStorage.getItem(k);
        if (k.indexOf('encryptcontent') === 0 || (v && v.length === 64 && /^[0-9a-f]+$/i.test(v)))
          sessionStorage.removeItem(k);
      });
    } catch (e) {}
    location.reload();
  }

  /* до ввода пароля на странице только форма входа: показывать там «Выйти»
     и «Поиск» незачем — выходить не из чего, а искать нечем (индекс
     расшифровывается тем же ключом) */
  function unlocked() {
    /* НЕ по encryptcontent_done: плагин ставит его в true и когда расшифровать
       нечем — это «попытка закончена», а не «вошёл». Надёжный признак —
       заполнен ли контейнер расшифрованного содержимого (плагин пишет в него
       innerHTML и снимает display:none только при верном пароле). */
    const el = document.getElementById('mkdocs-decrypted-content');
    return !el || (el.style.display !== 'none' && el.innerHTML.trim() !== '');
  }

  function logoutButton() {
    const inner = document.querySelector('.md-header__inner');
    const had = document.getElementById('fav-logout-btn');
    if (!unlocked()) { if (had) had.remove(); return; }
    if (!inner || had) return;
    const b = document.createElement('button');
    b.id = 'fav-logout-btn';
    b.type = 'button';
    b.className = 'md-header__button md-icon';
    b.title = 'Выйти';
    b.setAttribute('aria-label', 'Выйти');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor"'
      + ' d="M16,17V14H9V10H16V7L21,12L16,17M14,2A2,2 0 0,1 16,4V6H14V4H5V20H14V18H16V20A2,2'
      + ' 0 0,1 14,22H5A2,2 0 0,1 3,20V4A2,2 0 0,1 5,2H14Z"/></svg>';
    b.addEventListener('click', logout);
    const opt = inner.querySelector('.md-header__option, .md-header__source');
    inner.insertBefore(b, opt || null);
  }

  /* ── очистка избранного ─────────────────────────────────────────────── */
  function clearAll() {
    const n = load().length;
    if (!n) return;
    const word = n % 10 === 1 && n % 100 !== 11 ? 'запись'
               : ([2, 3, 4].indexOf(n % 10) >= 0 && [12, 13, 14].indexOf(n % 100) < 0) ? 'записи'
               : 'записей';
    if (!confirm('Удалить всё избранное? Будет стёрто ' + n + ' ' + word
                 + '.\n\nОтменить это не получится.')) return;
    save([]);
  }

  /* favsSidebar зовём отдельно, а не только из renderInto: плагин после
     расшифровки перезаписывает innerHTML того же <nav>, наш сайдбар пропадал
     («мелькает и исчезает»), а renderFavs к тому моменту уже выходил по
     совпадению подписи и перерисовать сайдбар было некому */
  /* то же правило, что и в group-search.js: один упавший доводчик не должен
     утаскивать за собой остальные */
  function all() {
    [pageStar, glossaryStars, navMark, logoutButton, favsSidebar, renderFavs]
      .forEach(fn => {
        try { fn(); } catch (e) { console.warn('tr21: сбой в ' + (fn.name || '?'), e); }
      });
  }

  window.addEventListener('encryptcontent_event', all);
  window.addEventListener('tr21_favs_changed', () => { navMark(); renderFavs(); });
  window.addEventListener('hashchange', renderFavs);
  document.addEventListener('DOMContentLoaded', () => {
    all();
    new MutationObserver(all).observe(document.body, {childList: true, subtree: true});
  });
})();

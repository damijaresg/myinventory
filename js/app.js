/* Screens, navigation and forms. */
(function () {
  'use strict';

  var APP_VERSION = '1.0';
  var DAY = 24 * 60 * 60 * 1000;
  var BACKUP_REMINDER_DAYS = 14;

  var state = { items: [], sales: [], settings: {} };
  var ui = { query: '', filter: 'all', draft: null };

  var appEl = document.getElementById('app');
  var topEl = document.getElementById('topbar');
  var toastEl = document.getElementById('toast');

  /* ---------- Small helpers ---------- */

  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  /* Builds an element. Text always goes in as text, never as HTML. */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = true;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(n) { return moneyFmt.format(n || 0); }
  function moneyInput(n) { return n ? n.toFixed(2) : ''; }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function prettyDate(str) {
    var p = str.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  function friendlyError(err) {
    if (err && err.name === 'QuotaExceededError') {
      return 'The phone is out of storage space for this app. Remove some photos or old items and try again.';
    }
    return (err && err.message) || 'Something went wrong. Please try again.';
  }

  function fail(err) {
    console.error(err);
    alertDialog('That did not work', friendlyError(err));
  }

  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function refresh() {
    return Promise.all([DB.getItems(), DB.getSales(), DB.getSettings()]).then(function (d) {
      state.items = d[0];
      state.sales = d[1];
      state.settings = d[2];
    });
  }

  /* ---------- Dialogs ---------- */

  function openDialog(title, build) {
    var dlg = h('dialog', { class: 'dialog' });
    function close() { dlg.close(); }
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    var body = h('div', { class: 'dialog-body' }, h('h2', null, title));
    append(body, build(close));
    dlg.appendChild(body);
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  function confirmDialog(title, message, okLabel, danger) {
    return new Promise(function (resolve) {
      var answered = false;
      var dlg = openDialog(title, function (close) {
        return [
          h('p', null, message),
          h('div', { class: 'stack' },
            h('button', {
              class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button',
              onclick: function () { answered = true; close(); resolve(true); }
            }, okLabel),
            h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'))
        ];
      });
      dlg.addEventListener('close', function () { if (!answered) resolve(false); });
    });
  }

  function alertDialog(title, message) {
    openDialog(title, function (close) {
      return [h('p', null, message), h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'OK')];
    });
  }

  /* ---------- Saving files to the device ---------- */

  function saveFile(filename, blob) {
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && typeof File === 'function') {
      var file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file] }).then(function () { return true; }, function (err) {
          if (err && err.name === 'AbortError') return false;
          download(filename, blob);
          return true;
        });
      }
    }
    download(filename, blob);
    return Promise.resolve(true);
  }

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var input = h('input', { type: 'file', accept: accept, class: 'visually-hidden' });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        input.remove();
        if (f) resolve(f);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /* ---------- Layout pieces ---------- */

  function setTop(title, backHash) {
    topEl.textContent = '';
    append(topEl, [
      backHash ? h('a', { class: 'back', href: backHash }, '‹ Back') : null,
      h('h1', null, title)
    ]);
    document.title = title === 'My Inventory' ? title : title + ' – My Inventory';
  }

  function setTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      if (a.getAttribute('data-tab') === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function show(nodes) {
    appEl.textContent = '';
    append(appEl, nodes);
    window.scrollTo(0, 0);
  }

  function field(label, input, hint) {
    return h('label', { class: 'field' },
      h('span', { class: 'field-label' }, label),
      input,
      hint ? h('span', { class: 'hint' }, hint) : null);
  }

  function badges(item) {
    var st = Calc.status(item);
    var out = [];
    if (st === 'soldout') out.push(h('span', { class: 'badge badge-grey' }, 'Sold out'));
    else if (st === 'listed') out.push(h('span', { class: 'badge badge-blue' }, 'Listed'));
    else out.push(h('span', { class: 'badge badge-amber' }, 'Not listed yet'));
    if (Calc.isLow(item, state.settings.lowStock)) out.push(h('span', { class: 'badge badge-red' }, 'Low stock'));
    return out;
  }

  /* ---------- Items list ---------- */

  var FILTERS = [
    { id: 'all', label: 'All', test: function () { return true; } },
    { id: 'unlisted', label: 'Not listed yet', test: function (it) { return Calc.status(it) === 'unlisted'; } },
    { id: 'listed', label: 'Listed', test: function (it) { return Calc.status(it) === 'listed'; } },
    { id: 'low', label: 'Low stock', test: function (it) { return Calc.isLow(it, state.settings.lowStock); } },
    { id: 'soldout', label: 'Sold out', test: function (it) { return Calc.status(it) === 'soldout'; } }
  ];

  function isIosBrowserTab() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  }

  function notices() {
    var out = [];
    var s = state.settings;
    if (isIosBrowserTab() && !s.hideInstallTip) {
      out.push(h('div', { class: 'notice' },
        h('p', null, h('strong', null, 'Tip: '), 'Put this app on your Home Screen so it opens like any other app. Tap the Share button in Safari, then "Add to Home Screen".'),
        h('button', {
          class: 'btn btn-small', type: 'button',
          onclick: function () { DB.setSetting('hideInstallTip', true).then(refresh).then(route).catch(fail); }
        }, 'Got it')));
    }
    var since = s.lastBackup || s.firstUse;
    if (state.items.length && since && Date.now() - since > BACKUP_REMINDER_DAYS * DAY) {
      out.push(h('div', { class: 'notice notice-warn' },
        h('p', null, s.lastBackup
          ? 'It has been a while since your last backup.'
          : 'You have not saved a backup yet. A backup protects your list if something happens to this phone.'),
        h('a', { class: 'btn btn-small', href: '#more' }, 'Save a backup')));
    }
    return out;
  }

  function itemCard(item) {
    var sub = ['Qty ' + item.qty];
    if (item.price) sub.push(money(item.price));
    if (item.location) sub.push(item.location);
    return h('a', { class: 'card item-card', href: '#item/' + encodeURIComponent(item.id) },
      item.thumb
        ? h('img', { class: 'thumb', src: item.thumb, alt: '', loading: 'lazy' })
        : h('div', { class: 'thumb thumb-empty', 'aria-hidden': 'true' }, '📦'),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-name' }, item.name),
        h('div', { class: 'item-sub' }, sub.join(' · ')),
        h('div', { class: 'badge-row' }, badges(item))),
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'));
  }

  function viewItems() {
    setTop('My Inventory');
    setTab('items');

    if (!state.items.length) {
      show([
        notices(),
        h('div', { class: 'empty' },
          h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '📦'),
          h('h2', null, 'No items yet'),
          h('p', null, 'Add the first thing you want to sell.'),
          h('a', { class: 'btn btn-primary', href: '#add' }, 'Add an item'))
      ]);
      return;
    }

    var chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' });
    var listEl = h('div', { class: 'list' });
    var search = h('input', {
      type: 'search', class: 'search', placeholder: 'Search items', 'aria-label': 'Search items',
      value: ui.query, enterkeyhint: 'search',
      oninput: function () { ui.query = search.value; draw(); }
    });

    function draw() {
      chipsEl.textContent = '';
      FILTERS.forEach(function (f) {
        var count = state.items.filter(f.test).length;
        if (!count && f.id !== 'all' && f.id !== ui.filter) return;
        chipsEl.appendChild(h('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(ui.filter === f.id),
          onclick: function () { ui.filter = f.id; draw(); }
        }, f.label + ' (' + count + ')'));
      });

      var filter = FILTERS.filter(function (f) { return f.id === ui.filter; })[0] || FILTERS[0];
      var q = ui.query.trim().toLowerCase();
      var shown = state.items.filter(filter.test).filter(function (it) {
        if (!q) return true;
        return [it.name, it.sku, it.location, it.notes].join('\n').toLowerCase().indexOf(q) !== -1;
      });
      shown.sort(function (a, b) {
        var soldA = a.qty <= 0 ? 1 : 0, soldB = b.qty <= 0 ? 1 : 0;
        return soldA - soldB || b.createdAt - a.createdAt;
      });

      listEl.textContent = '';
      if (!shown.length) {
        listEl.appendChild(h('p', { class: 'muted center' }, 'Nothing matches. Try a different search or tap "All".'));
      } else {
        shown.forEach(function (it) { listEl.appendChild(itemCard(it)); });
      }
    }

    var inStock = state.items.filter(function (it) { return it.qty > 0; });
    var worth = inStock.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
    var summary = inStock.length + (inStock.length === 1 ? ' item' : ' items') + ' to sell' +
      (worth ? ' · ' + money(worth) + ' at asking prices' : '');

    draw();
    show([notices(), search, chipsEl, h('p', { class: 'muted summary' }, summary), listEl]);
  }

  /* ---------- Item detail ---------- */

  function row(label, value) {
    return h('div', { class: 'row' }, h('span', { class: 'row-label' }, label), h('span', { class: 'row-value' }, value));
  }

  function viewDetail(id) {
    var item = findItem(id);
    if (!item) { go('#items'); return; }
    setTop('Item', '#items');
    setTab('items');

    var gallery = h('div', { class: 'gallery' });
    DB.getPhotos(id).then(function (photos) {
      photos.forEach(function (src) { gallery.appendChild(h('img', { src: src, alt: 'Photo of ' + item.name })); });
      if (!photos.length) gallery.remove();
    }).catch(function () { gallery.remove(); });

    var listedToggle = h('input', {
      type: 'checkbox', class: 'switch', checked: item.listed,
      onchange: function () {
        item.listed = listedToggle.checked;
        item.updatedAt = Date.now();
        DB.saveItem(item).then(refresh).then(route).catch(fail);
      }
    });

    var safeLink = /^https?:\/\//i.test(item.link) ? item.link : null;

    show([
      gallery,
      h('h2', { class: 'detail-name' }, item.name),
      h('div', { class: 'badge-row' }, badges(item)),
      h('div', { class: 'card rows' },
        row('Quantity', String(item.qty)),
        row('What I paid (each)', money(item.cost)),
        row('Asking price (each)', money(item.price)),
        item.location ? row('Where it is stored', item.location) : null,
        item.sku ? row('SKU', item.sku) : null,
        item.notes ? row('Notes', item.notes) : null,
        item.link ? row('eBay link', safeLink
          ? h('a', { href: safeLink, target: '_blank', rel: 'noopener noreferrer' }, 'Open listing')
          : item.link) : null),
      item.qty > 0 ? h('label', { class: 'card switch-row' }, h('span', null, 'Listed on eBay'), listedToggle) : null,
      h('div', { class: 'stack' },
        item.qty > 0
          ? h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { sellDialog(item); } }, 'Mark as Sold')
          : h('p', { class: 'muted center' }, 'This item is sold out. Tap Edit to add more.'),
        h('a', { class: 'btn', href: '#edit/' + encodeURIComponent(item.id) }, 'Edit'),
        h('button', {
          class: 'btn btn-danger-outline', type: 'button',
          onclick: function () {
            confirmDialog('Delete this item?', '"' + item.name + '" will be removed from your list. Sales you already recorded are kept.', 'Delete', true)
              .then(function (yes) {
                if (!yes) return;
                return DB.deleteItem(item.id).then(refresh).then(function () { toast('Item deleted'); go('#items'); });
              }).catch(fail);
          }
        }, 'Delete'))
    ]);
  }

  /* ---------- Mark as sold ---------- */

  function sellDialog(item) {
    openDialog('Mark as Sold', function (close) {
      var feeTouched = false;
      var qty = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: '1' });
      var price = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', value: moneyInput(item.price) });
      var shipping = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
      var fee = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
      var date = h('input', { type: 'date', value: todayStr(), max: todayStr() });
      var profitEl = h('div', { class: 'profit-box', 'aria-live': 'polite' });
      var errorEl = h('p', { class: 'error', role: 'alert' });

      function read() {
        return {
          qty: item.qty > 1 ? Calc.parseQty(qty.value, NaN) : 1,
          salePrice: Calc.parseMoney(price.value),
          shipping: Calc.parseMoney(shipping.value),
          fee: Calc.parseMoney(fee.value),
          unitCost: item.cost
        };
      }

      function update() {
        if (!feeTouched) {
          var p = Calc.parseMoney(price.value);
          fee.value = p > 0 ? Calc.estimateFee(p, state.settings.feePct).toFixed(2) : '';
        }
        var v = read();
        var ok = !isNaN(v.qty) && !isNaN(v.salePrice) && !isNaN(v.shipping) && !isNaN(v.fee);
        var profit = ok ? Calc.saleProfit(v) : null;
        profitEl.textContent = '';
        append(profitEl, [
          h('span', null, 'Your profit'),
          h('strong', { class: profit == null ? '' : profit < 0 ? 'neg' : 'pos' }, profit == null ? '—' : money(profit))
        ]);
      }

      [qty, price, shipping].forEach(function (el) { el.addEventListener('input', update); });
      fee.addEventListener('input', function () { feeTouched = true; update(); });
      update();

      function save() {
        var v = read();
        var msg = null;
        if (isNaN(v.qty) || v.qty < 1) msg = 'Type how many were sold.';
        else if (v.qty > item.qty) msg = 'You only have ' + item.qty + ' of these.';
        else if (isNaN(v.salePrice) || price.value.trim() === '') msg = 'Type the amount it sold for, like 24.99.';
        else if (isNaN(v.shipping)) msg = 'The shipping cost should be a number, like 5.50.';
        else if (isNaN(v.fee)) msg = 'The eBay fee should be a number, like 3.25.';
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) msg = 'Choose the date it sold.';
        if (msg) { errorEl.textContent = msg; return; }

        var sale = {
          id: DB.newId(), itemId: item.id, itemName: item.name,
          qty: v.qty, salePrice: v.salePrice, shipping: v.shipping, fee: v.fee, unitCost: v.unitCost,
          profit: Calc.saleProfit(v), date: date.value, createdAt: Date.now()
        };
        DB.recordSale(sale).then(refresh).then(function () {
          close();
          toast('Sale saved');
          route();
        }).catch(function (err) { errorEl.textContent = friendlyError(err); });
      }

      return [
        h('p', { class: 'muted' }, item.name),
        item.qty > 1 ? field('How many sold?', qty, 'You have ' + item.qty + '.') : null,
        field(item.qty > 1 ? 'Sold for (total for all of them)' : 'Sold for', price),
        field('Shipping I paid', shipping, 'Leave empty if the buyer paid for shipping.'),
        field('eBay fee', fee, 'Estimated at ' + state.settings.feePct + '%. Change it if you know the exact fee.'),
        field('Date sold', date),
        profitEl,
        errorEl,
        h('div', { class: 'stack' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save Sale'),
          h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'))
      ];
    });
  }

  /* ---------- Add / edit form ---------- */

  function blankForm() {
    return { name: '', qty: '1', cost: '', price: '', location: '', sku: '', notes: '', link: '', listed: false, photos: [] };
  }

  function viewForm(id) {
    if (!id) {
      setTop('Add an Item');
      setTab('add');
      if (!ui.draft) ui.draft = blankForm();
      renderForm(null, ui.draft);
      return;
    }
    var item = findItem(id);
    if (!item) { go('#items'); return; }
    setTop('Edit Item', '#item/' + encodeURIComponent(id));
    setTab('items');
    DB.getPhotos(id).then(function (photos) {
      renderForm(item, {
        name: item.name, qty: String(item.qty), cost: moneyInput(item.cost), price: moneyInput(item.price),
        location: item.location, sku: item.sku, notes: item.notes, link: item.link, listed: item.listed,
        photos: photos.slice()
      });
    }).catch(fail);
  }

  /* form: the values being edited. It is updated as the person types so a new item
     is not lost if they tap another tab before saving. */
  function renderForm(item, form) {
    var photoGrid = h('div', { class: 'photo-grid' });
    var errorEl = h('p', { class: 'error', role: 'alert' });
    var saving = false;

    function drawPhotos() {
      photoGrid.textContent = '';
      form.photos.forEach(function (src, i) {
        photoGrid.appendChild(h('div', { class: 'photo' },
          h('img', { src: src, alt: 'Photo ' + (i + 1) }),
          h('button', {
            class: 'photo-remove', type: 'button', 'aria-label': 'Remove photo ' + (i + 1),
            onclick: function () { form.photos.splice(i, 1); drawPhotos(); }
          }, '✕')));
      });
      if (form.photos.length < Photos.MAX_PER_ITEM) {
        var input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden' });
        input.addEventListener('change', function () {
          var files = Array.prototype.slice.call(input.files || [], 0, Photos.MAX_PER_ITEM - form.photos.length);
          if (!files.length) return;
          tile.classList.add('busy');
          files.reduce(function (chain, file) {
            return chain.then(function () { return Photos.fromFile(file); }).then(function (url) { form.photos.push(url); });
          }, Promise.resolve()).catch(function (err) { errorEl.textContent = friendlyError(err); }).then(drawPhotos);
        });
        var tile = h('label', { class: 'photo photo-add' }, input,
          h('span', { class: 'photo-add-icon', 'aria-hidden': 'true' }, '📷'),
          h('span', null, form.photos.length ? 'Add another' : 'Add a photo'));
        photoGrid.appendChild(tile);
      }
    }
    drawPhotos();

    function bind(key, input) {
      input.addEventListener('input', function () { form[key] = input.value; });
      return input;
    }

    var name = bind('name', h('input', { type: 'text', value: form.name, autocomplete: 'off', enterkeyhint: 'next', maxlength: '200' }));
    var qty = bind('qty', h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: form.qty }));
    var cost = bind('cost', h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', value: form.cost }));
    var price = bind('price', h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', value: form.price }));
    var location_ = bind('location', h('input', { type: 'text', value: form.location, placeholder: 'Shelf A, Box 3, Garage…', autocomplete: 'off', maxlength: '200' }));
    var sku = bind('sku', h('input', { type: 'text', value: form.sku, autocomplete: 'off', maxlength: '100' }));
    var notes = bind('notes', h('textarea', { rows: '3', value: form.notes, maxlength: '2000' }));
    var link = bind('link', h('input', { type: 'url', inputmode: 'url', value: form.link, placeholder: 'https://www.ebay.com/itm/…', autocomplete: 'off', maxlength: '500' }));
    var listed = h('input', { type: 'checkbox', class: 'switch', checked: form.listed, onchange: function () { form.listed = listed.checked; } });

    function save() {
      if (saving) return;
      var v = {
        name: form.name.trim(),
        qty: Calc.parseQty(form.qty, 1),
        cost: Calc.parseMoney(form.cost),
        price: Calc.parseMoney(form.price)
      };
      var msg = null, bad = null;
      if (!v.name) { msg = 'Please type a name for the item.'; bad = name; }
      else if (isNaN(v.qty)) { msg = 'Quantity should be a whole number, like 1 or 5.'; bad = qty; }
      else if (isNaN(v.cost)) { msg = '"What I paid" should be a number, like 4.50.'; bad = cost; }
      else if (isNaN(v.price)) { msg = '"Asking price" should be a number, like 24.99.'; bad = price; }
      if (msg) {
        errorEl.textContent = msg;
        bad.focus();
        return;
      }
      errorEl.textContent = '';
      saving = true;

      var now = Date.now();
      var record = {
        id: item ? item.id : DB.newId(),
        name: v.name, qty: v.qty, maxQty: Math.max(v.qty, item ? item.maxQty || 0 : 0),
        cost: v.cost, price: v.price,
        location: form.location.trim(), sku: form.sku.trim(), notes: form.notes.trim(), link: form.link.trim(),
        listed: form.listed, thumb: null,
        createdAt: item ? item.createdAt : now, updatedAt: now
      };
      var photos = form.photos.slice();
      var thumb = photos.length ? Photos.makeThumb(photos[0]) : Promise.resolve(null);
      thumb.then(function (t) {
        record.thumb = t;
        return DB.saveItem(record, photos);
      }).then(refresh).then(function () {
        if (!item) ui.draft = null;
        toast(item ? 'Changes saved' : 'Item added');
        go(item ? '#item/' + encodeURIComponent(record.id) : '#items');
      }).catch(function (err) {
        saving = false;
        errorEl.textContent = friendlyError(err);
      });
    }

    show([
      h('form', { class: 'form', novalidate: true, onsubmit: function (e) { e.preventDefault(); save(); } },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Photos'), photoGrid),
        field('Name', name, 'What is it? For example: Blue ceramic vase'),
        h('div', { class: 'field-pair' },
          field('Quantity', qty),
          field('What I paid (each)', cost)),
        field('Asking price (each)', price),
        field('Where it is stored', location_),
        h('label', { class: 'card switch-row' }, h('span', null, 'Listed on eBay'), listed),
        h('details', { class: 'more-fields', open: !!(form.sku || form.notes || form.link) },
          h('summary', null, 'More details (optional)'),
          field('Notes', notes),
          field('SKU or item number', sku),
          field('eBay listing link', link)),
        errorEl,
        h('div', { class: 'stack' },
          h('button', { class: 'btn btn-primary', type: 'submit' }, item ? 'Save Changes' : 'Save Item'),
          item
            ? h('a', { class: 'btn', href: '#item/' + encodeURIComponent(item.id) }, 'Cancel')
            : h('button', {
              class: 'btn', type: 'button',
              onclick: function () { ui.draft = null; route(); }
            }, 'Clear the form')))
    ]);
  }

  /* ---------- Sales ---------- */

  function totalsCard(title, sales) {
    var t = Calc.totals(sales);
    return h('div', { class: 'card totals' },
      h('h2', null, title),
      h('div', { class: 'totals-grid' },
        h('div', null, h('span', { class: 'totals-label' }, 'Items sold'), h('strong', null, String(t.units))),
        h('div', null, h('span', { class: 'totals-label' }, 'Money in'), h('strong', null, money(t.revenue))),
        h('div', null, h('span', { class: 'totals-label' }, 'Profit'), h('strong', { class: t.profit < 0 ? 'neg' : 'pos' }, money(t.profit)))));
  }

  function saleDialog(sale) {
    openDialog(sale.itemName, function (close) {
      return [
        h('div', { class: 'card rows' },
          row('Date sold', prettyDate(sale.date)),
          row('Quantity', String(sale.qty)),
          row('Sold for', money(sale.salePrice)),
          row('eBay fee', '− ' + money(sale.fee)),
          row('Shipping I paid', '− ' + money(sale.shipping)),
          row('What I paid', '− ' + money(sale.unitCost * sale.qty)),
          row('Profit', h('strong', { class: sale.profit < 0 ? 'neg' : 'pos' }, money(sale.profit)))),
        h('div', { class: 'stack' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Done'),
          h('button', {
            class: 'btn btn-danger-outline', type: 'button',
            onclick: function () {
              close();
              var back = findItem(sale.itemId) ? ' The quantity goes back into your list.' : '';
              confirmDialog('Undo this sale?', 'The sale will be removed.' + back, 'Undo Sale', true).then(function (yes) {
                if (!yes) return;
                return DB.undoSale(sale).then(refresh).then(function () { toast('Sale removed'); route(); });
              }).catch(fail);
            }
          }, 'Undo this sale'))
      ];
    });
  }

  function viewSales() {
    setTop('Sales');
    setTab('sales');
    if (!state.sales.length) {
      show(h('div', { class: 'empty' },
        h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '💵'),
        h('h2', null, 'No sales yet'),
        h('p', null, 'When something sells, open the item and tap "Mark as Sold". Your profit will show up here.')));
      return;
    }
    var month = todayStr().slice(0, 7);
    var sorted = state.sales.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt;
    });
    show([
      totalsCard('This month', state.sales.filter(function (s) { return s.date.slice(0, 7) === month; })),
      totalsCard('All time', state.sales),
      h('h2', { class: 'section-title' }, 'Every sale'),
      h('div', { class: 'list' }, sorted.map(function (s) {
        return h('button', { class: 'card sale-card', type: 'button', onclick: function () { saleDialog(s); } },
          h('div', { class: 'item-main' },
            h('div', { class: 'item-name' }, s.itemName),
            h('div', { class: 'item-sub' }, prettyDate(s.date) + (s.qty > 1 ? ' · Qty ' + s.qty : '') + ' · Sold for ' + money(s.salePrice))),
          h('div', { class: 'sale-profit ' + (s.profit < 0 ? 'neg' : 'pos') }, money(s.profit)));
      }))
    ]);
  }

  /* ---------- More: backup, spreadsheet, settings ---------- */

  function doBackup() {
    DB.exportBackup().then(function (b) {
      return saveFile('inventory-backup-' + todayStr() + '.json', b.blob);
    }).then(function (saved) {
      if (!saved) return;
      return DB.setSetting('lastBackup', Date.now()).then(refresh).then(function () { toast('Backup saved'); route(); });
    }).catch(fail);
  }

  function doRestore() {
    pickFile('.json,application/json').then(function (file) {
      return file.text();
    }).then(function (text) {
      var clean = DB.readBackup(text);
      return confirmDialog('Restore this backup?',
        'The backup has ' + clean.items.length + ' items and ' + clean.sales.length + ' sales. It will replace everything that is in the app right now.',
        'Replace with Backup', true).then(function (yes) {
        if (!yes) return;
        return DB.restoreBackup(clean).then(refresh).then(function () { toast('Backup restored'); go('#items'); });
      });
    }).catch(fail);
  }

  function doImport() {
    pickFile('.csv,text/csv').then(function (file) {
      return file.text();
    }).then(function (text) {
      var result = CSV.readItems(text);
      if (result.error) { alertDialog('That file could not be used', result.error); return; }
      if (!result.items.length) { alertDialog('Nothing to add', 'No items were found in that file.'); return; }
      var msg = 'Found ' + result.items.length + (result.items.length === 1 ? ' item' : ' items') + ' in the file. They will be added to your list.';
      if (result.skipped) msg += ' ' + result.skipped + (result.skipped === 1 ? ' row' : ' rows') + ' could not be read and will be left out.';
      return confirmDialog('Add these items?', msg, 'Add Items', false).then(function (yes) {
        if (!yes) return;
        var now = Date.now();
        var items = result.items.map(function (it, i) {
          it.id = DB.newId();
          it.maxQty = it.qty;
          it.thumb = null;
          it.createdAt = now - i;
          it.updatedAt = now;
          return it;
        });
        return DB.addItems(items).then(refresh).then(function () { toast(items.length + ' added'); go('#items'); });
      });
    }).catch(fail);
  }

  function csvFile(name, text) {
    saveFile(name, new Blob([text], { type: 'text/csv' })).catch(fail);
  }

  function actionButton(label, hint, onclick) {
    return h('button', { class: 'card action', type: 'button', onclick: onclick },
      h('span', { class: 'item-main' }, h('span', { class: 'item-name' }, label), hint ? h('span', { class: 'item-sub' }, hint) : null),
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'));
  }

  function viewMore() {
    setTop('More');
    setTab('more');
    var s = state.settings;

    var feePct = h('input', { type: 'text', inputmode: 'decimal', value: String(s.feePct) });
    feePct.addEventListener('change', function () {
      var v = Calc.parseMoney(feePct.value);
      if (isNaN(v) || v > 100 || feePct.value.trim() === '') { feePct.value = String(s.feePct); toast('Type a number from 0 to 100'); return; }
      DB.setSetting('feePct', v).then(refresh).then(function () { s = state.settings; toast('Saved'); }).catch(fail);
    });
    var lowStock = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: String(s.lowStock) });
    lowStock.addEventListener('change', function () {
      var v = Calc.parseQty(lowStock.value, NaN);
      if (isNaN(v)) { lowStock.value = String(s.lowStock); toast('Type a whole number, like 1'); return; }
      DB.setSetting('lowStock', v).then(refresh).then(function () { s = state.settings; toast('Saved'); }).catch(fail);
    });

    var lastBackup = s.lastBackup
      ? 'Last backup: ' + new Date(s.lastBackup).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'No backup saved yet';

    show([
      h('h2', { class: 'section-title' }, 'Backup'),
      h('p', { class: 'muted' }, 'Your list is kept only on this device. Save a backup now and then so you can get it back if the phone is lost or replaced.'),
      h('div', { class: 'list' },
        actionButton('Save a backup', lastBackup, doBackup),
        actionButton('Restore from a backup', 'Bring back a list you saved earlier', doRestore)),

      h('h2', { class: 'section-title' }, 'Spreadsheet (CSV)'),
      h('div', { class: 'list' },
        actionButton('Export items', 'Opens in Excel or Google Sheets', function () { csvFile('inventory-items-' + todayStr() + '.csv', CSV.itemsToCSV(state.items)); }),
        actionButton('Export sales', 'Every sale with fees and profit', function () { csvFile('inventory-sales-' + todayStr() + '.csv', CSV.salesToCSV(state.sales)); }),
        actionButton('Import items', 'Add many items at once from a CSV file', doImport),
        actionButton('Get the import template', 'An example file showing the columns to use', function () { csvFile('inventory-import-template.csv', CSV.templateCSV()); })),

      h('h2', { class: 'section-title' }, 'Settings'),
      h('div', { class: 'card settings' },
        field('eBay fee estimate (%)', feePct, 'Used to fill in the fee when you mark something as sold. You can always change the fee for a single sale.'),
        field('Low stock warning', lowStock, 'Shows "Low stock" when an item you had more of drops to this number or less. Use 0 to turn it off.')),

      h('h2', { class: 'section-title' }, 'Help'),
      h('div', { class: 'list' }, h('a', { class: 'card action', href: '#help' },
        h('span', { class: 'item-main' }, h('span', { class: 'item-name' }, 'How to use this app')),
        h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'))),

      h('p', { class: 'muted center small' }, 'My Inventory · version ' + APP_VERSION)
    ]);
  }

  /* ---------- Help ---------- */

  function helpSection(title, steps) {
    return h('div', { class: 'card help' }, h('h2', null, title),
      h('ol', null, steps.map(function (s) { return h('li', null, s); })));
  }

  function viewHelp() {
    setTop('How to Use', '#more');
    setTab('more');
    show([
      helpSection('Add something to sell', [
        'Tap "Add" at the bottom of the screen.',
        'Tap "Add a photo" to take a picture (optional).',
        'Type a name, how many you have, and what you paid.',
        'Tap "Save Item".'
      ]),
      helpSection('When you list it on eBay', [
        'Tap "Items", then tap the item.',
        'Turn on "Listed on eBay".'
      ]),
      helpSection('When it sells', [
        'Tap "Items", then tap the item.',
        'Tap "Mark as Sold".',
        'Type what it sold for and what you paid for shipping. The eBay fee is estimated for you.',
        'Tap "Save Sale". Your profit is added to the "Sales" page.'
      ]),
      helpSection('Fix a mistake', [
        'To change an item, open it and tap "Edit".',
        'To cancel a sale, tap "Sales", tap the sale, then tap "Undo this sale".'
      ]),
      helpSection('Keep your list safe', [
        'Your list is stored only on this phone. It is not sent anywhere.',
        'Tap "More", then "Save a backup" every week or two. Choose "Save to Files" to keep the backup file.',
        'On a new phone, open this app, tap "More", then "Restore from a backup" and choose that file.',
        'Do not clear Safari’s website data, or the list will be erased.'
      ]),
      helpSection('Put the app on your Home Screen (iPhone)', [
        'Open this page in Safari.',
        'Tap the Share button (the square with an arrow pointing up).',
        'Scroll down and tap "Add to Home Screen", then "Add".',
        'From now on, open the app from its icon. This also keeps your list from being cleared by the phone.'
      ])
    ]);
  }

  /* ---------- Routing ---------- */

  function route() {
    var parts = location.hash.replace(/^#/, '').split('/');
    var id = parts[1] ? decodeURIComponent(parts[1]) : null;
    switch (parts[0]) {
      case 'add': viewForm(null); break;
      case 'edit': viewForm(id); break;
      case 'item': viewDetail(id); break;
      case 'sales': viewSales(); break;
      case 'more': viewMore(); break;
      case 'help': viewHelp(); break;
      default: viewItems();
    }
  }

  function start() {
    if (!window.indexedDB) {
      show(h('div', { class: 'empty' }, h('h2', null, 'This browser cannot save your list'),
        h('p', null, 'Please open this page in Safari or Chrome, and not in a private window.')));
      return;
    }
    refresh().then(function () {
      if (!state.settings.firstUse) {
        state.settings.firstUse = Date.now();
        DB.setSetting('firstUse', state.settings.firstUse).catch(function () { /* not critical */ });
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { /* optional */ });
      window.addEventListener('hashchange', route);
      route();
    }).catch(function (err) {
      console.error(err);
      show(h('div', { class: 'empty' }, h('h2', null, 'The app could not open your list'),
        h('p', null, 'If you are in a private browsing window, open the app in a normal window instead.')));
    });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline use is optional */ });
    }
  }

  start();
})();

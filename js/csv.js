/* CSV reading and writing for items and sales. */
(function (root) {
  'use strict';
  var Calc = root.Calc;

  var ITEM_HEADERS = ['Name', 'Quantity', 'Cost', 'Price', 'Location', 'SKU', 'Notes', 'Link', 'Listed'];

  var ALIASES = {
    name: ['name', 'item', 'item name', 'title', 'product'],
    qty: ['quantity', 'qty', 'count', 'stock'],
    cost: ['cost', 'what i paid', 'paid', 'purchase price', 'cost each'],
    price: ['price', 'asking price', 'list price'],
    location: ['location', 'storage location', 'shelf', 'bin'],
    sku: ['sku', 'item number'],
    notes: ['notes', 'note', 'description'],
    link: ['link', 'ebay link', 'listing link', 'url'],
    listed: ['listed', 'listed on ebay']
  };

  function detectDelimiter(text) {
    var firstLine = text.split(/\r?\n/, 1)[0] || '';
    var best = ',', bestCount = 0;
    [',', ';', '\t'].forEach(function (d) {
      var c = firstLine.split(d).length - 1;
      if (c > bestCount) { best = d; bestCount = c; }
    });
    return best;
  }

  /* Returns an array of rows, each an array of strings. Handles quotes and line breaks inside quotes. */
  function parse(text) {
    text = String(text || '').replace(/^﻿/, '');
    var delim = detectDelimiter(text);
    var rows = [], row = [], cell = '', inQuotes = false, i = 0, c;
    while (i < text.length) {
      c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false;
        } else {
          cell += c;
        }
      } else if (c === '"' && cell === '') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(cell); cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
      } else {
        cell += c;
      }
      i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (v) { return v.trim() !== ''; });
    });
  }

  /* Text that starts with = + - @ would run as a formula in a spreadsheet, so it gets a leading '. */
  function safeText(v) {
    var s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function unsafeText(v) {
    var s = String(v == null ? '' : v).trim();
    return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
  }

  function cellOut(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function stringify(rows) {
    return '﻿' + rows.map(function (r) { return r.map(cellOut).join(','); }).join('\r\n') + '\r\n';
  }

  function itemsToCSV(items) {
    var rows = [ITEM_HEADERS];
    items.forEach(function (it) {
      rows.push([
        safeText(it.name), it.qty, it.cost.toFixed(2), it.price.toFixed(2),
        safeText(it.location), safeText(it.sku), safeText(it.notes), safeText(it.link),
        it.listed ? 'Yes' : 'No'
      ]);
    });
    return stringify(rows);
  }

  function salesToCSV(sales) {
    var rows = [['Date', 'Item', 'Quantity', 'Sold for', 'eBay fee', 'Shipping', 'Item cost', 'Profit']];
    sales.forEach(function (s) {
      rows.push([
        s.date, safeText(s.itemName), s.qty, s.salePrice.toFixed(2), s.fee.toFixed(2),
        s.shipping.toFixed(2), (s.unitCost * s.qty).toFixed(2), s.profit.toFixed(2)
      ]);
    });
    return stringify(rows);
  }

  function templateCSV() {
    return stringify([
      ITEM_HEADERS,
      ['Example: Blue ceramic vase', '1', '4.00', '24.99', 'Shelf A', '', 'Small chip on the base', '', 'No']
    ]);
  }

  /* Turns CSV text into plain item fields. Returns { items, skipped, error }. */
  function readItems(text) {
    var rows = parse(text);
    if (rows.length < 1) return { items: [], skipped: 0, error: 'The file is empty.' };

    var header = rows[0].map(function (hd) { return hd.trim().toLowerCase(); });
    var col = {};
    Object.keys(ALIASES).forEach(function (key) {
      col[key] = -1;
      for (var i = 0; i < header.length; i++) {
        if (ALIASES[key].indexOf(header[i]) !== -1) { col[key] = i; break; }
      }
    });
    if (col.name === -1) {
      return { items: [], skipped: 0, error: 'The file needs a column called "Name" in the first row.' };
    }

    var items = [], skipped = 0;
    rows.slice(1).forEach(function (r) {
      function get(key) { return col[key] === -1 ? '' : unsafeText(r[col[key]]); }
      var name = get('name');
      var qty = Calc.parseQty(get('qty'), 1);
      var cost = Calc.parseMoney(get('cost'));
      var price = Calc.parseMoney(get('price'));
      if (!name || isNaN(qty) || isNaN(cost) || isNaN(price)) { skipped++; return; }
      items.push({
        name: name, qty: qty, cost: cost, price: price,
        location: get('location'), sku: get('sku'), notes: get('notes'), link: get('link'),
        listed: /^(yes|y|true|1|listed)$/i.test(get('listed'))
      });
    });
    return { items: items, skipped: skipped, error: null };
  }

  root.CSV = {
    parse: parse,
    stringify: stringify,
    itemsToCSV: itemsToCSV,
    salesToCSV: salesToCSV,
    templateCSV: templateCSV,
    readItems: readItems
  };
})(typeof window !== 'undefined' ? window : globalThis);

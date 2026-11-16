/* All reading and writing of saved data (IndexedDB, kept in this browser only). */
(function (root) {
  'use strict';

  var DB_NAME = 'my-inventory';
  var DB_VERSION = 1;
  var BACKUP_TAG = 'my-inventory-backup';
  var dbPromise = null;

  var DEFAULT_SETTINGS = { feePct: 13.25, lowStock: 1, lastBackup: 0, firstUse: 0, hideInstallTip: false };

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = function () {
          var db = r.result;
          db.createObjectStore('items', { keyPath: 'id' });
          db.createObjectStore('photos', { keyPath: 'itemId' });
          db.createObjectStore('sales', { keyPath: 'id' });
          db.createObjectStore('settings', { keyPath: 'key' });
        };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { dbPromise = null; reject(r.error); };
      });
    }
    return dbPromise;
  }

  /* Runs fn(getStore) inside one transaction. Resolves when everything is safely written. */
  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(stores, mode);
        var out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('The change could not be saved.')); };
        try {
          out = fn(function (name) { return t.objectStore(name); }, t);
        } catch (e) {
          try { t.abort(); } catch (ignore) { /* already finished */ }
          reject(e);
        }
      });
    });
  }

  function getAll(store) {
    var result;
    return tx([store], 'readonly', function (s) {
      var r = s(store).getAll();
      r.onsuccess = function () { result = r.result; };
    }).then(function () { return result; });
  }

  function getOne(store, key) {
    var result;
    return tx([store], 'readonly', function (s) {
      var r = s(store).get(key);
      r.onsuccess = function () { result = r.result; };
    }).then(function () { return result; });
  }

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  /* ---------- Items ---------- */

  function getPhotos(itemId) {
    return getOne('photos', itemId).then(function (rec) { return rec ? rec.photos : []; });
  }

  /* photos: array of data URLs, or undefined to leave the saved photos untouched. */
  function saveItem(item, photos) {
    return tx(['items', 'photos'], 'readwrite', function (s) {
      s('items').put(item);
      if (photos) {
        if (photos.length) s('photos').put({ itemId: item.id, photos: photos });
        else s('photos').delete(item.id);
      }
    });
  }

  function deleteItem(id) {
    return tx(['items', 'photos'], 'readwrite', function (s) {
      s('items').delete(id);
      s('photos').delete(id);
    });
  }

  function addItems(items) {
    return tx(['items'], 'readwrite', function (s) {
      items.forEach(function (it) { s('items').put(it); });
    });
  }

  /* ---------- Sales ---------- */

  /* Lowers the item's quantity and stores the sale together, or does neither. */
  function recordSale(sale) {
    return tx(['items', 'sales'], 'readwrite', function (s, t) {
      var r = s('items').get(sale.itemId);
      r.onsuccess = function () {
        var item = r.result;
        if (!item || item.qty < sale.qty) { t.abort(); return; }
        item.qty -= sale.qty;
        item.updatedAt = Date.now();
        s('items').put(item);
        s('sales').put(sale);
      };
    });
  }

  /* Removes the sale and puts the quantity back if the item still exists. */
  function undoSale(sale) {
    return tx(['items', 'sales'], 'readwrite', function (s) {
      var r = s('items').get(sale.itemId);
      r.onsuccess = function () {
        var item = r.result;
        if (item) {
          item.qty += sale.qty;
          item.updatedAt = Date.now();
          s('items').put(item);
        }
        s('sales').delete(sale.id);
      };
    });
  }

  /* ---------- Settings ---------- */

  function getSettings() {
    return getAll('settings').then(function (rows) {
      var out = {};
      Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = DEFAULT_SETTINGS[k]; });
      rows.forEach(function (r) { out[r.key] = r.value; });
      return out;
    });
  }

  function setSetting(key, value) {
    return tx(['settings'], 'readwrite', function (s) {
      s('settings').put({ key: key, value: value });
    });
  }

  /* ---------- Backup ---------- */

  /* Built in pieces so a large photo collection is not held as one giant string. */
  function exportBackup() {
    return Promise.all([getAll('items'), getAll('sales'), getAll('photos'), getSettings()]).then(function (d) {
      var parts = [
        '{"app":"' + BACKUP_TAG + '","version":1,"exportedAt":' + JSON.stringify(new Date().toISOString()),
        ',"settings":' + JSON.stringify({ feePct: d[3].feePct, lowStock: d[3].lowStock }),
        ',"items":' + JSON.stringify(d[0]),
        ',"sales":' + JSON.stringify(d[1]),
        ',"photos":['
      ];
      d[2].forEach(function (p, i) { parts.push((i ? ',' : '') + JSON.stringify(p)); });
      parts.push(']}');
      return { blob: new Blob(parts, { type: 'application/json' }), items: d[0].length, sales: d[1].length };
    });
  }

  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function isPhoto(v) { return typeof v === 'string' && v.indexOf('data:image/') === 0; }

  /* Checks a backup file and returns clean data, or throws with a plain-words message. */
  function readBackup(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || data.app !== BACKUP_TAG || !Array.isArray(data.items) || !Array.isArray(data.sales)) {
      throw new Error('This file is not a backup made by this app.');
    }
    var items = data.items.filter(function (it) { return it && str(it.id) && str(it.name); }).map(function (it) {
      var qty = Math.max(0, Math.floor(num(it.qty)));
      return {
        id: it.id, name: it.name, qty: qty, maxQty: Math.max(qty, Math.floor(num(it.maxQty))),
        cost: Math.max(0, num(it.cost)), price: Math.max(0, num(it.price)),
        location: str(it.location), sku: str(it.sku), notes: str(it.notes), link: str(it.link),
        listed: !!it.listed, thumb: isPhoto(it.thumb) ? it.thumb : null,
        createdAt: num(it.createdAt) || Date.now(), updatedAt: num(it.updatedAt) || Date.now()
      };
    });
    var sales = data.sales.filter(function (s) { return s && str(s.id) && /^\d{4}-\d{2}-\d{2}$/.test(str(s.date)); }).map(function (s) {
      return {
        id: s.id, itemId: str(s.itemId), itemName: str(s.itemName) || 'Item',
        qty: Math.max(1, Math.floor(num(s.qty))), salePrice: num(s.salePrice), fee: num(s.fee),
        shipping: num(s.shipping), unitCost: num(s.unitCost), profit: num(s.profit),
        date: s.date, createdAt: num(s.createdAt) || Date.now()
      };
    });
    var photos = (Array.isArray(data.photos) ? data.photos : []).filter(function (p) {
      return p && str(p.itemId) && Array.isArray(p.photos);
    }).map(function (p) {
      return { itemId: p.itemId, photos: p.photos.filter(isPhoto) };
    }).filter(function (p) { return p.photos.length; });
    var settings = {};
    if (data.settings && typeof data.settings === 'object') {
      if (num(data.settings.feePct) >= 0 && num(data.settings.feePct) <= 100) settings.feePct = num(data.settings.feePct);
      if (num(data.settings.lowStock) >= 0) settings.lowStock = Math.floor(num(data.settings.lowStock));
    }
    return { items: items, sales: sales, photos: photos, settings: settings };
  }

  /* Replaces everything in the app with the backup's contents. */
  function restoreBackup(clean) {
    return tx(['items', 'sales', 'photos', 'settings'], 'readwrite', function (s) {
      s('items').clear(); s('sales').clear(); s('photos').clear();
      clean.items.forEach(function (it) { s('items').put(it); });
      clean.sales.forEach(function (sale) { s('sales').put(sale); });
      clean.photos.forEach(function (p) { s('photos').put(p); });
      Object.keys(clean.settings).forEach(function (k) { s('settings').put({ key: k, value: clean.settings[k] }); });
    });
  }

  root.DB = {
    newId: newId,
    getItems: function () { return getAll('items'); },
    getSales: function () { return getAll('sales'); },
    getPhotos: getPhotos,
    saveItem: saveItem,
    deleteItem: deleteItem,
    addItems: addItems,
    recordSale: recordSale,
    undoSale: undoSale,
    getSettings: getSettings,
    setSetting: setSetting,
    exportBackup: exportBackup,
    readBackup: readBackup,
    restoreBackup: restoreBackup
  };
})(window);

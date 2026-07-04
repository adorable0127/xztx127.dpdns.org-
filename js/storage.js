/* =====================================================================
   storage.js  ·  本地缓存文件库（FileVault）
   用浏览器 IndexedDB 把文件以 Blob 形式存在本地，离线可用、刷新不丢、
   无需任何服务器。这就是“把服务器改成缓存存储重要文件”的实现。

   记录结构： { id, name, type, size, date, important, blob }
   - important: 是否标记为“重要文件”（置顶 + 高亮）

   所有方法返回 Promise。
   ===================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'mc_file_vault';
  var STORE = 'files';
  var VERSION = 1;
  var _db = null;

  function supported() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  function open() {
    return new Promise(function (resolve, reject) {
      if (_db) return resolve(_db);
      if (!supported()) return reject(new Error('当前环境不支持本地存储 (IndexedDB)'));
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error || new Error('打开数据库失败')); };
    });
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function uid() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  var FileVault = {
    supported: supported,

    ready: function () { return open().then(function () { return true; }); },

    // 存入一个 File / Blob
    put: function (file) {
      var rec = {
        id: uid(),
        name: file.name || ('未命名_' + Date.now()),
        type: file.type || 'application/octet-stream',
        size: file.size || 0,
        date: Date.now(),
        important: false,
        blob: file
      };
      return tx('readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var r = store.add(rec);
          r.onsuccess = function () { resolve(rec); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    // 列出所有文件的元信息（不含 blob），重要文件置顶、其余按时间倒序
    list: function () {
      return tx('readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var out = [];
          var cur = store.openCursor();
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (c) {
              var v = c.value;
              out.push({ id: v.id, name: v.name, type: v.type, size: v.size, date: v.date, important: !!v.important });
              c.continue();
            } else {
              out.sort(function (a, b) {
                if (a.important !== b.important) return a.important ? -1 : 1;
                return b.date - a.date;
              });
              resolve(out);
            }
          };
          cur.onerror = function () { reject(cur.error); };
        });
      });
    },

    // 取出完整记录（含 blob），用于下载
    get: function (id) {
      return tx('readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var r = store.get(id);
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    // 切换“重要”标记
    toggleImportant: function (id) {
      return tx('readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var g = store.get(id);
          g.onsuccess = function () {
            var rec = g.result;
            if (!rec) return resolve(null);
            rec.important = !rec.important;
            var p = store.put(rec);
            p.onsuccess = function () { resolve(rec.important); };
            p.onerror = function () { reject(p.error); };
          };
          g.onerror = function () { reject(g.error); };
        });
      });
    },

    remove: function (id) {
      return tx('readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var r = store.delete(id);
          r.onsuccess = function () { resolve(true); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    clear: function () {
      return tx('readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var r = store.clear();
          r.onsuccess = function () { resolve(true); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },

    // 估算占用（不一定所有浏览器都支持）
    usage: function () {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (e) {
          return { used: e.usage || 0, quota: e.quota || 0 };
        });
      }
      return Promise.resolve(null);
    }
  };

  global.FileVault = FileVault;
})(window);

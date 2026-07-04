/* =====================================================================
   server.js  ·  文件服务器控制器
   连接界面与本地缓存库 FileVault：上传、列出、下载、置顶、删除、清空。
   ===================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 通知 ---------- */
  function notif(msg, type) {
    var box = $('mc-notifs');
    var el = document.createElement('div');
    el.className = 'mc-notif' + (type === 'err' ? ' err' : '');
    el.textContent = (type === 'err' ? '✖ ' : '✔ ') + msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  /* ---------- 小工具 ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(2) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function fmtDate(ms) { return new Date(ms).toLocaleString('zh-CN'); }
  function iconFor(type, name) {
    if (type.indexOf('image/') === 0) return '🖼️';
    if (type.indexOf('video/') === 0) return '🎬';
    if (type.indexOf('audio/') === 0) return '🎵';
    if (type.indexOf('pdf') >= 0) return '📄';
    if (/\.(zip|rar|7z|tar|gz|jar)$/i.test(name)) return '📦';
    if (/\.(js|ts|py|java|html|css|json|md)$/i.test(name)) return '📝';
    if (/\.(xls|xlsx|csv)$/i.test(name)) return '📊';
    if (/\.(doc|docx|txt)$/i.test(name)) return '📃';
    return '📁';
  }

  /* ---------- 渲染列表 ---------- */
  function refresh() {
    return FileVault.list().then(function (files) {
      var list = $('flist'), empty = $('empty');
      list.innerHTML = '';
      empty.style.display = files.length ? 'none' : 'block';
      $('count').textContent = '物品栏：' + files.length + ' 个文件';

      files.forEach(function (f) {
        var li = document.createElement('li');
        li.className = 'fitem' + (f.important ? ' important' : '');
        li.innerHTML =
          '<div class="ficon">' + iconFor(f.type, f.name) + '</div>' +
          '<div class="finfo">' +
            '<div class="fname">' + (f.important ? '<span class="star">★</span>' : '') + esc(f.name) + '</div>' +
            '<div class="fmeta">' + fmtSize(f.size) + ' · ' + fmtDate(f.date) + '</div>' +
          '</div>' +
          '<div class="factions">' +
            '<button class="mc-btn tiny" data-act="dl"   data-id="' + f.id + '">⬇ 下载</button>' +
            '<button class="mc-btn tiny" data-act="star" data-id="' + f.id + '">' + (f.important ? '☆ 取消' : '★ 重要') + '</button>' +
            '<button class="mc-btn tiny red" data-act="rm" data-id="' + f.id + '">🗑</button>' +
          '</div>';
        list.appendChild(li);
      });
      updateUsage();
    }).catch(function (e) { notif('读取失败：' + e.message, 'err'); });
  }

  function updateUsage() {
    FileVault.usage().then(function (u) {
      if (!u || !u.quota) return;
      $('usage').style.display = 'block';
      var pct = Math.min(100, (u.used / u.quota) * 100);
      $('usageFill').style.width = pct.toFixed(1) + '%';
      $('usageText').textContent = fmtSize(u.used) + ' / ' + fmtSize(u.quota);
    });
  }

  /* ---------- 上传 ---------- */
  function uploadAll(fileList) {
    if (!fileList || !fileList.length) return;
    var arr = Array.prototype.slice.call(fileList);
    var prog = $('prog'), bar = $('progBar'), nm = $('progName'), pct = $('progPct');
    prog.style.display = 'block';

    var i = 0;
    function next() {
      if (i >= arr.length) {
        bar.style.width = '100%'; pct.textContent = '100%';
        setTimeout(function () { prog.style.display = 'none'; bar.style.width = '0%'; }, 350);
        refresh();
        return;
      }
      var f = arr[i];
      nm.textContent = f.name;
      var p = Math.round((i / arr.length) * 100);
      bar.style.width = p + '%'; pct.textContent = p + '%';
      FileVault.put(f).then(function () {
        notif('已存储：' + f.name);
        i++; next();
      }).catch(function (e) {
        notif('存储失败：' + e.message, 'err');
        i++; next();
      });
    }
    next();
  }

  /* ---------- 下载 ---------- */
  function download(id) {
    FileVault.get(id).then(function (rec) {
      if (!rec) return notif('文件不存在', 'err');
      var url = URL.createObjectURL(rec.blob);
      var a = document.createElement('a');
      a.href = url; a.download = rec.name; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      notif('正在下载：' + rec.name);
    }).catch(function (e) { notif('下载失败：' + e.message, 'err'); });
  }

  /* ---------- 对外接口 ---------- */
  var MCServer = {
    clearAll: function () {
      if (!confirm('确定清空所有文件？此操作不可撤销。')) return;
      FileVault.clear().then(function () { notif('已清空物品栏', 'err'); refresh(); });
    }
  };
  global.MCServer = MCServer;

  /* ---------- 绑定事件 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (!FileVault.supported()) {
      $('unsupported').style.display = 'block';
      $('dropzone').style.display = 'none';
      $('empty').style.display = 'none';
      return;
    }
    FileVault.ready().catch(function (e) {
      $('unsupported').style.display = 'block';
      notif('初始化失败：' + e.message, 'err');
    });

    var dz = $('dropzone'), input = $('filein');
    input.addEventListener('change', function () { uploadAll(this.files); this.value = ''; });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('over');
      uploadAll(e.dataTransfer.files);
    });

    // 列表里的按钮（事件委托）
    $('flist').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      if (act === 'dl') download(id);
      else if (act === 'rm') { FileVault.remove(id).then(function () { notif('已删除', 'err'); refresh(); }); }
      else if (act === 'star') {
        FileVault.toggleImportant(id).then(function (now) {
          notif(now ? '已标记为重要文件' : '已取消重要标记');
          refresh();
        });
      }
    });

    refresh();
  });
})(window);

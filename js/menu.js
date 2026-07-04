/* =====================================================================
   menu.js  ·  标题界面逻辑
   职责：启动全景、生成飘落粒子、挂载标语、处理按钮跳转与彩蛋。
   ===================================================================== */
(function (global) {
  'use strict';

  // 简易通知（标题页用，和 server/arcade 的 notif 一致风格）
  function notif(msg, type) {
    var box = document.getElementById('mc-notifs');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'mc-notif' + (type === 'err' ? ' err' : '');
    el.textContent = (type === 'err' ? '✖ ' : '✔ ') + msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  // 背景飘落粒子（方块碎屑）
  function spawnParticles() {
    var layer = document.getElementById('menu-particles');
    if (!layer) return;
    var colors = ['#58a52d', '#81c784', '#ffd83d', '#7b7bff', '#c98a4b', '#ffffff'];
    for (var i = 0; i < 18; i++) {
      var p = document.createElement('div');
      p.className = 'mc-particle';
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (8 + Math.random() * 12) + 's';
      p.style.animationDelay = (Math.random() * 12) + 's';
      var sz = 3 + Math.floor(Math.random() * 4);
      p.style.width = sz + 'px';
      p.style.height = sz + 'px';
      layer.appendChild(p);
    }
  }

  var MCMenu = {
    goto: function (url) { window.location.href = url; },
    // 选项 → 跳转 Bilibili 视频
    options: function () { window.open('https://www.bilibili.com/video/BV1GJ411x7h7/', '_blank', 'noopener'); },
    quit: function () { notif('这是网页，退不掉的 :)', 'err'); },
    lang: function () { notif('当前语言：简体中文（zh-CN）'); },

    // —— 创建世界弹窗 ——
    openCreate: function () {
      var m = document.getElementById('createModal');
      if (m) m.classList.add('show');
    },
    closeCreate: function () {
      var m = document.getElementById('createModal');
      if (m) m.classList.remove('show');
    },
    randomSeed: function () {
      var inp = document.getElementById('seedInput');
      if (inp) inp.value = String(Math.floor(Math.random() * 1e9));
    },
    setMode: function (mode) {
      MCMenu._mode = mode;
      ['survival', 'creative'].forEach(function (k) {
        var b = document.getElementById('mode-' + k);
        if (b) b.classList.toggle('sel', k === mode);
      });
    },
    startWorld: function () {
      var seed = (document.getElementById('seedInput') || {}).value || '';
      var mode = MCMenu._mode || 'survival';
      var qs = [];
      if (seed.trim() !== '') qs.push('seed=' + encodeURIComponent(seed.trim()));
      qs.push('mode=' + mode);
      window.location.href = 'mc.html?' + qs.join('&');
    },
    _mode: 'survival'
  };
  global.MCMenu = MCMenu;

  // 初始化
  document.addEventListener('DOMContentLoaded', function () {
    if (global.MCPanorama) MCPanorama.start('panorama');
    if (global.MCSplash) MCSplash.mount(document.getElementById('splash'));
    spawnParticles();
    MCMenu.setMode('survival');
    // 点击遮罩空白处关闭创建弹窗
    var modal = document.getElementById('createModal');
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) MCMenu.closeCreate(); });
  });
})(window);

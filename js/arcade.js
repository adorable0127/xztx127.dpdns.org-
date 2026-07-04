/* =====================================================================
   arcade.js  ·  小游戏厅
   集中存放三类数据并渲染：
     1) 小游戏库   GAMES
     2) 模组库     MODS / MODPACKS（点“下载”才跳转 Modrinth）
     3) 联系作者   CONTACTS
   标签页切换也在这里。
   ===================================================================== */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* =================== 1. 小游戏库（12 款） =================== */
  var GAMES = [
    { file: 'games/tetris.html',      icon: '🟦', name: '俄罗斯方块',   en: 'Tetris',       tag: '经典', color: '#a85bd6' },
    { file: 'games/snake.html',       icon: '🐍', name: '贪吃蛇',       en: 'Snake',        tag: '休闲', color: '#5ed47a' },
    { file: 'games/game2048.html',    icon: '🔢', name: '2048',         en: '2048',         tag: '益智', color: '#f2a93b' },
    { file: 'games/minesweeper.html', icon: '💣', name: '扫雷',         en: 'Minesweeper',  tag: '益智', color: '#d83c3c' },
    { file: 'games/breakout.html',    icon: '🧱', name: '打砖块',       en: 'Breakout',     tag: '街机', color: '#3fc1e8' },
    { file: 'games/flappy.html',      icon: '🐤', name: '像素小鸟',     en: 'Flappy',       tag: '街机', color: '#ffd83d' },
    { file: 'games/memory.html',      icon: '🃏', name: '记忆翻牌',     en: 'Memory',       tag: '益智', color: '#7b7bff' },
    { file: 'games/pong.html',        icon: '🏓', name: '弹球对战',     en: 'Pong',         tag: '对战', color: '#e8e6e0' },
    { file: 'games/whack.html',       icon: '💥', name: '打苦力怕',     en: 'Whack-a-Creeper', tag: '反应', color: '#58a52d' },
    { file: 'games/simon.html',       icon: '🎵', name: '记忆音序',     en: 'Simon',        tag: '记忆', color: '#3fc1e8' },
    { file: 'games/tictactoe.html',   icon: '⭕', name: '井字棋',       en: 'Tic-Tac-Toe',  tag: '对战', color: '#f2d43b' },
    { file: 'games/sokoban.html',     icon: '📦', name: '推箱子',       en: 'Sokoban',      tag: '益智', color: '#c98a4b' },
    /* ==== xztx127 增补：9 款（文件位于 game/ 目录）==== */
    { file: 'game/anti-gambling.html', icon: '🎰', name: '回头是岸',   en: 'Anti-Gambling',   tag: '教育', color: '#5dd977' },
    { file: 'game/anti-fraud.html',    icon: '📞', name: '来电',       en: 'Anti-Fraud',      tag: '教育', color: '#5aa7ff' },
    { file: 'game/anti-loan.html',     icon: '💳', name: '精致陷阱',   en: 'Anti-Loan',       tag: '教育', color: '#ff8ac2' },
    { file: 'game/malware-hunter.html',icon: '🧹', name: '卸载大师·2016', en: 'Malware Hunter', tag: '教育', color: '#ffd24d' },
    { file: 'game/runner.html',        icon: '🏃', name: '洞穴跑酷',   en: 'Cave Runner',     tag: '街机', color: '#c9a2ff' },
    { file: 'game/defense.html',       icon: '🛡', name: '村庄保卫战', en: 'Village Defense', tag: '塔防', color: '#8a5f3a' },
    { file: 'game/connect4.html',      icon: '💎', name: '四子连珠',   en: 'Connect Four',    tag: '对战', color: '#3ecfe0' },
    { file: 'game/maze.html',          icon: '🌌', name: '末地迷宫',   en: 'End Maze',        tag: '探险', color: '#a86eff' },
    { file: 'game/fishing.html',       icon: '🎣', name: '湖畔钓鱼',   en: 'Fishing',         tag: '休闲', color: '#3d76a8' },
  ];

  /* =================== 2. 模组库 =================== */
  var MODS = [
    {
      icon: '🌈', name: 'CoreTweaker127 的奇妙模组', en: "CoreTweaker127's Wonderful Mod",
      url: 'https://modrinth.com/mod/xzctk', dl: '—', tags: ['综合', '魔法'],
      desc: '150 个中国英雄成就、彩虹神剑（5000 伤害）、26 种 TNT 变体、超级矿车、万物皆可图腾、多维度系统……一个功能爆炸的综合性 Fabric 模组。'
    },
    {
      icon: '⛏️', name: '挖泥土掉神器', en: 'Digging dirt drops artifacts',
      url: 'https://modrinth.com/mod/digging-dirt-drop-sartifacts', dl: '52', tags: ['魔法', '实用'],
      desc: '泥土不再无用！挖掘泥土有概率掉落 255 级附魔下界合金套装、255 级武器工具、不死图腾、传送门框架等神级装备。注意：世界记录挑战 / 速通请勿使用。'
    },
    {
      icon: '♾️', name: '无限使用', en: 'Unlimited use',
      url: 'https://modrinth.com/mod/unlimited-use', dl: '62', tags: ['机制', '魔法'],
      desc: '让任意物品都能附魔“无限”并无限使用，突破传统附魔系统的限制，适合喜欢高耐久、创造性玩法的玩家。注意：世界记录 / 速通请勿使用。'
    },
    {
      icon: '🎢', name: 'Splinecart 非官方版', en: 'Splinecart Unofficial (1.20.x)',
      url: 'https://modrinth.com/mod/splinecart-for-1.20.x1', dl: '—', tags: ['机制', 'MIT'],
      desc: '在 MC 里搭建平滑曲线轨道过山车！普通 / 链条 / 磁性三种轨道，任意两点之间铺设流畅样条曲线。中文汉化 + 1.20.1 重置版，移植自 FoundationGames。'
    },
  ];

  var MODPACKS = [
    {
      icon: '🚀', name: '新手 FPS 优化整合包', en: '[Beginner] FPS Optimization Pack',
      url: 'https://modrinth.com/modpack/beginner-fps-optimization', dl: '12', tags: ['优化', '轻量'],
      desc: '纯优化整合包，大幅提升帧率、重写渲染逻辑、优化内存占用，不改变任何玩法。需 Java 21（请勿用 Java 17）、Fabric、Minecraft 1.20.1。'
    },
  ];

  /* =================== 3. 联系作者 =================== */
  var CONTACTS = [
    { icon: '📺', label: 'Bilibili',  value: '点击前往主页', href: 'https://space.bilibili.com/3546834976902089' },
    { icon: '🟩', label: 'Modrinth',  value: 'CoreTweaker127', href: 'https://modrinth.com/user/CoreTweaker127' },
    { icon: '🔥', label: 'CurseForge',value: 'xztx127',      href: 'https://www.curseforge.com/members/xztx127/projects' },
    { icon: '✖️', label: 'X (Twitter)',value: '@xztx226',    href: 'https://x.com/xztx226' },
    { icon: '💬', label: 'Discord',   value: 'xztx127',      href: null, note: '（用户名，可搜索添加）' },
    { icon: '📮', label: '邮箱（推荐）', value: 'adorable189@qq.com', href: 'mailto:adorable189@qq.com', note: '常用' },
    { icon: '📧', label: '邮箱',       value: 'xztx127@gmail.com',  href: 'mailto:xztx127@gmail.com' },
    { icon: '📭', label: '邮箱',       value: 'xztx127@outlook.com', href: 'mailto:xztx127@outlook.com', note: '不常看' },
  ];

  /* =================== 渲染 =================== */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderGames() {
    var html = GAMES.map(function (g) {
      return '<button class="game-card" onclick="location.href=\'' + g.file + '\'">' +
        '<span class="gc-icon" style="background:' + g.color + '22;border-color:' + g.color + '">' + g.icon + '</span>' +
        '<span class="gc-name">' + esc(g.name) + '</span>' +
        '<span class="gc-en">' + esc(g.en) + '</span>' +
        '<span class="gc-tag">' + esc(g.tag) + '</span>' +
      '</button>';
    }).join('');
    $('#games-grid').innerHTML = html;
  }

  function modCard(m) {
    var tags = m.tags.map(function (t) { return '<span class="mod-tag">' + esc(t) + '</span>'; }).join('');
    return '<div class="mod-card">' +
      '<div class="mod-icon">' + m.icon + '</div>' +
      '<div class="mod-body">' +
        '<div class="mod-title">' + esc(m.name) + ' <span class="mod-en">' + esc(m.en) + '</span></div>' +
        '<div class="mod-tags">' + tags + '<span class="mod-dl">⬇ ' + esc(m.dl) + '</span></div>' +
        '<div class="mod-desc">' + esc(m.desc) + '</div>' +
      '</div>' +
      // 关键：点“下载”才跳转，平时不跳
      '<button class="mc-btn sm mod-btn" onclick="MCArcade.openMod(\'' + m.url + '\')">下载</button>' +
    '</div>';
  }

  function renderMods() {
    $('#mods-list').innerHTML =
      '<h3 class="mod-section-title">模组 · Mods</h3>' +
      MODS.map(modCard).join('') +
      '<h3 class="mod-section-title">整合包 · Modpacks</h3>' +
      MODPACKS.map(modCard).join('');
  }

  function renderContacts() {
    var html = CONTACTS.map(function (c) {
      var inner =
        '<span class="ct-icon">' + c.icon + '</span>' +
        '<span class="ct-body"><span class="ct-label">' + esc(c.label) + (c.note ? ' <i>' + esc(c.note) + '</i>' : '') + '</span>' +
        '<span class="ct-value">' + esc(c.value) + '</span></span>';
      if (c.href) {
        return '<a class="contact-card" href="' + c.href + '" target="_blank" rel="noopener">' + inner + '</a>';
      }
      // 没有链接的（Discord）→ 点击复制用户名
      return '<button class="contact-card" onclick="MCArcade.copy(\'' + esc(c.value) + '\')">' + inner + '</button>';
    }).join('');
    $('#contacts-grid').innerHTML = html;
  }

  /* =================== 标签页 =================== */
  function showTab(name) {
    ['games', 'mods', 'contact'].forEach(function (t) {
      var on = (t === name);
      var tabEl = $('#tab-' + t), panEl = $('#panel-' + t);
      if (tabEl) tabEl.classList.toggle('on', on);
      if (panEl) panEl.style.display = on ? 'block' : 'none';
    });
  }

  /* =================== 对外接口 =================== */
  function notif(msg) {
    var box = $('#mc-notifs');
    var el = document.createElement('div');
    el.className = 'mc-notif';
    el.textContent = '✔ ' + msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  var MCArcade = {
    tab: showTab,
    openMod: function (url) { window.open(url, '_blank', 'noopener'); },
    copy: function (text) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { notif('已复制：' + text); });
      } else { notif(text); }
    }
  };
  global.MCArcade = MCArcade;

  document.addEventListener('DOMContentLoaded', function () {
    renderGames();
    renderMods();
    renderContacts();
    if (global.MCSplash) MCSplash.mount($('#arcade-splash'));
    showTab('games');
  });
})(window);

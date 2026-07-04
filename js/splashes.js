/* =====================================================================
   splashes.js  ·  悬浮标语（致敬 MC 主菜单的黄色跳动标语）
   用法：
     MCSplash.mount(el)        给某个 .mc-splash 元素填入随机标语
     点击标语会随机切换下一条
   ===================================================================== */
(function (global) {
  'use strict';

  // 一大堆标语：经典 MC 梗 + 本服务器/作者梗，随机出现
  var SPLASHES = [
    '内网专属！',
    '永久免费！',
    '也可以联机！',         // 玩笑
    '挖泥土掉神器！',
    '彩虹神剑 5000 伤害！',
    '26 种 TNT 等你引爆！',
    '万物皆可图腾！',
    '150 个中国英雄成就！',
    '帧数拉满！',
    '由 CoreTweaker127 制作',
    '关注我的 Bilibili！',
    '记得给 Modrinth 点赞！',
    '俄罗斯方块永不过时',
    '试试 12 个小游戏！',
    '我不是人类……？',
    '别点退出游戏',
    '这是网页，退不掉的 :)',
    '苦力怕在你身后！',
    '又是被史莱姆包围的一天',
    'TNT 已就位',
    '钻石！钻石！',
    '小心脚下的岩浆',
    '记得睡觉跳过夜晚',
    '末影龙瑟瑟发抖',
    '100% 纯手写代码',
    '0 个广告',
    '加载速度飞快！',
    '像素风永流传',
    '按 F 进入飞行',
    'Java 版 1.20.1',
    '今天也要开心搭建',
    '你好，建筑师！',
    '你好，冒险家！',
    '你好，红石工程师！',
    '世界种子：1337',
    '别忘了保存文件',
    '缓存存储，离线可用',
    'GG！',
    'wow.',
    '哞～',
    '这条标语是随机的',
    '点我换一条！',
  ];

  function pick(exclude) {
    var s;
    do { s = SPLASHES[(Math.random() * SPLASHES.length) | 0]; }
    while (s === exclude && SPLASHES.length > 1);
    return s;
  }

  var MCSplash = {
    list: SPLASHES,
    random: pick,
    mount: function (el) {
      if (!el) return;
      el.textContent = pick();
      el.title = '点击换一条';
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () {
        el.textContent = pick(el.textContent);
      });
    }
  };

  global.MCSplash = MCSplash;
})(window);

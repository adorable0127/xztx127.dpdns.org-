/* =====================================================================
   panorama.js  ·  标题界面背景全景
   用 canvas 画一个像素风的缓慢平移世界：渐变天空 + 太阳 + 多层云 +
   视差远山，模拟 MC 1.20.1 主菜单那张缓缓旋转的全景图。
   轻量：限制 30fps、低分辨率离屏放大、切到后台自动暂停。
   用法： MCPanorama.start('canvasId')
   ===================================================================== */
(function (global) {
  'use strict';

  function start(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    // 离屏低分辨率画布（像素风 + 性能）
    var RW = 320, RH = 180;
    var buf = document.createElement('canvas');
    buf.width = RW; buf.height = RH;
    var bx = buf.getContext('2d');
    bx.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;

    // 简易 1D 值噪声，做山的轮廓
    function makeHills(seed, points) {
      var rng = mulberry32(seed);
      var arr = [];
      for (var i = 0; i < points; i++) arr.push(rng());
      return arr;
    }
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function sampleHills(arr, x) {
      var n = arr.length;
      var fx = ((x % n) + n) % n;
      var i0 = Math.floor(fx), i1 = (i0 + 1) % n;
      var t = fx - i0;
      t = t * t * (3 - 2 * t);                 // smoothstep
      return arr[i0] * (1 - t) + arr[i1] * t;
    }

    // 三层远山（越远越淡、越慢）
    var layers = [
      { hills: makeHills(11, 24), base: 0.62, amp: 26, color: '#6f8f4a', speed: 0.006, scale: 0.06 },
      { hills: makeHills(37, 20), base: 0.72, amp: 34, color: '#54743a', speed: 0.012, scale: 0.05 },
      { hills: makeHills(91, 16), base: 0.84, amp: 40, color: '#3c5a2a', speed: 0.022, scale: 0.04 },
    ];

    // 云（像素团）
    var clouds = [];
    var crng = mulberry32(7);
    for (var i = 0; i < 7; i++) {
      clouds.push({
        x: crng() * RW,
        y: 14 + crng() * 46,
        w: 22 + crng() * 30,
        h: 7 + crng() * 6,
        spd: 0.05 + crng() * 0.08
      });
    }

    var pan = 0;             // 全景平移量
    var last = 0;
    var FRAME = 1000 / 30;   // 限速 30fps

    function draw() {
      // 天空渐变
      var g = bx.createLinearGradient(0, 0, 0, RH);
      g.addColorStop(0, '#4a90d9');
      g.addColorStop(0.5, '#79b4e6');
      g.addColorStop(1, '#bcdcf2');
      bx.fillStyle = g;
      bx.fillRect(0, 0, RW, RH);

      // 太阳
      bx.fillStyle = '#fff6c8';
      var sunX = RW - 58, sunY = 36;
      bx.fillRect(sunX, sunY, 16, 16);
      bx.fillStyle = 'rgba(255,246,200,0.35)';
      bx.fillRect(sunX - 4, sunY - 4, 24, 24);

      // 云
      bx.fillStyle = 'rgba(255,255,255,0.92)';
      for (var c = 0; c < clouds.length; c++) {
        var cl = clouds[c];
        cl.x -= cl.spd;
        if (cl.x + cl.w < 0) { cl.x = RW + 10; cl.y = 14 + crng() * 46; }
        // 用几个方块拼出云朵
        bx.fillRect(cl.x | 0, cl.y | 0, cl.w | 0, cl.h | 0);
        bx.fillRect((cl.x + cl.w * 0.25) | 0, (cl.y - cl.h * 0.6) | 0, (cl.w * 0.5) | 0, (cl.h * 0.7) | 0);
      }

      // 远山（从远到近覆盖）
      for (var l = 0; l < layers.length; l++) {
        var L = layers[l];
        bx.fillStyle = L.color;
        bx.beginPath();
        bx.moveTo(0, RH);
        for (var x = 0; x <= RW; x += 4) {
          var hv = sampleHills(L.hills, (x + pan * L.speed * 1000) * L.scale);
          var y = RH * L.base - hv * L.amp;
          bx.lineTo(x, y);
        }
        bx.lineTo(RW, RH);
        bx.closePath();
        bx.fill();
      }

      // 放大到屏幕（像素化）
      ctx.drawImage(buf, 0, 0, RW, RH, 0, 0, canvas.width, canvas.height);
    }

    function resize() {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      ctx.imageSmoothingEnabled = false;
    }

    function loop(now) {
      requestAnimationFrame(loop);
      if (document.hidden) return;
      if (now - last < FRAME) return;
      last = now;
      pan += 0.016;
      draw();
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  global.MCPanorama = { start: start };
})(window);

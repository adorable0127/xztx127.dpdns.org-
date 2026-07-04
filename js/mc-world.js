/* =====================================================================
   mc-world.js  ·  MC 网页模拟版 1.20.1 引擎（完整重写版）
   ---------------------------------------------------------------------
   体素世界 + 昼夜 + 生存/创造 + 完整背包/合成/工具/武器/盔甲 +
   多生物（各具特性）+ Boss + 多维度 + 可用传送门 + 聊天指令 +
   自定义种子 + 世界导出/导入(.json) + 性能优化。
   依赖：Three.js r128（由 mc.html 通过 CDN 引入）。
   ===================================================================== */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    var ot0 = document.getElementById('ovText');
    if (ot0) ot0.textContent = '无法加载 Three.js（需要联网），请检查网络后刷新。';
    return;
  }

  /* ============================================================
     0. 世界常量
     ============================================================ */
  const CHUNK = 16;
  const WORLD_H = 64;
  const SEA = 22;                       // 海平面
  const RENDER_CHUNKS = 5;              // 玩家周围渲染半径（区块）— 无限地形按需流式加载
  const REACH = 5.4;
  const GRAVITY = 26, JUMP = 8.4, WALK = 4.6, SPRINT = 6.6, FLY_SPEED = 11;
  const PW = 0.3, EYE = 1.62, PHEAD = 0.2;
  const DAY_LENGTH = 600;               // 一整天秒数（约 10 分钟，更接近原版节奏）

  /* ============================================================
     1. 方块注册表
     ============================================================ */
  const B = {};                         // 名称 -> id
  const BLOCKS = [];                    // id -> 定义
  let _bid = 0;
  function defBlock(name, opts) {
    opts = opts || {};
    const id = _bid++;
    B[name] = id;
    BLOCKS[id] = Object.assign({
      id, name,
      solid: true,            // 是否阻挡移动
      opaque: true,           // 是否完全遮挡（用于面剔除）
      light: 0,               // 自发光 0..15
      liquid: false,
      hardness: 1.0,          // 挖掘基础时间（秒，徒手）
      tool: null,             // 'pickaxe'|'axe'|'shovel'|'sword'|null（最佳工具）
      needs: null,            // 需要的最低工具材质等级才掉落，如 'stone'
      drop: id,               // 掉落物品 id（默认掉自己）；null=不掉
      tiles: null,            // {top,side,bottom} 图集序号
      color: 0xffffff,        // 粒子/图标兜底色
      flammable: false,
    }, opts);
    return id;
  }

  // 图集序号将于 buildAtlas 内统一绘制；这里先用占位常量
  // tiles 用对象，值是图集 tile 索引
  // ---- 基础地形 ----
  defBlock('air', { solid: false, opaque: false, hardness: 0, drop: null });
  defBlock('grass',     { tool: 'shovel', hardness: 0.6, color: 0x6aa840 });
  defBlock('dirt',      { tool: 'shovel', hardness: 0.5, color: 0x6b4f34 });
  defBlock('stone',     { tool: 'pickaxe', needs: 'wood', hardness: 1.5, drop: -1 /* cobblestone, 解析后填 */, color: 0x828282 });
  defBlock('cobblestone',{ tool: 'pickaxe', needs: 'wood', hardness: 2.0, color: 0x7a7a7a });
  defBlock('sand',      { tool: 'shovel', hardness: 0.5, color: 0xe4d7a4 });
  defBlock('gravel',    { tool: 'shovel', hardness: 0.6, color: 0x8a8079 });
  defBlock('bedrock',   { hardness: -1, drop: null, color: 0x2b2b2b });   // 不可破坏
  defBlock('water',     { solid: false, opaque: false, liquid: true, hardness: 0, drop: null, color: 0x2f6dd0 });
  defBlock('lava',      { solid: false, opaque: false, liquid: true, light: 14, hardness: 0, drop: null, color: 0xff7a1a });
  // ---- 树木 ----
  defBlock('log',       { tool: 'axe', hardness: 2.0, flammable: true, color: 0x6b4f2f });
  defBlock('leaves',    { tool: null, hardness: 0.3, opaque: false, flammable: true, drop: null, color: 0x3f6e2a });
  defBlock('planks',    { tool: 'axe', hardness: 2.0, flammable: true, color: 0xb08a4f });
  // ---- 矿石 ----
  defBlock('coal_ore',  { tool: 'pickaxe', needs: 'wood',  hardness: 3.0, drop: null /*coal item*/, color: 0x2f2f2f });
  defBlock('iron_ore',  { tool: 'pickaxe', needs: 'stone', hardness: 3.0, color: 0xd8af90 });
  defBlock('gold_ore',  { tool: 'pickaxe', needs: 'iron',  hardness: 3.0, color: 0xe8d24a });
  defBlock('diamond_ore',{ tool: 'pickaxe', needs: 'iron', hardness: 3.5, drop: null /*diamond item*/, color: 0x4ad6e8 });
  // ---- 功能方块 ----
  defBlock('crafting_table', { tool: 'axe', hardness: 2.0, flammable: true, color: 0xa9743a });
  defBlock('furnace',   { tool: 'pickaxe', needs: 'wood', hardness: 3.0, color: 0x6f6f6f });
  defBlock('chest',     { tool: 'axe', hardness: 2.0, flammable: true, color: 0x8a5a2a });
  defBlock('torch',     { solid: false, opaque: false, light: 14, hardness: 0, color: 0xffd060 });
  defBlock('glass',     { opaque: false, hardness: 0.3, drop: null, color: 0xbfe0ff });
  defBlock('glowstone', { tool: 'pickaxe', light: 15, hardness: 0.8, color: 0xffd83d });
  defBlock('obsidian',  { tool: 'pickaxe', needs: 'diamond', hardness: 12, color: 0x1c1430 });
  // ---- 下界 / 末地 ----
  defBlock('netherrack',{ tool: 'pickaxe', needs: 'wood', hardness: 0.8, color: 0x6e2b2b });
  defBlock('soul_sand', { tool: 'shovel', hardness: 0.7, color: 0x4a3826 });
  defBlock('endstone',  { tool: 'pickaxe', needs: 'wood', hardness: 1.2, color: 0xd8d6a8 });
  defBlock('portal',    { solid: false, opaque: false, light: 11, hardness: -1, drop: null, color: 0x9b30d6 });   // 下界传送门
  defBlock('end_portal',{ solid: false, opaque: false, light: 8, hardness: -1, drop: null, color: 0x081018 });    // 末地传送门
  defBlock('brick',     { tool: 'pickaxe', needs: 'wood', hardness: 2.0, color: 0x9c5b4b });

  // 解析 drop=-1 占位（stone -> cobblestone）
  BLOCKS[B.stone].drop = B.cobblestone;

  const AIR = B.air;
  const isSolid = id => BLOCKS[id].solid;
  const isOpaque = id => BLOCKS[id].opaque;
  const isLiquid = id => BLOCKS[id].liquid;

  /* ============================================================
     2. 物品注册表（方块物品 + 工具/武器/盔甲/材料/食物）
     ============================================================ */
  const I = {};            // 名称 -> 物品 id
  const ITEMS = [];        // id -> 定义
  let _iid = 0;
  function defItem(name, opts) {
    opts = opts || {};
    const id = _iid++;
    I[name] = id;
    ITEMS[id] = Object.assign({
      id, name,
      label: name,            // 中文显示名
      block: null,            // 若为方块物品，放置的方块 id
      stack: 64,
      kind: 'material',       // material|block|tool|weapon|armor|food
      toolType: null,         // pickaxe|axe|shovel|sword
      tier: null,             // wood|stone|iron|gold|diamond
      mineSpeed: 1,           // 挖掘速度倍率
      attack: 1,              // 攻击伤害
      durability: 0,          // 0=无限
      armorSlot: null,        // head|chest|legs|feet
      armorPts: 0,            // 护甲点
      heal: 0,                // 食物回复饥饿
      color: 0xffffff,
      tile: null,             // 自定义图标用图集 tile（方块物品自动取方块）
    }, opts);
    return id;
  }
  // 工具材质等级（用于 needs 判定）
  const TIER_RANK = { wood: 1, stone: 2, iron: 3, gold: 2, diamond: 4 };
  const TIER_SPEED = { wood: 2, stone: 4, iron: 6, gold: 12, diamond: 8 };
  const TIER_ATK   = { wood: 1, stone: 2, iron: 3, gold: 1, diamond: 4 };
  const TIER_DUR   = { wood: 59, stone: 131, iron: 250, gold: 32, diamond: 1561 };
  const ARMOR_PTS  = { // [head,chest,legs,feet]
    leather: [1,3,2,1], iron: [2,6,5,2], gold: [2,5,3,1], diamond: [3,8,6,3]
  };

  // ---- 方块物品（凡是可获得/可放置的方块都注册同名物品）----
  const blockItemList = ['grass','dirt','stone','cobblestone','sand','gravel','log','leaves','planks',
    'coal_ore','iron_ore','gold_ore','diamond_ore','crafting_table','furnace','chest','torch','glass',
    'glowstone','obsidian','netherrack','soul_sand','endstone','brick','bedrock','water','lava'];
  const BLOCK_LABEL = {
    grass:'草方块', dirt:'泥土', stone:'石头', cobblestone:'圆石', sand:'沙子', gravel:'沙砾',
    log:'橡木原木', leaves:'树叶', planks:'木板', coal_ore:'煤矿石', iron_ore:'铁矿石',
    gold_ore:'金矿石', diamond_ore:'钻石矿石', crafting_table:'工作台', furnace:'熔炉', chest:'箱子',
    torch:'火把', glass:'玻璃', glowstone:'萤石', obsidian:'黑曜石', netherrack:'下界岩',
    soul_sand:'灵魂沙', endstone:'末地石', brick:'红砖块', bedrock:'基岩', water:'水', lava:'岩浆'
  };
  blockItemList.forEach(n => {
    defItem(n, { label: BLOCK_LABEL[n]||n, kind:'block', block: B[n], color: BLOCKS[B[n]].color });
  });

  // ---- 材料/资源 ----
  defItem('stick',   { label:'木棍', color:0x8a6a3a });
  defItem('coal',    { label:'煤炭', color:0x222222 });
  defItem('iron_ingot',  { label:'铁锭', color:0xd8d8d8 });
  defItem('gold_ingot',  { label:'金锭', color:0xffd83d });
  defItem('diamond', { label:'钻石', color:0x4ad6e8 });
  defItem('leather', { label:'皮革', color:0x8a5a2a });
  defItem('flint',   { label:'燧石', color:0x444444 });
  defItem('flint_and_steel', { label:'打火石', kind:'tool', durability:64, color:0xb0b0b0 });
  defItem('ender_pearl', { label:'末影珍珠', color:0x107050, stack:16 });
  defItem('blaze_rod', { label:'烈焰棒', color:0xffb020 });
  defItem('eye_of_ender', { label:'末影之眼', color:0x30c090, stack:16 });

  // ---- 食物 ----
  defItem('apple',     { label:'苹果', kind:'food', heal:4, stack:64, color:0xd13b3b });
  defItem('bread',     { label:'面包', kind:'food', heal:5, color:0xc8a050 });
  defItem('porkchop',  { label:'生猪排', kind:'food', heal:3, color:0xe89aa0 });
  defItem('cooked_porkchop', { label:'熟猪排', kind:'food', heal:8, color:0xc06030 });
  defItem('beef',      { label:'生牛肉', kind:'food', heal:3, color:0xc05858 });
  defItem('cooked_beef',{ label:'牛排', kind:'food', heal:8, color:0x7a4530 });
  defItem('wheat',     { label:'小麦', color:0xe0c060 });

  // ---- 工具/武器（材质 × 类型）----
  function defTool(tier, type, label) {
    const name = tier + '_' + type;
    const isSword = type === 'sword';
    defItem(name, {
      label, kind: isSword ? 'weapon' : 'tool',
      toolType: type, tier,
      mineSpeed: isSword ? 1.5 : TIER_SPEED[tier],
      attack: isSword ? TIER_ATK[tier] + 3 : (type==='axe' ? TIER_ATK[tier]+2 : TIER_ATK[tier]),
      durability: TIER_DUR[tier],
      stack: 1, color: TIER_COLOR(tier)
    });
  }
  function TIER_COLOR(t){ return ({wood:0x9a6b3a, stone:0x8a8a8a, iron:0xd8d8d8, gold:0xffd83d, diamond:0x4ad6e8})[t]; }
  ['wood','stone','iron','gold','diamond'].forEach(t => {
    const T = ({wood:'木',stone:'石',iron:'铁',gold:'金',diamond:'钻石'})[t];
    defTool(t,'pickaxe', T+'镐');
    defTool(t,'axe',     T+'斧');
    defTool(t,'shovel',  T+'锹');
    defTool(t,'sword',   T+'剑');
  });

  // ---- 盔甲（材质 × 部位）----
  function defArmor(mat, slot, label){
    const name = mat + '_' + slot;
    const idx = {head:0,chest:1,legs:2,feet:3}[slot];
    defItem(name, { label, kind:'armor', armorSlot:slot, armorPts:ARMOR_PTS[mat][idx], durability: 80*(idx===1?2:1), stack:1, color: TIER_COLOR(mat==='leather'?'wood':mat) });
  }
  ['leather','iron','gold','diamond'].forEach(mat => {
    const M = ({leather:'皮革',iron:'铁',gold:'金',diamond:'钻石'})[mat];
    defArmor(mat,'head', M+'头盔');
    defArmor(mat,'chest',M+'胸甲');
    defArmor(mat,'legs', M+'护腿');
    defArmor(mat,'feet', M+'靴子');
  });

  // 方块挖掉后掉落的“物品”映射（矿石掉资源）
  const BLOCK_DROP_ITEM = {
    [B.coal_ore]: I.coal,
    [B.diamond_ore]: I.diamond,
    [B.grass]: I.dirt,
  };
  // 矿石需熔炼或直接掉锭的，这里 iron/gold 掉矿石本身，熔炉炼锭
  function blockDropItem(blockId, toolTier){
    const def = BLOCKS[blockId];
    if (def.drop === null) return null;
    if (def.needs && (TIER_RANK[toolTier]||0) < TIER_RANK[def.needs]) return null; // 工具不够，不掉
    if (BLOCK_DROP_ITEM[blockId] != null) return BLOCK_DROP_ITEM[blockId];
    const dropBlock = (def.drop != null ? def.drop : blockId);
    const itemName = BLOCKS[dropBlock].name;
    return I[itemName] != null ? I[itemName] : null;
  }

  /* ============================================================
     3. 合成表 / 熔炼表
     ============================================================ */
  // 无序合成：{ need:{itemId:count,...}, out:[itemId,count], grid:bool(是否需要3x3工作台) }
  const RECIPES = [];
  function R(out, count, need, big){ RECIPES.push({ out:I[out], count, need:mapNeed(need), big:!!big }); }
  function mapNeed(o){ const m={}; for (const k in o) m[I[k]] = o[k]; return m; }
  R('planks', 4, { log:1 });
  R('stick', 4, { planks:2 });
  R('crafting_table', 1, { planks:4 });
  R('torch', 4, { coal:1, stick:1 });
  R('furnace', 1, { cobblestone:8 }, true);
  R('chest', 1, { planks:8 }, true);
  R('glass', 1, { sand:1 });            // 简化：合成台直接成玻璃（实际应熔炼，这里也保留熔炼）
  R('bread', 1, { wheat:3 }, true);
  R('flint_and_steel', 1, { iron_ingot:1, flint:1 });
  R('eye_of_ender', 1, { ender_pearl:1, blaze_rod:1 });
  // 工具/武器（big）
  function craftTool(tier, type, mat){
    const out = tier+'_'+type;
    let need;
    if (type==='pickaxe') need = { [mat]:3, stick:2 };
    else if (type==='axe') need = { [mat]:3, stick:2 };
    else if (type==='shovel') need = { [mat]:1, stick:2 };
    else need = { [mat]:2, stick:1 }; // sword
    RECIPES.push({ out:I[out], count:1, need:mapNeed(need), big:true });
  }
  const TIER_MAT = { wood:'planks', stone:'cobblestone', iron:'iron_ingot', gold:'gold_ingot', diamond:'diamond' };
  ['wood','stone','iron','gold','diamond'].forEach(t=>{
    ['pickaxe','axe','shovel','sword'].forEach(ty=>craftTool(t,ty,TIER_MAT[t]));
  });
  // 盔甲
  function craftArmor(mat, slot){
    const matItem = ({leather:'leather',iron:'iron_ingot',gold:'gold_ingot',diamond:'diamond'})[mat];
    const cnt = {head:5,chest:8,legs:7,feet:4}[slot];
    RECIPES.push({ out:I[mat+'_'+slot], count:1, need:mapNeed({[matItem]:cnt}), big:true });
  }
  ['leather','iron','gold','diamond'].forEach(m=>['head','chest','legs','feet'].forEach(s=>craftArmor(m,s)));

  // 熔炼表：input item -> output item
  const SMELT = {
    [I.iron_ore]: I.iron_ingot,
    [I.gold_ore]: I.gold_ingot,
    [I.sand]: I.glass,
    [I.porkchop]: I.cooked_porkchop,
    [I.beef]: I.cooked_beef,
    [I.cobblestone]: I.stone,
  };

  /* ============================================================
     4. 噪声（地形）
     ============================================================ */
  let perm = new Uint8Array(512);
  let WORLD_SEED = 1337;
  function initNoise(seed) {
    WORLD_SEED = seed >>> 0;
    const p = []; for (let i = 0; i < 256; i++) p[i] = i;
    let s = WORLD_SEED || 1;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  function grad2(h, x, y){ switch(h&3){case 0:return x+y;case 1:return -x+y;case 2:return x-y;default:return -x-y;} }
  function perlin2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const aa = perm[perm[X]+Y], ab = perm[perm[X]+Y+1], ba = perm[perm[X+1]+Y], bb = perm[perm[X+1]+Y+1];
    return lerp(lerp(grad2(aa,x,y),grad2(ba,x-1,y),u), lerp(grad2(ab,x,y-1),grad2(bb,x-1,y-1),u), v);
  }
  function fbm(x,y,oct){ let amp=1,f=1,sum=0,norm=0; oct=oct||4; for(let o=0;o<oct;o++){sum+=amp*perlin2(x*f,y*f);norm+=amp;amp*=0.5;f*=2;} return sum/norm; }
  function hash2(x,z){ let n=(x*374761393 + z*668265263 + (WORLD_SEED|0)*2147483647)|0; n=(n^(n>>13))*1274126177; n=n^(n>>16); return (n>>>0)/4294967296; }
  function hash3(x,y,z){ let n=(x*374761393 + y*1103515245 + z*668265263 + (WORLD_SEED|0))|0; n=(n^(n>>13))*1274126177; n=n^(n>>16); return (n>>>0)/4294967296; }

  /* ============================================================
     5. 像素纹理图集
     ============================================================ */
  const TILE = {};         // 名称 -> 图集索引
  let _tileN = 0;
  let atlasCanvas, blockTex, blockMaterial, blockMaterialT; // T=透明（树叶/玻璃）
  let ATLAS_TILES = 0;
  const rc = a => a[(Math.random()*a.length)|0];
  function noiseRect(ctx, ox, w, h, cols){ for(let y=0;y<h;y++)for(let x=0;x<w;x++){ctx.fillStyle=rc(cols);ctx.fillRect(ox+x,y,1,1);} }
  function flecks(ctx, ox, n, col){ for(let i=0;i<n;i++){ctx.fillStyle=col;ctx.fillRect(ox+(Math.random()*16|0),(Math.random()*16|0),1,1);} }

  function tnext(name){ TILE[name]=_tileN++; return TILE[name]; }
  function buildAtlas() {
    // 预声明所有 tile 名称（顺序即索引）
    const names = ['grass_top','grass_side','dirt','stone','cobble','sand','gravel','bedrock',
      'log_side','log_top','leaves','planks','coal','iron_ore','gold_ore','diamond_ore',
      'craft_top','craft_side','furnace_front','furnace_side','chest','glass','glow','obsid',
      'netherrack','soulsand','endstone','brick','water','lava','portal','endportal','torch'];
    names.forEach(tnext);
    ATLAS_TILES = _tileN;
    const TS = 16;
    const cv = document.createElement('canvas'); cv.width = TS*ATLAS_TILES; cv.height = TS;
    const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const ox = n => TILE[n]*TS;

    noiseRect(ctx, ox('grass_top'),16,16,['#6aa840','#5f9d39','#74b24a','#5a9433','#67a23d']);
    noiseRect(ctx, ox('grass_side'),16,16,['#6b4f34','#5f4630','#765a3c','#5a4029']);
    noiseRect(ctx, ox('grass_side'),16,5,['#6aa840','#5f9d39','#74b24a']);
    noiseRect(ctx, ox('dirt'),16,16,['#6b4f34','#5f4630','#765a3c','#5a4029']);
    noiseRect(ctx, ox('stone'),16,16,['#828282','#777777','#8c8c8c','#6f6f6f']); flecks(ctx,ox('stone'),10,'#5f5f5f');
    noiseRect(ctx, ox('cobble'),16,16,['#6f6f6f','#828282','#5c5c5c','#909090']);
    for(let i=0;i<22;i++){ctx.fillStyle='#4f4f4f';ctx.fillRect(ox('cobble')+(Math.random()*15|0),(Math.random()*15|0),2,1);}
    noiseRect(ctx, ox('sand'),16,16,['#e4d7a4','#ddcf98','#ecdfae','#d8caa0']);
    noiseRect(ctx, ox('gravel'),16,16,['#8a8079','#7a716b','#968c84','#6f6760']); flecks(ctx,ox('gravel'),14,'#5a534e');
    noiseRect(ctx, ox('bedrock'),16,16,['#2b2b2b','#383838','#1f1f1f','#444444']);
    noiseRect(ctx, ox('log_side'),16,16,['#6b4f2f','#5e452a','#765a37']);
    for(let x=0;x<16;x++) if(x%4<2) for(let y=0;y<16;y++) if(Math.random()<0.5){ctx.fillStyle=rc(['#523a22','#5e452a']);ctx.fillRect(ox('log_side')+x,y,1,1);}
    { const o=ox('log_top'); for(let y=0;y<16;y++)for(let x=0;x<16;x++){const d=Math.max(Math.abs(x-7.5),Math.abs(y-7.5));ctx.fillStyle=(Math.floor(d)%2===0)?'#a3793f':'#8a6a3a';ctx.fillRect(o+x,y,1,1);} ctx.fillStyle='#6f5126';ctx.fillRect(o+7,7,2,2); }
    noiseRect(ctx, ox('leaves'),16,16,['#3f6e2a','#356024','#487d30','#2f5520','#3a652a']); flecks(ctx,ox('leaves'),14,'#264417');
    noiseRect(ctx, ox('planks'),16,16,['#b08a4f','#a07f48','#bd9456','#9a7842']);
    for(let y=3;y<16;y+=5){ctx.fillStyle='#7d6234';ctx.fillRect(ox('planks'),y,16,1);}
    noiseRect(ctx, ox('coal'),16,16,['#828282','#777777','#8c8c8c']);
    for(let i=0;i<10;i++){ctx.fillStyle='#1c1c1c';const x=Math.random()*13|0,y=Math.random()*13|0;ctx.fillRect(ox('coal')+x,y,3,2);}
    noiseRect(ctx, ox('iron_ore'),16,16,['#828282','#777777','#8c8c8c']);
    for(let i=0;i<8;i++){ctx.fillStyle='#d8a878';ctx.fillRect(ox('iron_ore')+(Math.random()*13|0),(Math.random()*13|0),3,2);}
    noiseRect(ctx, ox('gold_ore'),16,16,['#828282','#777777','#8c8c8c']);
    for(let i=0;i<8;i++){ctx.fillStyle='#f2d23a';ctx.fillRect(ox('gold_ore')+(Math.random()*13|0),(Math.random()*13|0),3,2);}
    noiseRect(ctx, ox('diamond_ore'),16,16,['#828282','#777777','#8c8c8c']);
    for(let i=0;i<8;i++){ctx.fillStyle='#4ce6f0';ctx.fillRect(ox('diamond_ore')+(Math.random()*13|0),(Math.random()*13|0),3,2);}
    // 工作台
    noiseRect(ctx, ox('craft_top'),16,16,['#b08a4f','#a07f48','#bd9456']);
    ctx.fillStyle='#5d4527'; ctx.fillRect(ox('craft_top')+1,1,14,2); ctx.fillRect(ox('craft_top')+1,1,2,14);
    ctx.strokeStyle='#5d4527'; for(let i=4;i<16;i+=4){ctx.fillRect(ox('craft_top')+i,0,1,16);ctx.fillRect(ox('craft_top'),i,16,1);}
    noiseRect(ctx, ox('craft_side'),16,16,['#a07f48','#8a6a38','#b08a4f']);
    ctx.fillStyle='#6b4f2f'; ctx.fillRect(ox('craft_side')+2,2,5,5); ctx.fillRect(ox('craft_side')+9,9,5,5);
    // 熔炉
    noiseRect(ctx, ox('furnace_side'),16,16,['#6f6f6f','#5c5c5c','#828282']);
    noiseRect(ctx, ox('furnace_front'),16,16,['#6f6f6f','#5c5c5c','#828282']);
    ctx.fillStyle='#2a2a2a'; ctx.fillRect(ox('furnace_front')+4,6,8,7);
    ctx.fillStyle='#ff8a1f'; ctx.fillRect(ox('furnace_front')+6,10,4,3);
    // 箱子
    noiseRect(ctx, ox('chest'),16,16,['#8a5a2a','#7a4f24','#96632f']);
    ctx.fillStyle='#5d3a18'; ctx.strokeRect(ox('chest')+1,1,14,14); ctx.fillRect(ox('chest')+1,7,14,2);
    ctx.fillStyle='#3a3a3a'; ctx.fillRect(ox('chest')+7,6,2,4);
    // 玻璃
    ctx.clearRect(ox('glass'),0,16,16);
    ctx.strokeStyle='rgba(220,240,255,0.9)'; ctx.lineWidth=1; ctx.strokeRect(ox('glass')+0.5,0.5,15,15);
    ctx.fillStyle='rgba(200,230,255,0.25)'; ctx.fillRect(ox('glass')+1,1,14,14);
    ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillRect(ox('glass')+3,3,2,6);
    // 萤石
    noiseRect(ctx, ox('glow'),16,16,['#e8c84a','#ffe066','#d6b62e','#ffd83d']); flecks(ctx,ox('glow'),10,'#a8841a');
    // 黑曜石
    noiseRect(ctx, ox('obsid'),16,16,['#1c1430','#241a3e','#160f28','#2a1f48']); flecks(ctx,ox('obsid'),8,'#3d2c66');
    // 下界岩
    noiseRect(ctx, ox('netherrack'),16,16,['#6e2b2b','#7a3030','#5e2424','#8a3636']); flecks(ctx,ox('netherrack'),12,'#3e1414');
    // 灵魂沙
    noiseRect(ctx, ox('soulsand'),16,16,['#4a3826','#3e2f20','#564330']);
    for(let i=0;i<4;i++){ctx.fillStyle='#2a2016';ctx.fillRect(ox('soulsand')+(Math.random()*12|0),(Math.random()*12|0),3,3);}
    // 末地石
    noiseRect(ctx, ox('endstone'),16,16,['#d8d6a8','#e6e4b6','#cfcd9e','#ddd9ad']); flecks(ctx,ox('endstone'),10,'#bdb98a');
    // 红砖
    noiseRect(ctx, ox('brick'),16,16,['#9c5b4b','#8a4f42','#a86355']);
    ctx.fillStyle='#c8b8a8'; for(let y=0;y<16;y+=4)ctx.fillRect(ox('brick'),y,16,1);
    for(let y=0;y<16;y+=8){for(let x=0;x<16;x+=8){ctx.fillRect(ox('brick')+x,y,1,4);} for(let x=4;x<16;x+=8){ctx.fillRect(ox('brick')+x,y+4,1,4);}}
    // 水
    noiseRect(ctx, ox('water'),16,16,['#2f6dd0','#2860c0','#3a78da']);
    // 岩浆
    noiseRect(ctx, ox('lava'),16,16,['#e8650f','#ff8a1f','#d65200','#ffae3d']); flecks(ctx,ox('lava'),8,'#ffd96b');
    // 传送门
    noiseRect(ctx, ox('portal'),16,16,['#9b30d6','#7a1fb0','#b450e6','#6a18a0']);
    // 末地传送门
    ctx.fillStyle='#081018'; ctx.fillRect(ox('endportal'),0,16,16);
    for(let i=0;i<14;i++){ctx.fillStyle=rc(['#a0e0d0','#60c0a0','#ffffff']);ctx.fillRect(ox('endportal')+(Math.random()*16|0),(Math.random()*16|0),1,1);}
    // 火把
    ctx.clearRect(ox('torch'),0,16,16);
    ctx.fillStyle='#6b4f2f'; ctx.fillRect(ox('torch')+7,6,2,9);
    ctx.fillStyle='#ffd060'; ctx.fillRect(ox('torch')+7,3,2,3);
    ctx.fillStyle='#fff0a0'; ctx.fillRect(ox('torch')+7,3,2,1);

    atlasCanvas = cv;
    blockTex = new THREE.CanvasTexture(cv);
    blockTex.magFilter = THREE.NearestFilter; blockTex.minFilter = THREE.NearestFilter; blockTex.generateMipmaps = false;
    blockMaterial = new THREE.MeshLambertMaterial({ map: blockTex });
    blockMaterialT = new THREE.MeshLambertMaterial({ map: blockTex, transparent:true, alphaTest:0.3, side:THREE.DoubleSide });

    // 方块 -> tiles 映射（用 buildAtlas 后的 TILE 索引）
    setBlockTiles();
  }

  function setBlockTiles(){
    const T = TILE;
    const set = (name, top, side, bottom) => { BLOCKS[B[name]].tiles = { top, side, bottom: bottom!=null?bottom:side }; };
    set('grass', T.grass_top, T.grass_side, T.dirt);
    set('dirt', T.dirt, T.dirt);
    set('stone', T.stone, T.stone);
    set('cobblestone', T.cobble, T.cobble);
    set('sand', T.sand, T.sand);
    set('gravel', T.gravel, T.gravel);
    set('bedrock', T.bedrock, T.bedrock);
    set('log', T.log_top, T.log_side, T.log_top);
    set('leaves', T.leaves, T.leaves);
    set('planks', T.planks, T.planks);
    set('coal_ore', T.coal, T.coal);
    set('iron_ore', T.iron_ore, T.iron_ore);
    set('gold_ore', T.gold_ore, T.gold_ore);
    set('diamond_ore', T.diamond_ore, T.diamond_ore);
    set('crafting_table', T.craft_top, T.craft_side, T.planks);
    set('furnace', T.furnace_side, T.furnace_front, T.furnace_side);
    set('chest', T.chest, T.chest);
    set('torch', T.torch, T.torch);
    set('glass', T.glass, T.glass);
    set('glowstone', T.glow, T.glow);
    set('obsidian', T.obsid, T.obsid);
    set('netherrack', T.netherrack, T.netherrack);
    set('soul_sand', T.soulsand, T.soulsand);
    set('endstone', T.endstone, T.endstone);
    set('brick', T.brick, T.brick);
    set('water', T.water, T.water);
    set('lava', T.lava, T.lava);
    set('portal', T.portal, T.portal);
    set('end_portal', T.endportal, T.endportal);
  }

  /* ---- 物品图标（缓存）---- */
  const iconCache = {};
  function itemIcon(itemId){
    if (iconCache[itemId]) return iconCache[itemId];
    const it = ITEMS[itemId];
    const s = 32;
    const cv = document.createElement('canvas'); cv.width=s; cv.height=s;
    const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled=false;
    if (it.block != null && BLOCKS[it.block].tiles){
      const tile = BLOCKS[it.block].tiles.side;
      ctx.drawImage(atlasCanvas, tile*16,0,16,16, 0,0,s,s);
    } else {
      drawItemGlyph(ctx, it, s);
    }
    const url = cv.toDataURL();
    iconCache[itemId] = url; return url;
  }
  // 简易矢量风格物品图标（工具/材料/食物）
  function drawItemGlyph(ctx, it, s){
    const col = '#'+(it.color>>>0).toString(16).padStart(6,'0');
    const handle = '#7a5a30';
    ctx.lineCap='round';
    if (it.kind==='tool' || it.kind==='weapon'){
      // 手柄
      ctx.strokeStyle=handle; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(8,26); ctx.lineTo(20,12); ctx.stroke();
      ctx.fillStyle=col;
      if (it.toolType==='pickaxe'){ ctx.lineWidth=3; ctx.strokeStyle=col; ctx.beginPath(); ctx.moveTo(13,5); ctx.quadraticCurveTo(20,9,27,7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(13,5); ctx.quadraticCurveTo(8,9,5,15); ctx.stroke(); }
      else if (it.toolType==='axe'){ ctx.beginPath(); ctx.moveTo(18,5); ctx.quadraticCurveTo(27,7,25,16); ctx.lineTo(18,12); ctx.closePath(); ctx.fill(); }
      else if (it.toolType==='shovel'){ ctx.beginPath(); ctx.ellipse(23,8,5,6,0,0,Math.PI*2); ctx.fill(); }
      else if (it.toolType==='sword'){ ctx.strokeStyle=col; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(7,27); ctx.lineTo(24,8); ctx.stroke(); ctx.strokeStyle='#caa84a'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(5,22); ctx.lineTo(12,29); ctx.stroke(); }
    } else if (it.kind==='armor'){
      ctx.fillStyle=col;
      if (it.armorSlot==='head'){ ctx.fillRect(8,8,16,10); ctx.fillRect(8,16,16,8); ctx.clearRect(12,16,8,5); }
      else if (it.armorSlot==='chest'){ ctx.fillRect(7,7,18,16); ctx.clearRect(7,7,4,5); ctx.clearRect(21,7,4,5); }
      else if (it.armorSlot==='legs'){ ctx.fillRect(8,6,16,10); ctx.fillRect(8,16,6,10); ctx.fillRect(18,16,6,10); }
      else { ctx.fillRect(7,14,8,12); ctx.fillRect(17,14,8,12); }
    } else if (it.kind==='food'){
      ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(16,18,9,9,0,0,Math.PI*2); ctx.fill();
      if (it.name.indexOf('apple')>=0){ ctx.strokeStyle='#4a7a20'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(16,10); ctx.lineTo(19,5); ctx.stroke(); }
      ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(12,14,3,4,0,0,Math.PI*2); ctx.fill();
    } else {
      // 材料：圆角块
      ctx.fillStyle=col; roundRect(ctx,8,8,16,16,3); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.25)'; roundRect(ctx,8,8,16,7,3); ctx.fill();
      if (it.name==='stick'){ ctx.clearRect(0,0,s,s); ctx.strokeStyle=col; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(10,26); ctx.lineTo(22,6); ctx.stroke(); }
    }
  }
  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  /* ============================================================
     6. 区块 / 体素存储（无限世界：以 Map 按 chunkKey 存）
     ============================================================ */
  const chunks = new Map();      // "cx,cz" -> {data:Uint8Array, mesh, meshT, cx, cz, dirty, generated}
  const chunkKey = (cx, cz) => cx + ',' + cz;
  const localIdx = (lx, ly, lz) => (ly * CHUNK + lz) * CHUNK + lx;

  function getChunk(cx, cz){ return chunks.get(chunkKey(cx,cz)); }
  function getVoxel(x, y, z){
    if (y < 0 || y >= WORLD_H) return AIR;
    const cx = Math.floor(x/CHUNK), cz = Math.floor(z/CHUNK);
    const c = chunks.get(chunkKey(cx,cz));
    if (!c) return AIR;
    return c.data[localIdx(((x%CHUNK)+CHUNK)%CHUNK, y, ((z%CHUNK)+CHUNK)%CHUNK)];
  }
  function setVoxelRaw(x, y, z, t){
    if (y < 0 || y >= WORLD_H) return;
    const cx = Math.floor(x/CHUNK), cz = Math.floor(z/CHUNK);
    const c = chunks.get(chunkKey(cx,cz));
    if (!c) return;
    c.data[localIdx(((x%CHUNK)+CHUNK)%CHUNK, y, ((z%CHUNK)+CHUNK)%CHUNK)] = t;
  }
  const surfaceY = (x, z) => { for (let y=WORLD_H-1;y>=0;y--){ const v=getVoxel(x,y,z); if (isSolid(v)||v===B.water) return y; } return -1; };
  const topSolidY = (x, z) => { for (let y=WORLD_H-1;y>=0;y--){ if (isSolid(getVoxel(x,y,z))) return y; } return -1; };

  // —— 引擎其余部分见 part2（同文件）——

  /* ============================================================
     7. 区块网格（贪婪面剔除 + 透明分离）
     ============================================================ */
  const PAD = 0.5/16;
  const tileU = (tile, u) => (tile + PAD + u*(1-2*PAD)) / ATLAS_TILES;
  const tileV = v => PAD + v*(1-2*PAD);
  const FACES = [
    { dir:[-1,0,0], corners:[{p:[0,1,0],uv:[0,1]},{p:[0,0,0],uv:[0,0]},{p:[0,1,1],uv:[1,1]},{p:[0,0,1],uv:[1,0]}] },
    { dir:[ 1,0,0], corners:[{p:[1,1,1],uv:[0,1]},{p:[1,0,1],uv:[0,0]},{p:[1,1,0],uv:[1,1]},{p:[1,0,0],uv:[1,0]}] },
    { dir:[0,-1,0], corners:[{p:[1,0,1],uv:[1,0]},{p:[0,0,1],uv:[0,0]},{p:[1,0,0],uv:[1,1]},{p:[0,0,0],uv:[0,1]}] },
    { dir:[0, 1,0], corners:[{p:[0,1,1],uv:[1,1]},{p:[1,1,1],uv:[0,1]},{p:[0,1,0],uv:[1,0]},{p:[1,1,0],uv:[0,0]}] },
    { dir:[0,0,-1], corners:[{p:[1,0,0],uv:[0,0]},{p:[0,0,0],uv:[1,0]},{p:[1,1,0],uv:[0,1]},{p:[0,1,0],uv:[1,1]}] },
    { dir:[0,0, 1], corners:[{p:[0,0,1],uv:[0,0]},{p:[1,0,1],uv:[1,0]},{p:[0,1,1],uv:[0,1]},{p:[1,1,1],uv:[1,1]}] },
  ];
  // 面是否可见：邻块为空气 / 透明非同种 → 可见
  function faceVisible(here, nb){
    if (nb === AIR) return true;
    if (isOpaque(nb)) return false;
    if (nb === here) return false;       // 同种透明（如玻璃挨玻璃、水挨水）不画内面
    return true;
  }

  function buildChunkMesh(c){
    const opaque = { pos:[], nor:[], uv:[], ind:[] };
    const trans  = { pos:[], nor:[], uv:[], ind:[] };
    const ox = c.cx*CHUNK, oz = c.cz*CHUNK;
    for (let ly=0; ly<WORLD_H; ly++)
      for (let lz=0; lz<CHUNK; lz++)
        for (let lx=0; lx<CHUNK; lx++){
          const t = c.data[localIdx(lx,ly,lz)];
          if (t === AIR) continue;
          const def = BLOCKS[t];
          if (def.name==='torch'){ pushTorch(opaque, ox+lx, ly, oz+lz, def); continue; }
          const tgt = def.opaque ? opaque : trans;
          const wx=ox+lx, wy=ly, wz=oz+lz;
          const tiles = def.tiles;
          for (let f=0; f<6; f++){
            const face=FACES[f], d=face.dir;
            const nb = getVoxel(wx+d[0], wy+d[1], wz+d[2]);
            if (!faceVisible(t, nb)) continue;
            const tile = d[1]===1 ? tiles.top : (d[1]===-1 ? tiles.bottom : tiles.side);
            const base = tgt.pos.length/3;
            // 液体略低
            const yoff = (def.liquid && d[1]===1) ? -0.12 : 0;
            for (let k=0;k<4;k++){
              const cor=face.corners[k];
              tgt.pos.push(cor.p[0]+wx, cor.p[1]+wy + (cor.p[1]===1?yoff:0), cor.p[2]+wz);
              tgt.nor.push(d[0],d[1],d[2]);
              tgt.uv.push(tileU(tile,cor.uv[0]), tileV(cor.uv[1]));
            }
            tgt.ind.push(base,base+1,base+2, base+2,base+1,base+3);
          }
        }
    c.mesh = applyGeo(c.mesh, opaque, blockMaterial, c, false);
    c.meshT = applyGeo(c.meshT, trans, blockMaterialT, c, true);
  }
  function pushTorch(tgt, wx, wy, wz, def){
    // 火把画成细柱（4 面 + 顶）
    const tile = TILE.torch;
    const x0=wx+0.43, x1=wx+0.57, z0=wz+0.43, z1=wz+0.57, y0=wy, y1=wy+0.62;
    const quad=(ax,ay,az,bx,by,bz,cx,cy,cz,dx,dy,dz)=>{
      const base=tgt.pos.length/3;
      tgt.pos.push(ax,ay,az,bx,by,bz,cx,cy,cz,dx,dy,dz);
      for(let i=0;i<4;i++)tgt.nor.push(0,1,0);
      tgt.uv.push(tileU(tile,0.4),tileV(0),tileU(tile,0.6),tileV(0),tileU(tile,0.4),tileV(0.62),tileU(tile,0.6),tileV(0.62));
      tgt.ind.push(base,base+1,base+2,base+2,base+1,base+3);
    };
    quad(x0,y0,z0,x1,y0,z0,x0,y1,z0,x1,y1,z0);
    quad(x1,y0,z1,x0,y0,z1,x1,y1,z1,x0,y1,z1);
    quad(x0,y0,z1,x0,y0,z0,x0,y1,z1,x0,y1,z0);
    quad(x1,y0,z0,x1,y0,z1,x1,y1,z0,x1,y1,z1);
  }
  function applyGeo(mesh, data, mat, c, transparent){
    if (data.pos.length===0){ if (mesh){ scene.remove(mesh); mesh.geometry.dispose(); } return null; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.pos,3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(data.nor,3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv,2));
    g.setIndex(data.ind); g.computeBoundingSphere();
    if (mesh){ mesh.geometry.dispose(); mesh.geometry = g; }
    else { mesh = new THREE.Mesh(g, mat); mesh.castShadow=!transparent; mesh.receiveShadow=true; scene.add(mesh); }
    return mesh;
  }
  const dirtyChunks = new Set();
  function markDirty(cx,cz){ const c=getChunk(cx,cz); if(c){ c.dirty=true; dirtyChunks.add(c); } }
  function rebuildDirty(limit){
    let n=0;
    for (const c of dirtyChunks){
      buildChunkMesh(c); c.dirty=false; dirtyChunks.delete(c);
      if (++n>=limit) break;
    }
  }
  // 放置/破坏后即时重建（含邻接）
  function updateVoxel(x,y,z,type){
    setVoxelRaw(x,y,z,type);
    const cx=Math.floor(x/CHUNK), cz=Math.floor(z/CHUNK);
    const lx=((x%CHUNK)+CHUNK)%CHUNK, lz=((z%CHUNK)+CHUNK)%CHUNK;
    const c=getChunk(cx,cz); if(c) buildChunkMesh(c);
    if (lx===0) { const n=getChunk(cx-1,cz); if(n) buildChunkMesh(n); }
    if (lx===CHUNK-1){ const n=getChunk(cx+1,cz); if(n) buildChunkMesh(n); }
    if (lz===0) { const n=getChunk(cx,cz-1); if(n) buildChunkMesh(n); }
    if (lz===CHUNK-1){ const n=getChunk(cx,cz+1); if(n) buildChunkMesh(n); }
  }

  /* ============================================================
     8. 世界生成（无限，按区块）
     ============================================================ */
  let curDim = 'overworld';
  const DIMS = {
    overworld: { name:'主世界', icon:'🌍' },
    nether:    { name:'下界',   icon:'🔥' },
    end:       { name:'末地',   icon:'🌌' },
  };
  // 每个维度+种子保存方块改动（玩家放置/破坏），切回维度时恢复
  // 但因为无限世界 chunk 本身是程序生成，这里直接保留 chunks（按维度命名空间）
  const dimChunks = { overworld:new Map(), nether:new Map(), end:new Map() };

  function biomeAt(x,z){
    const t = fbm(x*0.006+1000, z*0.006+1000, 3);   // 温度
    const m = fbm(x*0.006+5000, z*0.006+5000, 3);   // 湿度
    if (t < -0.25) return 'snow';
    if (t > 0.32 && m < -0.1) return 'desert';
    if (m > 0.25) return 'forest';
    return 'plains';
  }
  function owHeight(x,z){
    const cont = fbm(x*0.0035, z*0.0035, 4);              // 大陆度
    const hill = fbm(x*0.02+99, z*0.02+99, 4);
    const det  = fbm(x*0.08+9, z*0.08+9, 3);
    let h = SEA + 2 + cont*22 + hill*8 + det*3;
    return Math.max(4, Math.min(WORLD_H-8, Math.round(h)));
  }
  function genOverworldChunk(c){
    const ox=c.cx*CHUNK, oz=c.cz*CHUNK;
    for (let lx=0; lx<CHUNK; lx++)
      for (let lz=0; lz<CHUNK; lz++){
        const wx=ox+lx, wz=oz+lz;
        const h = owHeight(wx,wz);
        const bio = biomeAt(wx,wz);
        for (let y=0; y<=Math.max(h,SEA); y++){
          let t = AIR;
          if (y===0) t = B.bedrock;
          else if (y < h-4) t = B.stone;
          else if (y < h) t = (bio==='desert')? B.sand : B.dirt;
          else if (y === h){
            if (bio==='desert') t = B.sand;
            else if (bio==='snow') t = B.grass;
            else if (h < SEA) t = (bio==='plains')? B.gravel : B.dirt;
            else t = B.grass;
          }
          else if (y <= SEA && y > h) t = B.water;
          if (t!==AIR) c.data[localIdx(lx,y,lz)] = t;
        }
        // 海床沙
        if (h < SEA) c.data[localIdx(lx,h,lz)] = (hash2(wx,wz)<0.5? B.sand : B.gravel);
      }
    // 矿石 & 洞穴（基于 3D hash，确定性）
    carveAndOre(c, ox, oz, owHeight);
    // 植被 / 结构
    decorateOverworld(c, ox, oz);
    c.generated = true;
  }
  function carveAndOre(c, ox, oz, hfn){
    for (let lx=0; lx<CHUNK; lx++)
      for (let lz=0; lz<CHUNK; lz++){
        const wx=ox+lx, wz=oz+lz;
        const h = hfn(wx,wz);
        for (let y=1; y<h; y++){
          const cur = c.data[localIdx(lx,y,lz)];
          if (cur!==B.stone && cur!==B.dirt) continue;
          // 洞穴：三维 fbm 阈值
          const cave = fbm(wx*0.05, (y*0.05), 3)*0.5 + fbm((wz*0.05), (y*0.05)+50, 3)*0.5;
          const tunnel = Math.abs(fbm(wx*0.03+7, wz*0.03+7,3) - (y-12)/40);
          if (y>2 && y<h-1 && (cave>0.42 || tunnel<0.03)){ c.data[localIdx(lx,y,lz)] = AIR; continue; }
          if (cur!==B.stone) continue;
          // 矿石分布
          const r = hash3(wx,y,wz);
          if (y<14 && r<0.006) c.data[localIdx(lx,y,lz)] = B.diamond_ore;
          else if (y<28 && r<0.010) c.data[localIdx(lx,y,lz)] = B.gold_ore;
          else if (y<48 && r<0.022) c.data[localIdx(lx,y,lz)] = B.iron_ore;
          else if (r<0.030) c.data[localIdx(lx,y,lz)] = B.coal_ore;
          else if (r<0.038) c.data[localIdx(lx,y,lz)] = B.gravel;
        }
      }
  }
  function decorateOverworld(c, ox, oz){
    for (let lx=0; lx<CHUNK; lx++)
      for (let lz=0; lz<CHUNK; lz++){
        const wx=ox+lx, wz=oz+lz;
        const bio = biomeAt(wx,wz);
        const gy = colTop(c, lx, lz);
        if (gy<0) continue;
        const ground = c.data[localIdx(lx,gy,lz)];
        // 树
        if ((bio==='forest'||bio==='plains') && ground===B.grass && gy>SEA){
          if (hash2(wx*3+1, wz*3+7) < (bio==='forest'?0.06:0.018)){
            growTree(c, ox, oz, lx, gy, lz);
          }
        }
        // 沙漠仙人掌（用 log 充当；简化）— 跳过
        // 草地花/装饰跳过（保持轻量）
      }
    // 结构：村庄房 / 废墟（确定性低概率，按 chunk）
    maybeStructure(c, ox, oz);
  }
  function colTop(c, lx, lz){ for(let y=WORLD_H-1;y>=0;y--){ const v=c.data[localIdx(lx,y,lz)]; if(v!==AIR && v!==B.water) return y;} return -1; }
  function growTree(c, ox, oz, lx, gy, lz){
    const th = 4 + (hash2(ox+lx+5, oz+lz+5)<0.5?0:2);
    const setL = (x,y,z,t)=>{ // 跨区块也写（用全局 setVoxelRaw）
      if (y<0||y>=WORLD_H) return;
      const gx=ox+x, gz=oz+z;
      const ncx=Math.floor(gx/CHUNK), ncz=Math.floor(gz/CHUNK);
      if (ncx===c.cx && ncz===c.cz){ const i=localIdx(x,y,z); if(c.data[i]===AIR||c.data[i]===B.leaves) c.data[i]=t; }
      else { /* 邻块可能未生成，存入挂起列表 */ pushPending(ncx,ncz, gx, y, gz, t); }
    };
    for (let y=gy+1; y<=gy+th; y++) setL(lx,y,lz,B.log);
    const top=gy+th;
    for (let ly=top-1; ly<=top+1; ly++){
      const r = ly<=top?2:1;
      for (let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
        if (Math.abs(dx)===r && Math.abs(dz)===r && hash2(ox+lx+dx*13, oz+lz+dz*7+ly)<0.5) continue;
        setL(lx+dx,ly,lz+dz,B.leaves);
      }
    }
    setL(lx,top+2,lz,B.leaves);
  }
  // 挂起方块（跨区块写入）
  const pending = new Map(); // chunkKey -> [{x,y,z,t}]
  function pushPending(cx,cz,gx,y,gz,t){
    const k=chunkKey(cx,cz);
    if (!pending.has(k)) pending.set(k,[]);
    pending.get(k).push({x:gx,y,z:gz,t});
  }
  function applyPending(c){
    const k=chunkKey(c.cx,c.cz);
    const arr=pending.get(k); if(!arr) return;
    for (const b of arr){ const lx=((b.x%CHUNK)+CHUNK)%CHUNK, lz=((b.z%CHUNK)+CHUNK)%CHUNK; const i=localIdx(lx,b.y,lz); if(c.data[i]===AIR||c.data[i]===B.leaves) c.data[i]=b.t; }
    pending.delete(k);
  }

  // 结构生成：每区块极低概率放一个小建筑
  function maybeStructure(c, ox, oz){
    const roll = hash2(c.cx*131+7, c.cz*197+13);
    const cxw = ox+8, czw = oz+8;
    if (roll < 0.04){
      // 小木屋
      const gy = topSolidYLocal(c, 8, 8);
      if (gy>SEA) buildHut(c, ox, oz, 8, gy+1, 8);
    } else if (roll < 0.06){
      // 废墟石塔
      const gy = topSolidYLocal(c, 8, 8);
      if (gy>SEA) buildRuin(c, ox, oz, 8, gy+1, 8);
    } else if (roll < 0.075){
      // 地表箱子（战利品）
      const gy = topSolidYLocal(c, 8, 8);
      if (gy>0){ c.data[localIdx(8,gy+1,8)] = B.chest; registerChest(ox+8, gy+1, oz+8, lootChest()); }
    }
  }
  function topSolidYLocal(c, lx, lz){ for(let y=WORLD_H-1;y>=0;y--){ const v=c.data[localIdx(lx,y,lz)]; if(isSolid(v)) return y;} return -1; }
  function setIfLocal(c, ox, oz, x, y, z, t){
    if (y<0||y>=WORLD_H) return;
    const gx=ox+x, gz=oz+z, ncx=Math.floor(gx/CHUNK), ncz=Math.floor(gz/CHUNK);
    if (ncx===c.cx && ncz===c.cz) c.data[localIdx(x,y,z)] = t;
    else pushPending(ncx,ncz,gx,y,gz,t);
  }
  function buildHut(c, ox, oz, bx, by, bz){
    const W=5,D=5,H=3;
    for (let x=0;x<W;x++)for(let z=0;z<D;z++)for(let y=0;y<H;y++){
      const edge = (x===0||x===W-1||z===0||z===D-1);
      let t=AIR;
      if (y===0) t=B.planks;
      else if (edge) t=B.planks;
      if (edge && y>0 && ((x===2&&z===0))) t=AIR; // 门
      if (edge && y===1 && (x===0||x===W-1) && z===2) t=B.glass; // 窗
      if (t!==AIR) setIfLocal(c,ox,oz,bx+x,by+y,bz+z,t);
    }
    // 屋顶
    for (let x=-1;x<=W;x++)for(let z=-1;z<=D;z++) setIfLocal(c,ox,oz,bx+x,by+H,bz+z,B.log);
    // 火把 + 箱子
    setIfLocal(c,ox,oz,bx+1,by+1,bz+1,B.torch);
    setIfLocal(c,ox,oz,bx+3,by+1,bz+3,B.chest);
    registerChest(ox+bx+3, by+1, oz+bz+3, lootChest());
    setIfLocal(c,ox,oz,bx+2,by+1,bz+2,B.crafting_table);
  }
  function buildRuin(c, ox, oz, bx, by, bz){
    const H = 3 + (hash2(bx,bz)*3|0);
    for (let y=0;y<H;y++){
      const ring = (hash2(bx+y, bz)<0.7);
      for (let x=0;x<3;x++)for(let z=0;z<3;z++){
        if ((x===1&&z===1)) continue;
        if (hash2(bx+x+y*3, bz+z)<0.3) continue; // 残缺
        setIfLocal(c,ox,oz,bx+x,by+y,bz+z,B.cobblestone);
      }
    }
    setIfLocal(c,ox,oz,bx+1,by,bz+1,B.chest);
    registerChest(ox+bx+1, by, oz+bz+1, lootChest());
  }

  /* ---- 下界生成 ---- */
  function netherHeight(x,z){ return Math.max(6, Math.min(WORLD_H-10, Math.round(SEA + fbm(x*0.04+11,z*0.04+11,3)*10))); }
  function genNetherChunk(c){
    const ox=c.cx*CHUNK, oz=c.cz*CHUNK;
    const LAVA_LVL=12;
    for (let lx=0;lx<CHUNK;lx++)for(let lz=0;lz<CHUNK;lz++){
      const wx=ox+lx, wz=oz+lz;
      const h=netherHeight(wx,wz);
      for (let y=0;y<=h;y++){
        let t=B.netherrack;
        if (y===0) t=B.bedrock;
        // 洞穴化
        const cave = fbm(wx*0.06, y*0.06, 3)*0.5 + fbm(wz*0.06+9, y*0.06,3)*0.5;
        if (y>2 && y<h-1 && cave>0.36) t=AIR;
        if (t!==AIR) c.data[localIdx(lx,y,lz)]=t;
      }
      // 岩浆海
      for (let y=h+1;y<=LAVA_LVL;y++) c.data[localIdx(lx,y,lz)]=B.lava;
      // 灵魂沙斑块
      if (hash2(wx+3,wz+8)<0.04 && getColTop(c,lx,lz)>=0) c.data[localIdx(lx,getColTop(c,lx,lz),lz)]=B.soul_sand;
      // 萤石
      if (hash2(wx+5,wz+9)<0.01){ const gy=h+2+(hash2(wx,wz)*3|0); if(gy<WORLD_H) c.data[localIdx(lx,Math.min(gy,WORLD_H-1),lz)]=B.glowstone; }
    }
    c.generated=true;
  }
  function getColTop(c,lx,lz){ for(let y=WORLD_H-1;y>=0;y--){if(isSolid(c.data[localIdx(lx,y,lz)]))return y;}return -1; }

  /* ---- 末地生成（无限浮岛）---- */
  function genEndChunk(c){
    const ox=c.cx*CHUNK, oz=c.cz*CHUNK;
    for (let lx=0;lx<CHUNK;lx++)for(let lz=0;lz<CHUNK;lz++){
      const wx=ox+lx, wz=oz+lz;
      // 距离主岛
      const d = Math.hypot(wx, wz);
      const n = fbm(wx*0.03, wz*0.03, 4);
      let island = false, baseY = 30;
      if (d < 40){ island = (n > -0.15); }       // 主岛
      else { island = (n > 0.35); baseY = 28 + Math.round(fbm(wx*0.05+9,wz*0.05+9,2)*6); }
      if (island){
        const thick = 3 + Math.round((n+0.5)*4);
        for (let y=baseY-thick;y<=baseY;y++) if(y>=0&&y<WORLD_H) c.data[localIdx(lx,y,lz)]=B.endstone;
      }
    }
    // 主岛中心黑曜石柱 + 末地传送门基座（仅含主岛的区块）
    if (c.cx===0 && c.cz===0){
      // 实际主岛中心放在世界 (0,0)；这里画归位柱
      for (let i=0;i<4;i++){ const ang=i/4*Math.PI*2, rr=8; const px=Math.round(Math.cos(ang)*rr), pz=Math.round(Math.sin(ang)*rr); const sy=topSolidY(px,32,pz); }
    }
    c.generated=true;
  }

  function genChunk(c){
    if (curDim==='overworld') genOverworldChunk(c);
    else if (curDim==='nether') genNetherChunk(c);
    else genEndChunk(c);
    applyPending(c);
  }

  /* ============================================================
     9. 区块流式加载（无限世界核心）
     ============================================================ */
  function ensureChunk(cx, cz){
    const k = chunkKey(cx,cz);
    let c = chunks.get(k);
    if (c) return c;
    c = { data:new Uint8Array(CHUNK*WORLD_H*CHUNK), mesh:null, meshT:null, cx, cz, dirty:false, generated:false };
    chunks.set(k, c);
    genChunk(c);
    return c;
  }
  const loadQueue = [];
  function streamChunks(){
    const pcx = Math.floor(camera.position.x/CHUNK), pcz = Math.floor(camera.position.z/CHUNK);
    // 加入需要的区块
    for (let dz=-RENDER_CHUNKS; dz<=RENDER_CHUNKS; dz++)
      for (let dx=-RENDER_CHUNKS; dx<=RENDER_CHUNKS; dx++){
        const cx=pcx+dx, cz=pcz+dz;
        if (dx*dx+dz*dz > (RENDER_CHUNKS+0.5)*(RENDER_CHUNKS+0.5)) continue;
        const c = chunks.get(chunkKey(cx,cz));
        if (!c){ loadQueue.push([cx,cz, dx*dx+dz*dz]); }
        else if (!c.mesh && !c.meshT && !c.dirty){ c.dirty=true; dirtyChunks.add(c); }
      }
    // 卸载远处区块（释放显存）
    const unloadDist = (RENDER_CHUNKS+2);
    chunks.forEach((c,k)=>{
      const d = Math.max(Math.abs(c.cx-pcx), Math.abs(c.cz-pcz));
      if (d > unloadDist){
        if (c.mesh){ scene.remove(c.mesh); c.mesh.geometry.dispose(); }
        if (c.meshT){ scene.remove(c.meshT); c.meshT.geometry.dispose(); }
        // 保留 data（玩家改动），仅丢网格；若内存吃紧也可整块删
        c.mesh=null; c.meshT=null; c.dirty=false; dirtyChunks.delete(c);
        if (d > unloadDist+4){ chunks.delete(k); }
      }
    });
  }
  function processLoadQueue(budget){
    if (loadQueue.length===0) return;
    loadQueue.sort((a,b)=>a[2]-b[2]);
    let n=0;
    while (loadQueue.length && n<budget){
      const [cx,cz] = loadQueue.shift();
      const c = ensureChunk(cx,cz);
      c.dirty=true; dirtyChunks.add(c);
      // 邻接也标记（接缝）
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([ax,az])=>{ const n2=getChunk(cx+ax,cz+az); if(n2 && (n2.mesh||n2.meshT)) { n2.dirty=true; dirtyChunks.add(n2);} });
      n++;
    }
  }

  /* ============================================================
     10. 箱子内容存储
     ============================================================ */
  const chestStore = new Map();   // "dim:x,y,z" -> [{item,count}|null x 27]
  function chestKey(x,y,z){ return curDim+':'+x+','+y+','+z; }
  function registerChest(x,y,z,contents){ chestStore.set(curDim+':'+x+','+y+','+z, contents); }
  function getChest(x,y,z){ const k=chestKey(x,y,z); if(!chestStore.has(k)) chestStore.set(k, new Array(27).fill(null)); return chestStore.get(k); }
  function lootChest(){
    const c = new Array(27).fill(null);
    const pool = [I.apple,I.bread,I.coal,I.iron_ingot,I.wood_pickaxe,I.stone_sword,I.torch,I.iron_ingot,I.gold_ingot,I.flint];
    const n = 2 + (Math.random()*4|0);
    for (let i=0;i<n;i++){ const it=pool[Math.random()*pool.length|0]; c[Math.random()*27|0]={item:it,count:1+(Math.random()*4|0)}; }
    if (Math.random()<0.15) c[Math.random()*27|0]={item:I.diamond,count:1};
    return c;
  }

  /* ============================================================
     11. 天空 / 光照 / 昼夜
     ============================================================ */
  let renderer, scene, camera;
  let sun, ambient, hemi, skyMesh, skyMat, cloudPlane, cloudTex, moonMesh;
  let shadowsOn = true, renderScale = 1;
  let timeOfDay = 0.30, dayCount = 1;

  const C_DAY_TOP=new THREE.Color(0x4a90e2), C_DAY_BOT=new THREE.Color(0xbcd6f0);
  const C_NIGHT_TOP=new THREE.Color(0x05060f), C_NIGHT_BOT=new THREE.Color(0x10131f);
  const C_SUNSET=new THREE.Color(0xe8884a);
  const _cTop=new THREE.Color(), _cBot=new THREE.Color();
  const clamp01 = v => v<0?0:(v>1?1:v);

  function buildSky(){
    skyMat = new THREE.ShaderMaterial({
      side:THREE.BackSide, depthWrite:false,
      uniforms:{ topColor:{value:new THREE.Color(0x4a90e2)}, bottomColor:{value:new THREE.Color(0xbcd6f0)} },
      vertexShader:'varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec3 vDir; uniform vec3 topColor; uniform vec3 bottomColor; void main(){ float t=clamp(vDir.y,0.0,1.0); gl_FragColor=vec4(mix(bottomColor,topColor,pow(t,0.5)),1.0);}'
    });
    skyMesh = new THREE.Mesh(new THREE.SphereGeometry(480,24,12), skyMat);
    skyMesh.frustumCulled=false; scene.add(skyMesh);
    // 太阳/月亮
    const sunMat = new THREE.MeshBasicMaterial({ color:0xfff4c0, fog:false });
    moonMesh = new THREE.Mesh(new THREE.SphereGeometry(14,12,12), new THREE.MeshBasicMaterial({color:0xeaeaff,fog:false}));
    moonMesh.frustumCulled=false; scene.add(moonMesh);
    sunDisc = new THREE.Mesh(new THREE.SphereGeometry(18,12,12), sunMat);
    sunDisc.frustumCulled=false; scene.add(sunDisc);
    // 像素云
    const cs=64, ccv=document.createElement('canvas'); ccv.width=cs; ccv.height=cs;
    const cctx=ccv.getContext('2d');
    for (let y=0;y<cs;y++)for(let x=0;x<cs;x++){ const n=(fbm(x*0.14+500,y*0.14+500,3)+1)/2; if(n>0.58){cctx.fillStyle='rgba(255,255,255,0.92)';cctx.fillRect(x,y,1,1);} }
    cloudTex=new THREE.CanvasTexture(ccv); cloudTex.wrapS=cloudTex.wrapT=THREE.RepeatWrapping; cloudTex.repeat.set(4,4);
    cloudTex.magFilter=cloudTex.minFilter=THREE.NearestFilter; cloudTex.generateMipmaps=false;
    cloudPlane=new THREE.Mesh(new THREE.PlaneGeometry(900,900), new THREE.MeshBasicMaterial({map:cloudTex,transparent:true,opacity:0.8,depthWrite:false,fog:false,side:THREE.DoubleSide}));
    cloudPlane.rotation.x=-Math.PI/2; cloudPlane.position.y=WORLD_H+36; cloudPlane.frustumCulled=false; scene.add(cloudPlane);
  }
  let sunDisc;

  function buildLights(){
    ambient=new THREE.AmbientLight(0xffffff,0.25); scene.add(ambient);
    hemi=new THREE.HemisphereLight(0xbfe0ff,0x5a4a32,0.6); scene.add(hemi);
    sun=new THREE.DirectionalLight(0xffffff,0.8); sun.castShadow=true;
    sun.shadow.mapSize.set(1536,1536);
    const sc=sun.shadow.camera; sc.near=1; sc.far=360; sc.left=-70; sc.right=70; sc.top=70; sc.bottom=-70; sc.updateProjectionMatrix();
    sun.shadow.bias=-0.0004; if('normalBias' in sun.shadow) sun.shadow.normalBias=0.05;
    scene.add(sun); scene.add(sun.target);
  }
  function setShadows(on){
    shadowsOn=on; renderer.shadowMap.enabled=on; if(sun) sun.castShadow=on;
    chunks.forEach(c=>{ if(c.mesh) c.mesh.castShadow=on; });
    const b=document.getElementById('btnGfx'); if(b) b.textContent='阴影：'+(on?'开':'关');
  }
  function updateClock(dayAmt){
    const ic=document.getElementById('clockIcon'), tx=document.getElementById('clockText');
    if(!ic||!tx) return;
    if (curDim!=='overworld'){ ic.textContent=DIMS[curDim].icon; tx.textContent=DIMS[curDim].name; return; }
    let phase;
    if (dayAmt>0.62){ic.textContent='☀️';phase='白天';}
    else if (dayAmt>0.18){ic.textContent='🌇';phase='黄昏';}
    else {ic.textContent='🌙';phase='夜晚';}
    tx.textContent='第 '+dayCount+' 天 · '+phase;
  }
  function dayNight(dt){
    if (curDim!=='overworld') return;
    timeOfDay += dt/DAY_LENGTH;
    if (timeOfDay>=1){ timeOfDay-=1; dayCount++; }
    const a=timeOfDay*Math.PI*2, elev=Math.sin(a);
    const dayAmt=clamp01((elev+0.22)/0.6);
    _cTop.copy(C_NIGHT_TOP).lerp(C_DAY_TOP,dayAmt);
    _cBot.copy(C_NIGHT_BOT).lerp(C_DAY_BOT,dayAmt);
    const horizon=(1-Math.min(1,Math.abs(elev)/0.32))*clamp01(elev+0.3);
    _cBot.lerp(C_SUNSET,horizon*0.5);
    skyMat.uniforms.topColor.value.copy(_cTop);
    skyMat.uniforms.bottomColor.value.copy(_cBot);
    scene.fog.color.copy(_cBot); scene.background.copy(_cBot);
    if (cloudPlane) cloudPlane.material.opacity=0.2+dayAmt*0.6;
    sun.intensity=0.05+dayAmt*0.85; ambient.intensity=0.08+dayAmt*0.2; hemi.intensity=0.12+dayAmt*0.5;
    sun.color.setHSL(0.09,0.5,0.55+0.35*dayAmt);
    if (sunDisc) sunDisc.visible = elev > -0.1;
    if (moonMesh) moonMesh.visible = elev < 0.1;
    updateClock(dayAmt);
  }
  function isNight(){ if(curDim!=='overworld')return false; return Math.sin(timeOfDay*Math.PI*2)<0.02; }
  function lightLevelAt(x,y,z){
    // 简化光照：天光（上方无遮挡=亮）+ 维度环境；用于刷怪判定
    if (curDim==='nether') return 7;
    if (curDim==='end') return 10;
    for (let yy=y+1; yy<WORLD_H; yy++){ if (isOpaque(getVoxel(x,yy,z))) return isNight()?3:7; }
    return isNight()?4:15;
  }
  function applyDimLighting(dim){
    if (dim==='overworld'){
      scene.fog.near=60; scene.fog.far=RENDER_CHUNKS*CHUNK*0.95;
      ambient.color.setHex(0xffffff); sun.color.setHex(0xffffff);
      if (cloudPlane) cloudPlane.visible=true; if(sunDisc)sunDisc.visible=true; if(moonMesh)moonMesh.visible=true;
      setShadows(shadowsOn); dayNight(0); return;
    }
    if (cloudPlane) cloudPlane.visible=false; if(sunDisc)sunDisc.visible=false; if(moonMesh)moonMesh.visible=false;
    if (dim==='nether'){
      _cTop.setHex(0x3a0d0d); _cBot.setHex(0x721a12);
      scene.fog.color.setHex(0x4a1410); scene.fog.near=8; scene.fog.far=70; scene.background.setHex(0x4a1410);
      ambient.intensity=0.45; ambient.color.setHex(0xff7a4a); hemi.intensity=0.3; sun.intensity=0; renderer.shadowMap.enabled=false;
    } else {
      _cTop.setHex(0x0a0616); _cBot.setHex(0x1a1030);
      scene.fog.color.setHex(0x120a22); scene.fog.near=40; scene.fog.far=RENDER_CHUNKS*CHUNK; scene.background.setHex(0x0c0718);
      ambient.intensity=0.55; ambient.color.setHex(0xc9b8ff); hemi.intensity=0.25; sun.intensity=0.15; sun.color.setHex(0xb9a8e8);
      sun.position.set(40,120,20); renderer.shadowMap.enabled=shadowsOn;
    }
    skyMat.uniforms.topColor.value.copy(_cTop); skyMat.uniforms.bottomColor.value.copy(_cBot);
  }

  /* ============================================================
     12. 玩家 + 背包数据
     ============================================================ */
  const HOTBAR_N = 9;
  const INV_N = 27;              // 主背包格
  const player = {
    vel:new THREE.Vector3(), onGround:false, fly:false, sprint:false, creative:false,
    hp:20, maxHp:20, hunger:20, maxHunger:20, satur:5, exhaustion:0,
    air:300, hurtCd:0, regenT:0, starveT:0, dead:false, fallStart:null,
    xp:0, level:0, breakT:0, breakTarget:null,
    inHand:0, hotbar:new Array(HOTBAR_N).fill(null),
    inv:new Array(INV_N).fill(null),
    armor:{head:null,chest:null,legs:null,feet:null},
    spawn:null
  };
  let yaw=0, pitch=0, isLocked=false, worldReady=false, selectedSlot=0;
  let curScreen=null;            // null | 'inventory' | 'crafting' | 'chest' | 'furnace'
  const keys={};
  const _dir=new THREE.Vector3();

  // 物品栈工具
  function stackOf(item,count){ return {item,count}; }
  function canStack(slot, item){ return slot && slot.item===item && slot.count < ITEMS[item].stack; }
  function addItem(item, count){
    count = count||1;
    const max = ITEMS[item].stack;
    // 先填已有同类（hotbar 优先，再背包）
    const all = player.hotbar.concat(player.inv);
    for (let pass=0; pass<2; pass++){
      const arr = pass===0?player.hotbar:player.inv;
      for (let i=0;i<arr.length && count>0;i++){
        if (arr[i] && arr[i].item===item && arr[i].count<max){ const add=Math.min(count,max-arr[i].count); arr[i].count+=add; count-=add; }
      }
    }
    // 空格
    for (let pass=0; pass<2 && count>0; pass++){
      const arr = pass===0?player.hotbar:player.inv;
      for (let i=0;i<arr.length && count>0;i++){
        if (!arr[i]){ const add=Math.min(count,max); arr[i]=stackOf(item,add); count-=add; }
      }
    }
    refreshHotbar(); if(curScreen) renderScreen();
    return count; // 剩余装不下
  }
  function countItem(item){ let n=0; player.hotbar.concat(player.inv).forEach(s=>{if(s&&s.item===item)n+=s.count;}); return n; }
  function removeItems(item, count){
    let need=count;
    const arrs=[player.hotbar,player.inv];
    for (const arr of arrs) for (let i=0;i<arr.length&&need>0;i++){ if(arr[i]&&arr[i].item===item){ const take=Math.min(need,arr[i].count); arr[i].count-=take; need-=take; if(arr[i].count<=0) arr[i]=null; } }
    refreshHotbar(); if(curScreen) renderScreen();
    return need===0;
  }
  function heldStack(){ return player.hotbar[selectedSlot]; }
  function heldItem(){ const s=player.hotbar[selectedSlot]; return s?s.item:null; }
  function consumeHeldOne(){ const s=player.hotbar[selectedSlot]; if(!s)return; s.count--; if(s.count<=0)player.hotbar[selectedSlot]=null; refreshHotbar(); }
  function damageHeldTool(){
    if (player.creative) return;
    const s=player.hotbar[selectedSlot]; if(!s)return; const it=ITEMS[s.item];
    if (it.durability>0){ s.dur=(s.dur==null?it.durability:s.dur)-1; if(s.dur<=0){ player.hotbar[selectedSlot]=null; sfx('break'); } refreshHotbar(); }
  }

  /* ============================================================
     13. HUD（血/饿/甲/经验/手持/物品栏）
     ============================================================ */
  function buildHearts(){
    const c=document.getElementById('heartRow'); if(!c)return; c.innerHTML='';
    for(let i=0;i<10;i++){const s=document.createElement('span');s.className='pip';s.textContent='❤';c.appendChild(s);}
  }
  function refreshStats(){
    const hr=document.getElementById('heartRow');
    if (hr){ const pips=hr.children; for(let i=0;i<10;i++){ const v=player.hp-i*2; pips[i].style.opacity = v>0?'1':'0.18'; pips[i].textContent = v>=2?'❤':(v>0?'❤':'❤'); pips[i].style.filter = v>0?'none':'grayscale(1) brightness(0.4)'; } }
    pipRow('hungerRow','🍗',player.hunger,2);
    const ar=document.getElementById('armorRow'); const ap=armorPoints();
    if (ar){ if(ap>0){ar.classList.remove('hide'); pipRow('armorRow','🛡',ap,2);} else {ar.classList.add('hide'); ar.innerHTML='';} }
    // 经验
    const xb=document.getElementById('xpBar'), xl=document.getElementById('xpLevel');
    if (xb){ const need=xpForLevel(player.level); xb.style.width=Math.min(100,(player.xp/need)*100)+'%'; }
    if (xl){ xl.textContent=player.level>0?player.level:''; }
    // 氧气
    const ob=document.getElementById('airRow');
    if (ob){ const head=getVoxel(Math.floor(camera.position.x),Math.floor(camera.position.y),Math.floor(camera.position.z)); if(head===B.water&&player.air<300){ ob.classList.remove('hide'); pipRow('airRow','🫧',Math.ceil(player.air/30),1);} else {ob.classList.add('hide'); ob.innerHTML='';} }
  }
  function pipRow(id, glyph, value, perPip){
    const el=document.getElementById(id); if(!el)return; el.innerHTML='';
    const n = id==='airRow'?10:10;
    for(let i=0;i<n;i++){const s=document.createElement('span');s.className='pip';s.textContent=glyph;s.style.opacity=(value>i*perPip)?'1':'0.18';el.appendChild(s);}
  }
  function armorPoints(){ let p=0; for(const k in player.armor){ const s=player.armor[k]; if(s) p+=ITEMS[s.item].armorPts; } return Math.min(20,p); }
  function xpForLevel(l){ return 7 + l*4; }
  function addXP(n){ player.xp+=n; let need=xpForLevel(player.level); while(player.xp>=need){ player.xp-=need; player.level++; sfx('level'); need=xpForLevel(player.level);} refreshStats(); }

  function refreshHotbar(){
    const bar=document.getElementById('hotbar'); if(!bar)return;
    bar.innerHTML='';
    for(let i=0;i<HOTBAR_N;i++){
      const slot=document.createElement('div'); slot.className='hslot'+(i===selectedSlot?' active':'');
      const s=player.hotbar[i];
      if (s){ slotContent(slot, s); }
      const num=document.createElement('span'); num.className='hnum'; num.textContent=i+1; slot.appendChild(num);
      slot.addEventListener('click',()=>selectSlot(i));
      bar.appendChild(slot);
    }
    refreshStats();
    // 手持物品名提示
    const it=heldItem();
    const el=document.getElementById('selName');
    if (el && it!=null){ el.textContent=ITEMS[it].label; el.style.opacity='1'; clearTimeout(_selT); _selT=setTimeout(()=>el.style.opacity='0',900); }
  }
  let _selT=null;
  function slotContent(slot, s){
    const img=document.createElement('img'); img.src=itemIcon(s.item); img.draggable=false; slot.appendChild(img);
    if (s.count>1){ const cn=document.createElement('span'); cn.className='cnt'; cn.textContent=s.count; slot.appendChild(cn); }
    const it=ITEMS[s.item];
    if (it.durability>0 && s.dur!=null && s.dur<it.durability){ const db=document.createElement('div'); db.className='durbar'; const f=document.createElement('div'); const r=s.dur/it.durability; f.style.width=(r*100)+'%'; f.style.background=r>0.5?'#5fdc4a':(r>0.25?'#e8d24a':'#e84a4a'); db.appendChild(f); slot.appendChild(db); }
  }
  function selectSlot(i){ if(i<0||i>=HOTBAR_N)return; selectedSlot=i; document.querySelectorAll('.hslot').forEach((s,idx)=>s.classList.toggle('active',idx===selectedSlot)); refreshHotbar(); }

  /* ============================================================
     14. 物品栏 / 合成 / 箱子 / 熔炉 界面
     ============================================================ */
  let dragStack=null;            // 鼠标拖动中的栈
  let craftGrid=new Array(9).fill(null);    // 3x3（2x2 用前4格）
  let openChestPos=null, openFurnacePos=null;
  const furnaceStore=new Map();  // key -> {input,fuel,output,progress,burn,burnMax}

  function openScreen(name){
    curScreen=name; document.exitPointerLock();
    const m=document.getElementById('screen'); if(!m)return;
    m.style.display='flex';
    renderScreen();
  }
  function closeScreen(){
    // 把合成格里的东西退回背包
    if (curScreen==='inventory'||curScreen==='crafting'){
      for(let i=0;i<(curScreen==='crafting'?9:4);i++){ if(craftGrid[i]){ addItem(craftGrid[i].item,craftGrid[i].count); craftGrid[i]=null; } }
    }
    if (dragStack){ addItem(dragStack.item,dragStack.count); dragStack=null; }
    curScreen=null; openChestPos=null; openFurnacePos=null;
    const m=document.getElementById('screen'); if(m) m.style.display='none';
    refreshHotbar();
    if (worldReady && !player.dead) renderer.domElement.requestPointerLock();
  }
  function renderScreen(){
    const root=document.getElementById('screenBody'); if(!root)return;
    root.innerHTML='';
    const title=document.getElementById('screenTitle');
    if (curScreen==='inventory'){ title.textContent='物品栏'; renderInventoryScreen(root,false); }
    else if (curScreen==='crafting'){ title.textContent='工作台'; renderInventoryScreen(root,true); }
    else if (curScreen==='chest'){ title.textContent='箱子'; renderChestScreen(root); }
    else if (curScreen==='furnace'){ title.textContent='熔炉'; renderFurnaceScreen(root); }
    renderDragGhost();
  }
  function cell(s, onClick, cls){
    const d=document.createElement('div'); d.className='islot'+(cls?(' '+cls):'');
    if (s) slotContent(d, s);
    d.addEventListener('mousedown', e=>{ e.preventDefault(); onClick(e); });
    return d;
  }
  function grid(arr, getStack, setStack, cols, cls){
    const g=document.createElement('div'); g.className='igrid'; g.style.gridTemplateColumns='repeat('+cols+',44px)';
    arr.forEach((_,i)=>{
      const d=cell(getStack(i), (e)=>handleSlotClick(e, ()=>getStack(i), (v)=>setStack(i,v)), cls);
      g.appendChild(d);
    });
    return g;
  }
  // 经典拿取逻辑：左键全拿/放下/合并，右键拿一半/放一个
  function handleSlotClick(e, get, set){
    let s=get();
    if (e.button===2){ // 右键
      if (dragStack && (!s)){ set(stackOf(dragStack.item,1)); if(--dragStack.count<=0)dragStack=null; }
      else if (dragStack && s && s.item===dragStack.item && s.count<ITEMS[s.item].stack){ s.count++; set(s); if(--dragStack.count<=0)dragStack=null; }
      else if (!dragStack && s){ const half=Math.ceil(s.count/2); dragStack=stackOf(s.item,half); s.count-=half; set(s.count<=0?null:s); }
    } else { // 左键
      if (!dragStack && s){ dragStack=s; set(null); }
      else if (dragStack && !s){ set(dragStack); dragStack=null; }
      else if (dragStack && s){
        if (s.item===dragStack.item){ const max=ITEMS[s.item].stack; const add=Math.min(dragStack.count,max-s.count); s.count+=add; dragStack.count-=add; set(s); if(dragStack.count<=0)dragStack=null; }
        else { set(dragStack); dragStack=s; }
      }
    }
    renderScreen();
    if (curScreen==='furnace') updateFurnaceUI();
  }
  function renderDragGhost(){
    let g=document.getElementById('dragGhost');
    if (!g){ g=document.createElement('div'); g.id='dragGhost'; document.body.appendChild(g); }
    if (dragStack){ g.style.display='block'; g.innerHTML=''; const img=document.createElement('img'); img.src=itemIcon(dragStack.item); g.appendChild(img); if(dragStack.count>1){const c=document.createElement('span');c.textContent=dragStack.count;c.className='cnt';g.appendChild(c);} }
    else g.style.display='none';
  }
  document.addEventListener('mousemove', e=>{ const g=document.getElementById('dragGhost'); if(g&&dragStack){ g.style.left=(e.clientX+6)+'px'; g.style.top=(e.clientY+6)+'px'; } });

  function sectionLabel(t){ const d=document.createElement('div'); d.className='isec'; d.textContent=t; return d; }
  function renderInventoryScreen(root, big){
    const wrap=document.createElement('div'); wrap.className='invwrap';
    // 合成区
    const craft=document.createElement('div'); craft.className='craftrow';
    const n = big?9:4, cols=big?3:2;
    const cg=grid(new Array(n).fill(0), i=>craftGrid[i], (i,v)=>{craftGrid[i]=v; updateCraftResult(big);}, cols, 'craftcell');
    craft.appendChild(labeledBox(big?'合成 3×3':'合成 2×2', cg));
    // 箭头 + 结果
    const arrow=document.createElement('div'); arrow.className='craftarrow'; arrow.textContent='→';
    const resultSlot=cell(currentCraftResult(big), (e)=>takeCraftResult(e,big), 'resultcell');
    resultSlot.id='craftResult';
    const resBox=labeledBox('成品', resultSlot);
    craft.appendChild(arrow); craft.appendChild(resBox);
    wrap.appendChild(craft);
    // 创造模式：物品全集
    if (player.creative){ wrap.appendChild(renderCreativePalette()); }
    // 盔甲 + 主背包
    const bottom=document.createElement('div'); bottom.className='invbottom';
    const armorCol=document.createElement('div'); armorCol.className='armorcol';
    ['head','chest','legs','feet'].forEach(slot=>{
      const c=cell(player.armor[slot], (e)=>handleSlotClick(e, ()=>player.armor[slot], (v)=>{ if(v && ITEMS[v.item].armorSlot!==slot){ return; } player.armor[slot]=v; refreshStats(); }), 'armorslot');
      c.dataset.slot=slot; armorCol.appendChild(c);
    });
    bottom.appendChild(labeledBox('盔甲', armorCol));
    wrap.appendChild(bottom);
    // 背包 3x9 + hotbar
    const invGrid=grid(player.inv, i=>player.inv[i], (i,v)=>{player.inv[i]=v;}, 9, '');
    wrap.appendChild(labeledBox('背包', invGrid));
    const hotGrid=grid(player.hotbar, i=>player.hotbar[i], (i,v)=>{player.hotbar[i]=v; refreshHotbar();}, 9, 'hotcell');
    wrap.appendChild(labeledBox('快捷栏', hotGrid));
    root.appendChild(wrap);
  }
  function labeledBox(label, node){ const d=document.createElement('div'); d.className='lbox'; d.appendChild(sectionLabel(label)); d.appendChild(node); return d; }

  function renderCreativePalette(){
    const box=document.createElement('div'); box.className='lbox';
    box.appendChild(sectionLabel('创造物品（点击直接拿取）'));
    const g=document.createElement('div'); g.className='igrid creative'; g.style.gridTemplateColumns='repeat(12,40px)';
    ITEMS.forEach(it=>{
      if (it.id===AIR) return;
      const d=document.createElement('div'); d.className='islot creslot'; const s=stackOf(it.id, it.stack>1?it.stack:1);
      slotContent(d, s); d.title=it.label;
      d.addEventListener('mousedown',e=>{ e.preventDefault(); if(e.button===2){ addItem(it.id, it.stack>1?it.stack:1); } else { dragStack=stackOf(it.id, e.shiftKey? (it.stack>1?it.stack:1):1); renderScreen(); } });
      g.appendChild(d);
    });
    box.appendChild(g); return box;
  }

  // —— 合成匹配 ——
  function gridSignature(big){
    // 收集非空，做无序计数匹配（简化：忽略形状）
    const counts={}; const n=big?9:4;
    for(let i=0;i<n;i++){ const s=craftGrid[i]; if(s){ counts[s.item]=(counts[s.item]||0)+1; } }
    return counts;
  }
  function matchRecipe(big){
    const have=gridSignature(big);
    for (const r of RECIPES){
      if (r.big && !big) continue;
      const need=r.need; let ok=true;
      // 需求里每种>=1且数量匹配；且不能有多余种类
      const keys=Object.keys(need);
      if (Object.keys(have).length!==keys.length){ ok=false; }
      else { for (const k of keys){ if ((have[k]||0)!==need[k]){ ok=false; break; } } }
      if (ok) return r;
    }
    return null;
  }
  let _craftCache=null;
  function updateCraftResult(big){ _craftCache=matchRecipe(big); const el=document.getElementById('craftResult'); if(el){ el.innerHTML=''; const r=currentCraftResult(big); if(r) slotContent(el,r);} }
  function currentCraftResult(big){ const r=matchRecipe(big); return r?stackOf(r.out,r.count):null; }
  function takeCraftResult(e, big){
    const r=matchRecipe(big); if(!r) return;
    // 消耗每格 1
    const n=big?9:4; for(let i=0;i<n;i++){ if(craftGrid[i]){ craftGrid[i].count--; if(craftGrid[i].count<=0)craftGrid[i]=null; } }
    const left=addItem(r.out, r.count);
    addXP(1);
    updateCraftResult(big); renderScreen();
  }

  // —— 箱子 ——
  function renderChestScreen(root){
    const cont=getChest(openChestPos.x,openChestPos.y,openChestPos.z);
    const wrap=document.createElement('div'); wrap.className='invwrap';
    const cg=grid(cont, i=>cont[i], (i,v)=>{cont[i]=v;}, 9, 'chestcell');
    wrap.appendChild(labeledBox('箱子（27 格）', cg));
    const invGrid=grid(player.inv, i=>player.inv[i], (i,v)=>{player.inv[i]=v;}, 9, '');
    wrap.appendChild(labeledBox('背包', invGrid));
    const hotGrid=grid(player.hotbar, i=>player.hotbar[i], (i,v)=>{player.hotbar[i]=v; refreshHotbar();}, 9, 'hotcell');
    wrap.appendChild(labeledBox('快捷栏', hotGrid));
    root.appendChild(wrap);
  }

  // —— 熔炉 ——
  function furnaceKey(p){ return curDim+':'+p.x+','+p.y+','+p.z; }
  function getFurnace(p){ const k=furnaceKey(p); if(!furnaceStore.has(k)) furnaceStore.set(k,{input:null,fuel:null,output:null,progress:0,burn:0,burnMax:0}); return furnaceStore.get(k); }
  function renderFurnaceScreen(root){
    const f=getFurnace(openFurnacePos);
    const wrap=document.createElement('div'); wrap.className='invwrap';
    const fur=document.createElement('div'); fur.className='furnace-col';
    const inSlot=cell(f.input,(e)=>handleSlotClick(e,()=>f.input,(v)=>{f.input=v;}),'fslot'); inSlot.id='furIn';
    const flame=document.createElement('div'); flame.className='furflame'; flame.id='furFlame'; flame.textContent='🔥';
    const fuelSlot=cell(f.fuel,(e)=>handleSlotClick(e,()=>f.fuel,(v)=>{f.fuel=v;}),'fslot'); fuelSlot.id='furFuel';
    const arrow=document.createElement('div'); arrow.className='furarrow'; arrow.id='furArrow'; arrow.textContent='→';
    const outSlot=cell(f.output,(e)=>handleSlotClick(e,()=>f.output,(v)=>{ if(dragStack && f.output){return;} f.output=v;}),'fslot resultcell'); outSlot.id='furOut';
    const left=document.createElement('div'); left.className='furleft';
    left.appendChild(labeledBox('原料', inSlot));
    left.appendChild(flame);
    left.appendChild(labeledBox('燃料', fuelSlot));
    fur.appendChild(left); fur.appendChild(arrow); fur.appendChild(labeledBox('产物', outSlot));
    wrap.appendChild(fur);
    const invGrid=grid(player.inv, i=>player.inv[i], (i,v)=>{player.inv[i]=v;}, 9, '');
    wrap.appendChild(labeledBox('背包', invGrid));
    const hotGrid=grid(player.hotbar, i=>player.hotbar[i], (i,v)=>{player.hotbar[i]=v; refreshHotbar();}, 9, 'hotcell');
    wrap.appendChild(labeledBox('快捷栏', hotGrid));
    root.appendChild(wrap);
  }
  function updateFurnaceUI(){ if(curScreen!=='furnace')return; renderScreen(); }
  const FUEL = {}; FUEL[I.coal]=8; FUEL[I.log]=1.5; FUEL[I.planks]=1; FUEL[I.stick]=0.5; FUEL[I.lava]=100;
  function tickFurnaces(dt){
    furnaceStore.forEach(f=>{
      const canSmelt = f.input && SMELT[f.input.item]!=null && (!f.output || (f.output.item===SMELT[f.input.item] && f.output.count<ITEMS[f.output.item].stack));
      if (f.burn>0){ f.burn-=dt; }
      if (f.burn<=0 && canSmelt && f.fuel && FUEL[f.fuel.item]){ f.burnMax=FUEL[f.fuel.item]*10; f.burn=f.burnMax; f.fuel.count--; if(f.fuel.count<=0)f.fuel=null; }
      if (f.burn>0 && canSmelt){ f.progress+=dt; if(f.progress>=2){ f.progress=0; const out=SMELT[f.input.item]; if(!f.output)f.output=stackOf(out,1); else f.output.count++; f.input.count--; if(f.input.count<=0)f.input=null; } }
      else { f.progress=Math.max(0,f.progress-dt); }
    });
    if (curScreen==='furnace'){ const fl=document.getElementById('furFlame'); const f=getFurnace(openFurnacePos); if(fl) fl.style.opacity=f.burn>0?'1':'0.25'; const ar=document.getElementById('furArrow'); if(ar) ar.style.color=f.progress>0?'#7ed449':'#888'; }
  }

  /* ============================================================
     15. 受伤 / 死亡 / 重生 / 进食
     ============================================================ */
  function flashHurt(){ const h=document.getElementById('hurt'); if(h)h.style.opacity='0.8'; }
  function hurtPlayer(amount, cause, bypassArmor){
    if (player.creative||player.dead||!worldReady) return;
    let dmg=amount;
    if (!bypassArmor){ const ap=armorPoints(); dmg*= (1 - Math.min(ap,20)/40); }   // 满甲约减伤 50%
    if (dmg<=0) return;
    player.hp-=dmg; player.hurtCd=0.5; flashHurt(); sfx('hurt');
    // 盔甲耐久
    if (!bypassArmor){ for(const k in player.armor){ const s=player.armor[k]; if(s){ const it=ITEMS[s.item]; s.dur=(s.dur==null?it.durability:s.dur)-1; if(s.dur<=0)player.armor[k]=null; } } }
    if (player.hp<=0){ player.hp=0; die(cause); }
    refreshStats();
  }
  function die(cause){
    player.dead=true; const d=document.getElementById('death'); if(d)d.style.display='flex';
    const t=document.getElementById('deathText'); if(t)t.textContent=(cause||'你')+' 结束了这一局。';
    // 掉落物品（生存）
    if (!player.creative){ dropAllItems(); }
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function dropAllItems(){
    const all=player.hotbar.concat(player.inv, Object.values(player.armor));
    all.forEach(s=>{ if(s) spawnDrop(s.item, s.count, camera.position.x, camera.position.y-0.5, camera.position.z); });
    player.hotbar=new Array(HOTBAR_N).fill(null); player.inv=new Array(INV_N).fill(null);
    player.armor={head:null,chest:null,legs:null,feet:null};
    refreshHotbar();
  }
  function respawnPlayer(){
    player.hp=player.maxHp; player.hunger=player.maxHunger; player.satur=5; player.dead=false;
    player.exhaustion=0; player.regenT=0; player.starveT=0; player.air=300;
    const d=document.getElementById('death'); if(d)d.style.display='none';
    const h=document.getElementById('hurt'); if(h)h.style.opacity='0';
    if (curDim!=='overworld'){ switchTo('overworld'); }
    respawnPos(); refreshStats();
    if (worldReady) renderer.domElement.requestPointerLock();
  }
  function respawnPos(){ const sp=player.spawn||spawnPoint; camera.position.set(sp.x,sp.y,sp.z); player.vel.set(0,0,0); player.onGround=false; player.fallStart=null; }
  function eatHeld(){
    const s=heldStack(); if(!s) return; const it=ITEMS[s.item];
    if (it.kind!=='food') return;
    if (player.hunger>=player.maxHunger) return;
    player.hunger=Math.min(player.maxHunger, player.hunger+it.heal);
    player.satur=Math.min(player.hunger, player.satur+it.heal*0.5);
    consumeHeldOne(); sfx('eat'); refreshStats();
  }
  function toggleCreative(){
    player.creative=!player.creative; player.fly=player.creative?player.fly:false;
    const b=document.getElementById('btnMode'); if(b)b.textContent='模式：'+(player.creative?'创造':'生存');
    if (player.creative){ const h=document.getElementById('hurt'); if(h)h.style.opacity='0'; player.hp=player.maxHp; }
    refreshStats(); chatLog('已切换到'+(player.creative?'创造':'生存')+'模式');
  }
  function healPlayer(){ player.hp=player.maxHp; player.hunger=player.maxHunger; player.satur=5; player.air=300; const h=document.getElementById('hurt'); if(h)h.style.opacity='0'; refreshStats(); }

  function survivalTick(dt){
    const h=document.getElementById('hurt'); if(h){const o=parseFloat(h.style.opacity||'0'); if(o>0)h.style.opacity=Math.max(0,o-dt*2).toFixed(3);}
    if (player.hurtCd>0) player.hurtCd-=dt;
    if (player.creative||player.dead) return;
    const p=camera.position;
    // 岩浆
    const feet=getVoxel(Math.floor(p.x),Math.floor(p.y-EYE+0.15),Math.floor(p.z));
    if (feet===B.lava){ _lavaT+=dt; if(_lavaT>=0.5){_lavaT=0; hurtPlayer(4,'岩浆',true);} } else _lavaT=0;
    // 溺水
    const head=getVoxel(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));
    if (head===B.water){ player.air-=dt*30; if(player.air<=0){ player.air=0; _drownT+=dt; if(_drownT>=1){_drownT=0; hurtPlayer(2,'溺水',true);} } }
    else { player.air=Math.min(300,player.air+dt*120); _drownT=0; }
    // 饥饿
    const moving=keys['KeyW']||keys['KeyA']||keys['KeyS']||keys['KeyD'];
    player.exhaustion+=dt*((player.sprint&&moving)?0.9:(moving?0.45:0.1));
    if (player.exhaustion>=4){ player.exhaustion-=4; if(player.satur>0)player.satur=Math.max(0,player.satur-1); else if(player.hunger>0){player.hunger--; refreshStats();} }
    // 回血
    if (player.hunger>=18 && player.hp<player.maxHp){ player.regenT+=dt; if(player.regenT>=3.5){player.regenT=0; player.hp=Math.min(player.maxHp,player.hp+1); player.exhaustion+=3; refreshStats();} } else player.regenT=0;
    // 饥饿掉血
    if (player.hunger<=0){ player.starveT+=dt; if(player.starveT>=4){player.starveT=0; if(player.hp>1)hurtPlayer(1,'饥饿',true);} } else player.starveT=0;
  }
  let _lavaT=0, _drownT=0;

  /* ============================================================
     16. 掉落物（可拾取）
     ============================================================ */
  const drops=[];
  const _dropGeo=new THREE.BoxGeometry(0.28,0.28,0.28);
  function spawnDrop(item, count, x, y, z){
    let mat;
    const it=ITEMS[item];
    if (it.block!=null && BLOCKS[it.block].tiles){ mat=blockMaterial; }
    else { mat=new THREE.MeshLambertMaterial({color:it.color}); }
    const mesh=new THREE.Mesh(_dropGeo, mat); mesh.position.set(x,y,z); mesh.castShadow=true; scene.add(mesh);
    drops.push({item,count,mesh,vel:new THREE.Vector3((Math.random()-0.5)*1.5, 2.5, (Math.random()-0.5)*1.5), age:0, pickDelay:0.5});
  }
  function updateDrops(dt){
    const p=camera.position;
    for (let i=drops.length-1;i>=0;i--){
      const d=drops[i]; d.age+=dt; if(d.pickDelay>0)d.pickDelay-=dt;
      d.vel.y-=GRAVITY*dt;
      let ny=d.mesh.position.y+d.vel.y*dt;
      if (d.vel.y<=0 && isSolid(getVoxel(Math.floor(d.mesh.position.x),Math.floor(ny),Math.floor(d.mesh.position.z)))){ d.mesh.position.y=Math.floor(ny)+1.15; d.vel.y=0; d.vel.x*=0.6; d.vel.z*=0.6; }
      else d.mesh.position.y=ny;
      d.mesh.position.x+=d.vel.x*dt; d.mesh.position.z+=d.vel.z*dt;
      d.mesh.rotation.y+=dt*2; d.mesh.position.y += Math.sin(d.age*3)*0.0015;
      // 拾取
      const dist=Math.hypot(p.x-d.mesh.position.x, (p.y-EYE+0.8)-d.mesh.position.y, p.z-d.mesh.position.z);
      if (d.pickDelay<=0 && dist<1.4 && !player.dead){
        // 吸引
        if (dist>0.5){ d.mesh.position.x+=(p.x-d.mesh.position.x)*0.25; d.mesh.position.z+=(p.z-d.mesh.position.z)*0.25; d.mesh.position.y+=((p.y-EYE+0.8)-d.mesh.position.y)*0.25; }
        else { const left=addItem(d.item,d.count); sfx('pop'); if(left===0){ scene.remove(d.mesh); if(d.mesh.material!==blockMaterial)d.mesh.material.dispose(); drops.splice(i,1); } else d.count=left; }
      }
      if (d.age>180 || d.mesh.position.y<-30){ scene.remove(d.mesh); if(d.mesh.material!==blockMaterial)d.mesh.material.dispose(); drops.splice(i,1); }
    }
  }

  /* ============================================================
     17. 生物（各具特性）
     ============================================================ */
  // trait 说明：
  //  pig/cow/sheep/chicken: 被动，受击逃跑，掉肉/皮/羽
  //  zombie: 夜间追人，白天着火，破门(简化为靠近攻击)
  //  skeleton: 远程射箭，保持距离
  //  creeper: 靠近膨胀爆炸，怕猫(无)
  //  spider: 跳跃，可爬，夜间敌对
  //  enderman: 中立，被注视才敌对，瞬移，可搬方块
  //  blaze(下界): 飞行喷火球
  //  ghast(下界): 大型飞行远程
  const MOB = {
    pig:     { hostile:false, hp:10, speed:1.5, w:0.42, bh:0.7, hh:0.5, body:0xe39aaa, head:0xf0b0bb, emoji:'🐷', flee:true, drops:[[I.porkchop,1,2]], xp:1 },
    cow:     { hostile:false, hp:10, speed:1.4, w:0.45, bh:0.9, hh:0.55, body:0x5a4636, head:0x6b5442, emoji:'🐮', flee:true, drops:[[I.beef,1,2],[I.leather,0,2]], xp:1 },
    sheep:   { hostile:false, hp:8,  speed:1.5, w:0.42, bh:0.8, hh:0.5, body:0xe8e8e8, head:0xd8c8b0, emoji:'🐑', flee:true, drops:[[I.wheat,0,1]], xp:1 },
    chicken: { hostile:false, hp:4,  speed:1.6, w:0.28, bh:0.45,hh:0.35,body:0xf0f0f0, head:0xf8f0d8, emoji:'🐔', flee:true, drops:[[I.porkchop,0,1]], xp:1, light:true },
    zombie:  { hostile:true,  hp:20, speed:1.9, w:0.42, bh:1.1, hh:0.5, body:0x3c7a3a, head:0x5aa05a, emoji:'🧟', dmg:3, burn:true, drops:[[I.leather,0,1]], xp:5 },
    skeleton:{ hostile:true,  hp:20, speed:1.8, w:0.4,  bh:1.1, hh:0.5, body:0xcfcfcf, head:0xe0e0e0, emoji:'💀', dmg:2, ranged:true, range:14, burn:true, drops:[[I.coal,0,1]], xp:5 },
    creeper: { hostile:true,  hp:18, speed:2.1, w:0.42, bh:1.1, hh:0.5, body:0x4caf50, head:0x66c266, emoji:'💥', dmg:0, explode:true, drops:[[I.coal,0,1]], xp:5 },
    spider:  { hostile:true,  hp:16, speed:2.6, w:0.6,  bh:0.5, hh:0.4, body:0x33221a, head:0x4a3326, emoji:'🕷️', dmg:2, jumper:true, climb:true, drops:[], xp:5 },
    enderman:{ hostile:'look',hp:40, speed:2.4, w:0.4,  bh:2.0, hh:0.5, body:0x101018, head:0x1a1a28, emoji:'🟪', dmg:6, teleport:true, drops:[[I.ender_pearl,0,1]], xp:8 },
    blaze:   { hostile:true,  hp:20, speed:1.6, w:0.4,  bh:1.2, hh:0.5, body:0xffb020, head:0xffd060, emoji:'🔥', dmg:4, flying:true, ranged:true, range:16, drops:[[I.blaze_rod,1,1]], xp:10, light:true },
    ghast:   { hostile:true,  hp:10, speed:1.2, w:1.4,  bh:1.4, hh:0,   body:0xeeeeee, head:0xeeeeee, emoji:'👻', dmg:0, flying:true, ranged:true, range:30, big:true, drops:[], xp:5, light:true },
  };
  const mobs=[]; let spawnTimer=0;
  const _mobGeoCache={};
  function mobMesh(type){
    const c=MOB[type]; const grp=new THREE.Group();
    const bodyMat=new THREE.MeshLambertMaterial({color:c.body});
    const headMat=new THREE.MeshLambertMaterial({color:c.head, emissive: c.light?new THREE.Color(c.head).multiplyScalar(0.4):0x000000});
    if (c.big){
      const b=new THREE.Mesh(new THREE.BoxGeometry(c.w*2,c.bh*2,c.w*2), bodyMat); b.position.y=c.bh; b.castShadow=true; grp.add(b);
      // 触手
      for(let i=0;i<4;i++){ const t=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.7,0.18), bodyMat); t.position.set((i-1.5)*0.5,0.2,0.4); grp.add(t); }
      const e=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.15,0.05), new THREE.MeshBasicMaterial({color:0x882020})); e.position.set(0,c.bh+0.2,c.w); grp.add(e);
    } else {
      const body=new THREE.Mesh(new THREE.BoxGeometry(c.w*2,c.bh,c.w*1.4), bodyMat); body.position.y=c.bh/2; body.castShadow=true; grp.add(body);
      const head=new THREE.Mesh(new THREE.BoxGeometry(c.w*1.6,c.hh,c.w*1.6), headMat); head.position.y=c.bh+c.hh/2; head.castShadow=true; grp.add(head);
      const eyeG=new THREE.BoxGeometry(c.w*0.3,c.w*0.3,0.02); const eyeM=new THREE.MeshBasicMaterial({color: type==='enderman'?0xc060ff:(type==='spider'?0xff2020:0x110011)});
      const e1=new THREE.Mesh(eyeG,eyeM), e2=new THREE.Mesh(eyeG,eyeM);
      e1.position.set(-c.w*0.4,c.bh+c.hh/2,c.w*0.81); e2.position.set(c.w*0.4,c.bh+c.hh/2,c.w*0.81);
      grp.add(e1); grp.add(e2);
      // 腿（简单）
      if (!c.flying){ const legMat=bodyMat; const lg=new THREE.BoxGeometry(c.w*0.5,c.bh*0.5,c.w*0.5);
        [[-c.w*0.5,0,c.w*0.4],[c.w*0.5,0,c.w*0.4],[-c.w*0.5,0,-c.w*0.4],[c.w*0.5,0,-c.w*0.4]].forEach(pp=>{const l=new THREE.Mesh(lg,legMat);l.position.set(pp[0],-c.bh*0.25+c.bh*0.0,pp[2]);l.userData.leg=true;grp.add(l);}); }
    }
    scene.add(grp); return grp;
  }
  function spawnMob(type, atX, atZ){
    const c=MOB[type];
    let x,z;
    if (atX!=null){ x=atX; z=atZ; }
    else { const ang=Math.random()*Math.PI*2, dist=20+Math.random()*16; x=camera.position.x+Math.cos(ang)*dist; z=camera.position.z+Math.sin(ang)*dist; }
    const fx=Math.floor(x), fz=Math.floor(z);
    const gy=topSolidY(fx,fz); if(gy<0||gy>=WORLD_H-3) return null;
    const grp=mobMesh(type);
    const m={type,cfg:c,g:grp,pos:new THREE.Vector3(x,gy+1,z),vel:new THREE.Vector3(),hp:c.hp,onGround:false,dirT:0,ang:Math.random()*Math.PI*2,hitCd:0,fuse:0,hurtT:0,shootCd:Math.random()*2,jumpCd:0,aggro:false,walkPhase:0};
    mobs.push(m); return m;
  }
  function clearMobs(){ mobs.forEach(m=>scene.remove(m.g)); mobs.length=0; }
  function killMob(m, idx){
    addXP(m.cfg.xp||3);
    (m.cfg.drops||[]).forEach(d=>{ const [item,min,max]=d; const n=min+ (Math.random()*(max-min+1)|0); if(n>0) spawnDrop(item,n,m.pos.x,m.pos.y+0.4,m.pos.z); });
    scene.remove(m.g); mobs.splice(idx,1);
  }
  function mobSolid(x,y,z){ return isSolid(getVoxel(Math.floor(x),Math.floor(y),Math.floor(z))); }
  function lookingAt(m){
    // 玩家是否注视 enderman（用于触发敌对）
    const dir=getLookDir(); const p=camera.position;
    const dx=m.pos.x-p.x, dy=(m.pos.y+m.cfg.bh)-p.y, dz=m.pos.z-p.z; const d=Math.hypot(dx,dy,dz);
    if (d>24) return false; const dot=(dx*dir.x+dy*dir.y+dz*dir.z)/(d||1); return dot>0.96;
  }
  function updateMobs(dt){
    const p=camera.position;
    for (let i=mobs.length-1;i>=0;i--){
      const m=mobs[i], c=m.cfg;
      const dx=p.x-m.pos.x, dz=p.z-m.pos.z, dy=p.y-m.pos.y;
      const dist=Math.hypot(dx,dz);
      if (dist>72){ scene.remove(m.g); mobs.splice(i,1); continue; }
      if (m.hitCd>0)m.hitCd-=dt; if(m.hurtT>0)m.hurtT-=dt; if(m.shootCd>0)m.shootCd-=dt; if(m.jumpCd>0)m.jumpCd-=dt;
      // 白天燃烧
      if (c.burn && !isNight() && curDim==='overworld' && lightLevelAt(Math.floor(m.pos.x),Math.floor(m.pos.y),Math.floor(m.pos.z))>=12){ m.hp-=dt*1.5; m.hurtT=0.1; if(m.hp<=0){killMob(m,i);continue;} }
      // 敌对判定
      let hostile = c.hostile===true;
      if (c.hostile==='look'){ if(lookingAt(m)) m.aggro=true; if(dist<2) m.aggro=true; hostile=m.aggro; }

      // 末影人瞬移
      if (c.teleport && hostile && (dist>16 || (m.hurtT>0 && Math.random()<0.04))){
        const ang=Math.random()*Math.PI*2, r=6+Math.random()*6; const tx=Math.floor(p.x+Math.cos(ang)*r), tz=Math.floor(p.z+Math.sin(ang)*r); const ty=topSolidY(tx,tz);
        if (ty>0){ m.pos.set(tx+0.5,ty+1,tz+0.5); }
      }

      let tx,tz;
      if (hostile && dist<24){ const il=1/(dist||1); tx=dx*il; tz=dz*il; m.ang=Math.atan2(tz,tx); }
      else if (c.flee && dist<7){ const il=1/(dist||1); tx=-dx*il; tz=-dz*il; m.ang=Math.atan2(tz,tx); }
      else { m.dirT-=dt; if(m.dirT<=0){m.dirT=1.5+Math.random()*2.5; m.ang+=(Math.random()-0.5)*2;} tx=Math.cos(m.ang); tz=Math.sin(m.ang); }

      const sp=c.speed*(m.aggro||hostile?1.15:1);
      if (c.flying){
        // 飞行体：朝玩家高度靠拢，保持距离（远程）
        const targetY = p.y + (c.big?4:2);
        m.pos.y += Math.sign(targetY-m.pos.y)*Math.min(Math.abs(targetY-m.pos.y), sp*dt);
        const keep = c.range? c.range*0.6 : 6;
        let mvx=tx, mvz=tz;
        if (hostile && dist<keep){ mvx=-dx/(dist||1); mvz=-dz/(dist||1); }
        m.pos.x += mvx*sp*dt; m.pos.z += mvz*sp*dt;
        m.onGround=false;
      } else {
        const nx=m.pos.x+tx*sp*dt, nz=m.pos.z+tz*sp*dt;
        if (!mobSolid(nx,m.pos.y+0.2,m.pos.z) && !mobSolid(nx,m.pos.y+1.0,m.pos.z)) m.pos.x=nx;
        else if ((c.climb||true) && !mobSolid(nx,m.pos.y+1.2,m.pos.z) && m.onGround){ if(c.climb) m.pos.y+=0.06; else m.pos.y+=1; }
        if (!mobSolid(m.pos.x,m.pos.y+0.2,nz) && !mobSolid(m.pos.x,m.pos.y+1.0,nz)) m.pos.z=nz;
        else if (!mobSolid(m.pos.x,m.pos.y+1.2,nz) && m.onGround) m.pos.y+=1;
        // 蜘蛛跳跃
        if (c.jumper && m.onGround && hostile && dist<6 && m.jumpCd<=0){ m.vel.y=7; m.onGround=false; m.jumpCd=1.5; }
        // 重力
        m.vel.y-=GRAVITY*dt; let ny=m.pos.y+m.vel.y*dt;
        if (m.vel.y<=0 && mobSolid(m.pos.x,ny-0.02,m.pos.z)){ m.pos.y=Math.floor(ny)+1; m.vel.y=0; m.onGround=true; }
        else { m.pos.y=ny; m.onGround=false; }
      }
      if (m.pos.y<-24){ scene.remove(m.g); mobs.splice(i,1); continue; }

      // 攻击
      if (c.explode){
        if (dist<2.6){ m.fuse+=dt; const k=1+Math.sin(performance.now()/55)*0.2*Math.min(1,m.fuse); m.g.scale.set(k,1+0.18*m.fuse,k); m.g.children[0].material.emissive.setHex(0x884400); if(m.fuse>1.5){ creeperBoom(m); mobs.splice(i,1); continue; } }
        else if (dist>3.8){ m.fuse=0; m.g.scale.set(1,1,1); m.g.children[0].material.emissive.setHex(0x000000); }
      } else if (c.ranged && hostile && dist<c.range && dist>3 && m.shootCd<=0){
        m.shootCd = c.flying?2.2:1.6; mobShoot(m, c.big?'fireball':'arrow');
      } else if (hostile && c.dmg>0 && dist<1.5 && m.hitCd<=0 && !c.flying){
        m.hitCd=1.0; hurtPlayer(c.dmg, c.emoji+' '+mobName(m.type)); player.vel.y=Math.max(player.vel.y,3.5);
        const il=1/(dist||1); camera.position.x+=dx*il*0.0; // 击退由速度处理
      } else if (hostile && c.dmg>0 && c.flying && dist<2.2 && m.hitCd<=0){
        m.hitCd=1.0; hurtPlayer(c.dmg, c.emoji+' '+mobName(m.type));
      }

      // 写入网格
      m.g.position.set(m.pos.x,m.pos.y,m.pos.z);
      m.g.rotation.y=-m.ang+Math.PI/2;
      // 走路腿摆动
      if (m.onGround && (Math.abs(tx)+Math.abs(tz))>0.1){ m.walkPhase+=dt*8; m.g.children.forEach(ch=>{ if(ch.userData&&ch.userData.leg){ ch.rotation.x=Math.sin(m.walkPhase)*0.5*(ch.position.z>0?1:-1);} }); }
      // 受击染色
      if (m.hurtT>0){ m.g.children[0].material.emissive && m.g.children[0].material.emissive.setHex(0x660000); }
      else if (!c.explode && !c.light){ m.g.children[0].material.emissive && m.g.children[0].material.emissive.setHex(0x000000); }
    }
  }
  function mobName(t){ return ({pig:'猪',cow:'牛',sheep:'羊',chicken:'鸡',zombie:'僵尸',skeleton:'骷髅',creeper:'苦力怕',spider:'蜘蛛',enderman:'末影人',blaze:'烈焰人',ghast:'恶魂'})[t]||t; }
  function creeperBoom(m){
    const p=camera.position;
    const d=Math.hypot(p.x-m.pos.x,p.y-m.pos.y,p.z-m.pos.z);
    const dmg=Math.max(0,10-d*1.4); if(dmg>0)hurtPlayer(dmg,'💥 苦力怕');
    const cx=Math.round(m.pos.x),cy=Math.round(m.pos.y),cz=Math.round(m.pos.z),R=3;
    for(let x=-R;x<=R;x++)for(let y=-R;y<=R;y++)for(let z=-R;z<=R;z++){ if(x*x+y*y+z*z>R*R)continue; const bx=cx+x,by=cy+y,bz=cz+z; const v=getVoxel(bx,by,bz); if(by>0&&v!==AIR&&v!==B.bedrock&&v!==B.obsidian){ const it=blockDropItem(v,'diamond'); if(it!=null&&Math.random()<0.3)spawnDrop(it,1,bx+0.5,by+0.5,bz+0.5); updateVoxel(bx,by,bz,AIR);} }
    sfx('boom'); scene.remove(m.g);
  }

  /* ============================================================
     18. 弹射物（箭 / 火球 / 末影龙弹）
     ============================================================ */
  const projectiles=[];
  function mobShoot(m, kind){
    const p=camera.position; const from=new THREE.Vector3(m.pos.x,m.pos.y+m.cfg.bh,m.pos.z);
    const dir=new THREE.Vector3(p.x-from.x,(p.y-0.3)-from.y,p.z-from.z).normalize();
    let geo,mat,speed,dmg,grav;
    if (kind==='arrow'){ geo=new THREE.BoxGeometry(0.08,0.08,0.5); mat=new THREE.MeshBasicMaterial({color:0xdddddd}); speed=22; dmg=3; grav=true; }
    else { geo=new THREE.SphereGeometry(0.35,8,8); mat=new THREE.MeshBasicMaterial({color:0xff7020}); speed=12; dmg=5; grav=false; }
    const mesh=new THREE.Mesh(geo,mat); mesh.position.copy(from); if(kind==='arrow')mesh.lookAt(p.x,p.y,p.z); scene.add(mesh);
    projectiles.push({mesh,vel:dir.multiplyScalar(speed),life:5,dmg,grav,kind,fromMob:true});
  }
  function shootArrowFromPlayer(){
    const from=camera.position.clone(); const dir=getLookDir().clone();
    const geo=new THREE.BoxGeometry(0.08,0.08,0.5); const mat=new THREE.MeshBasicMaterial({color:0xffffff});
    const mesh=new THREE.Mesh(geo,mat); mesh.position.copy(from).addScaledVector(dir,0.6); mesh.lookAt(from.clone().addScaledVector(dir,2)); scene.add(mesh);
    projectiles.push({mesh,vel:dir.clone().multiplyScalar(28),life:4,dmg:5,grav:true,kind:'arrow',fromMob:false});
  }
  function throwEnderPearl(){
    if (!removeItems(I.ender_pearl,1)) return;
    const from=camera.position.clone(); const dir=getLookDir().clone();
    const geo=new THREE.SphereGeometry(0.18,8,8); const mat=new THREE.MeshBasicMaterial({color:0x20a070});
    const mesh=new THREE.Mesh(geo,mat); mesh.position.copy(from).addScaledVector(dir,0.6); scene.add(mesh);
    projectiles.push({mesh,vel:dir.clone().multiplyScalar(18),life:5,dmg:0,grav:true,kind:'pearl',fromMob:false});
  }
  function updateProjectiles(dt){
    const p=camera.position;
    for (let i=projectiles.length-1;i>=0;i--){
      const pr=projectiles[i];
      if (pr.grav) pr.vel.y-=GRAVITY*0.5*dt;
      pr.mesh.position.addScaledVector(pr.vel,dt); pr.life-=dt;
      if (pr.kind==='arrow'){ pr.mesh.lookAt(pr.mesh.position.clone().add(pr.vel)); }
      const px=pr.mesh.position.x,py=pr.mesh.position.y,pz=pr.mesh.position.z;
      const hitWall=isSolid(getVoxel(Math.floor(px),Math.floor(py),Math.floor(pz)));
      // 命中玩家（仅敌方弹）
      if (pr.fromMob){ const d=Math.hypot(p.x-px,p.y-py,p.z-pz); if(d<1.2){ hurtPlayer(pr.dmg, pr.kind==='arrow'?'💀 骷髅':'🔥 火球'); rmProj(i); continue; } }
      else {
        // 玩家箭命中生物/Boss
        let hit=false;
        for (let j=0;j<mobs.length;j++){ const m=mobs[j]; const d=Math.hypot(m.pos.x-px,(m.pos.y+m.cfg.bh/2)-py,m.pos.z-pz); if(d<0.8){ m.hp-=pr.dmg; m.hurtT=0.25; if(m.hp<=0)killMob(m,j); hit=true; break; } }
        if (boss){ const d=Math.hypot(boss.g.position.x-px,boss.g.position.y-py,boss.g.position.z-pz); if(d<3){ damageBoss(pr.dmg); hit=true; } }
        if (hit){ rmProj(i); continue; }
      }
      if (pr.kind==='pearl' && (hitWall || pr.life<=0)){ // 传送玩家
        camera.position.set(px, py+1, pz); player.vel.set(0,0,0); hurtPlayer(2,'末影珍珠'); rmProj(i); continue;
      }
      if (pr.life<=0 || hitWall){ rmProj(i); }
    }
  }
  function rmProj(i){ const pr=projectiles[i]; scene.remove(pr.mesh); pr.mesh.geometry.dispose(); pr.mesh.material.dispose(); projectiles.splice(i,1); }

  /* ============================================================
     19. Boss：末影龙
     ============================================================ */
  let boss=null;
  function summonBoss(){
    if (boss) return;
    const grp=new THREE.Group();
    const matBody=new THREE.MeshLambertMaterial({color:0x1c1726});
    const matMemb=new THREE.MeshLambertMaterial({color:0x2a2140,transparent:true,opacity:0.92,side:THREE.DoubleSide});
    grp.add(meshBox(1.6,1.2,3.4,matBody,0,0,0,true));
    grp.add(meshBox(1.2,1.1,1.4,matBody,0,0.2,2.2));
    grp.add(meshBox(0.8,0.5,0.8,matBody,0,0,3.0));
    grp.add(meshBox(0.7,0.6,2.4,matBody,0,0,-2.6));
    const wingL=meshBox(4.2,0.12,1.8,matMemb,-2.8,0.3,0); grp.add(wingL);
    const wingR=meshBox(4.2,0.12,1.8,matMemb,2.8,0.3,0); grp.add(wingR);
    const eyeM=new THREE.MeshBasicMaterial({color:0xc060ff});
    grp.add(meshBox(0.22,0.22,0.05,eyeM,-0.35,0.45,2.7)); grp.add(meshBox(0.22,0.22,0.05,eyeM,0.35,0.45,2.7));
    const cx=camera.position.x, cz=camera.position.z;
    grp.position.set(cx,38,cz); scene.add(grp);
    boss={g:grp,hp:200,maxHp:200,t:0,shootCd:3,swoop:0,wingL,wingR,cx,cz};
    const bar=document.getElementById('bossBar'); if(bar)bar.style.display='flex';
    const bn=document.getElementById('bossName'); if(bn)bn.textContent='末影龙';
    updateBossBar(); chatLog('§5末影龙§r 出现了！');
  }
  function meshBox(w,h,d,mat,x,y,z,shadow){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); if(shadow)m.castShadow=true; return m; }
  function updateBossBar(){ const f=document.getElementById('bossFill'); if(f&&boss)f.style.width=Math.max(0,(boss.hp/boss.maxHp)*100)+'%'; }
  function removeBoss(){ if(!boss)return; scene.remove(boss.g); boss=null; const bar=document.getElementById('bossBar'); if(bar)bar.style.display='none'; }
  function damageBoss(dmg){ if(!boss)return; boss.hp-=dmg; boss.g.children[0].material.emissive&&boss.g.children[0].material.emissive.setHex(0x440044); setTimeout(()=>{if(boss)boss.g.children[0].material.emissive.setHex(0x000000);},120); updateBossBar();
    if (boss.hp<=0){ const bx=boss.g.position.x,by=boss.g.position.y,bz=boss.g.position.z; removeBoss(); addXP(60); for(let k=0;k<8;k++)spawnDrop(I.diamond,1,bx+(Math.random()-0.5)*2,by,bz+(Math.random()-0.5)*2); chatLog('§6你击败了末影龙！§r'); banner('🏆 你击败了末影龙！'); } }
  function bossShoot(){ if(!boss)return; const p=camera.position; const from=boss.g.position; const dir=new THREE.Vector3(p.x-from.x,p.y-from.y,p.z-from.z).normalize(); const mesh=new THREE.Mesh(new THREE.SphereGeometry(0.4,8,8),new THREE.MeshBasicMaterial({color:0xc060ff})); mesh.position.copy(from); scene.add(mesh); projectiles.push({mesh,vel:dir.multiplyScalar(15),life:4,dmg:6,grav:false,kind:'dragon',fromMob:true}); }
  function updateBoss(dt){
    if(!boss)return; boss.t+=dt; const p=camera.position;
    let tx,ty,tz;
    if (boss.swoop>0){ boss.swoop-=dt; tx=p.x; ty=p.y+1.5; tz=p.z; }
    else { const r=22; tx=boss.cx+Math.cos(boss.t*0.5)*r; tz=boss.cz+Math.sin(boss.t*0.5)*r; ty=36+Math.sin(boss.t*0.8)*3; if(Math.random()<dt*0.15)boss.swoop=2.2; }
    const g=boss.g.position; g.x+=(tx-g.x)*Math.min(1,dt*1.2); g.y+=(ty-g.y)*Math.min(1,dt*1.2); g.z+=(tz-g.z)*Math.min(1,dt*1.2);
    boss.g.lookAt(p.x,g.y,p.z);
    const flap=Math.sin(boss.t*6)*0.5; boss.wingL.rotation.z=flap; boss.wingR.rotation.z=-flap;
    const d=Math.hypot(p.x-g.x,p.y-g.y,p.z-g.z); if(d<3.5)hurtPlayer(7*dt,'🐉 末影龙');
    boss.shootCd-=dt; if(boss.shootCd<=0){boss.shootCd=2.5+Math.random()*2; bossShoot();}
  }

  function mobSpawnTick(dt){
    if (!worldReady||player.dead||player.creative) return;
    spawnTimer-=dt; if(spawnTimer>0)return; spawnTimer=2.5+Math.random()*2;
    const cap = curDim==='nether'?14:(curDim==='end'?6:14);
    if (mobs.length>=cap) return;
    let type;
    if (curDim==='nether'){ const r=Math.random(); type = r<0.35?'zombie':(r<0.6?'skeleton':(r<0.85?'blaze':'ghast')); }
    else if (curDim==='end'){ type='enderman'; }
    else {
      if (isNight()){ const r=Math.random(); type = r<0.3?'zombie':(r<0.55?'skeleton':(r<0.75?'creeper':(r<0.9?'spider':'enderman'))); }
      else { const r=Math.random(); type = r<0.35?'pig':(r<0.6?'cow':(r<0.8?'sheep':'chicken')); }
    }
    spawnMob(type);
    if (Math.random()<0.4) spawnMob(type);
  }

  /* ============================================================
     20. 射线 / 挖掘 / 放置 / 近战
     ============================================================ */
  function raycastVoxel(origin, dir, maxDist){
    let x=Math.floor(origin.x), y=Math.floor(origin.y), z=Math.floor(origin.z);
    const sx=Math.sign(dir.x), sy=Math.sign(dir.y), sz=Math.sign(dir.z);
    const dX=dir.x!==0?Math.abs(1/dir.x):Infinity, dY=dir.y!==0?Math.abs(1/dir.y):Infinity, dZ=dir.z!==0?Math.abs(1/dir.z):Infinity;
    let tX=dir.x!==0?(sx>0?x+1-origin.x:origin.x-x)*dX:Infinity;
    let tY=dir.y!==0?(sy>0?y+1-origin.y:origin.y-y)*dY:Infinity;
    let tZ=dir.z!==0?(sz>0?z+1-origin.z:origin.z-z)*dZ:Infinity;
    const n=[0,0,0]; let t=0;
    for (let i=0;i<256;i++){
      const v=getVoxel(x,y,z);
      if (v!==AIR && !isLiquid(v)) return {x,y,z,nx:n[0],ny:n[1],nz:n[2],block:v};
      if (tX<tY&&tX<tZ){x+=sx;t=tX;tX+=dX;n[0]=-sx;n[1]=0;n[2]=0;}
      else if (tY<tZ){y+=sy;t=tY;tY+=dY;n[0]=0;n[1]=-sy;n[2]=0;}
      else {z+=sz;t=tZ;tZ+=dZ;n[0]=0;n[1]=0;n[2]=-sz;}
      if (t>maxDist) break;
    }
    return null;
  }
  // 挖掘时间：硬度 / 工具加成
  function mineTime(blockId){
    const def=BLOCKS[blockId];
    if (def.hardness<0) return Infinity;     // 基岩等
    if (player.creative) return 0;
    let mult=1; const held=heldItem();
    if (held!=null){ const it=ITEMS[held]; if(def.tool && it.toolType===def.tool){ mult=it.mineSpeed; } else if(it.toolType){ mult=1.2; } }
    // 无正确工具时挖掘更慢且某些方块更慢
    const base=def.hardness*1.5;
    return Math.max(0.05, base/mult);
  }
  function startMining(){ const hit=raycastVoxel(camera.position,getLookDir(),REACH); player.breakTarget = hit?{x:hit.x,y:hit.y,z:hit.z,block:hit.block}:null; player.breakT=0; }
  function updateMining(dt){
    if (!mouseDown || player.dead || curScreen){ player.breakTarget=null; player.breakT=0; if(crackMesh)crackMesh.visible=false; return; }
    const hit=raycastVoxel(camera.position,getLookDir(),REACH);
    if (!hit || hit.y<=0){ player.breakTarget=null; player.breakT=0; if(crackMesh)crackMesh.visible=false; return; }
    if (!player.breakTarget || player.breakTarget.x!==hit.x||player.breakTarget.y!==hit.y||player.breakTarget.z!==hit.z){ player.breakTarget={x:hit.x,y:hit.y,z:hit.z,block:hit.block}; player.breakT=0; }
    const need=mineTime(hit.block);
    if (need===Infinity){ return; }
    player.breakT+=dt;
    showCrack(hit.x,hit.y,hit.z, player.breakT/need);
    if (player.breakT>=need){
      breakBlock(hit.x,hit.y,hit.z);
      player.breakTarget=null; player.breakT=0; if(crackMesh)crackMesh.visible=false;
    }
  }
  function breakBlock(x,y,z){
    const v=getVoxel(x,y,z); if(v===AIR||BLOCKS[v].hardness<0) return;
    const held=heldItem(); const tier = held!=null?ITEMS[held].tier:null;
    const dropItem = blockDropItem(v, tier||'wood');
    // 工具消耗
    if (held!=null && ITEMS[held].toolType) damageHeldTool();
    if (dropItem!=null && !player.creative) spawnDrop(dropItem, 1, x+0.5, y+0.5, z+0.5);
    if (v===B.coal_ore) addXP(1+ (Math.random()*2|0));
    if (v===B.diamond_ore) addXP(3+ (Math.random()*4|0));
    // 箱子被破坏：掉落内容
    if (v===B.chest){ const c=getChest(x,y,z); c.forEach(s=>{if(s)spawnDrop(s.item,s.count,x+0.5,y+0.8,z+0.5);}); chestStore.delete(chestKey(x,y,z)); }
    updateVoxel(x,y,z,AIR);
    sfx('dig');
    // 沙/沙砾下落
    settleGravity(x,y+1,z);
    // 传送门破坏 → 整片熄灭
    if (v===B.portal || v===B.obsidian) extinguishPortalAround(x,y,z);
  }
  function settleGravity(x,y,z){
    let v=getVoxel(x,y,z);
    while (v===B.sand||v===B.gravel){
      if (!isSolid(getVoxel(x,y-1,z)) && getVoxel(x,y-1,z)!==B.water){ updateVoxel(x,y,z,AIR); updateVoxel(x,y-1,z,v); y--; }
      else break;
      v=getVoxel(x,y,z);
    }
  }
  function placeBlock(){
    const held=heldStack(); if(!held) return;
    const it=ITEMS[held.item];
    // 右键功能方块 → 打开界面
    const hit=raycastVoxel(camera.position,getLookDir(),REACH);
    if (hit){
      const tb=hit.block;
      if (tb===B.crafting_table){ openScreen('crafting'); return; }
      if (tb===B.furnace){ openFurnacePos={x:hit.x,y:hit.y,z:hit.z}; openScreen('furnace'); return; }
      if (tb===B.chest){ openChestPos={x:hit.x,y:hit.y,z:hit.z}; getChest(hit.x,hit.y,hit.z); openScreen('chest'); return; }
    }
    // 打火石：点燃传送门 / 引燃
    if (it.name==='flint_and_steel'){ if(tryLightPortal(hit)) { damageHeldTool(); return; } }
    // 末影之眼：寻找/激活末地传送门（简化：直接开末地）
    if (it.name==='eye_of_ender'){ if(removeItems(I.eye_of_ender,1)){ banner('末影之眼指向了末地…'); switchTo('end'); } return; }
    // 食物
    if (it.kind==='food'){ eatHeld(); return; }
    // 盔甲：右键穿戴
    if (it.kind==='armor'){ const slot=it.armorSlot; if(!player.armor[slot]){ player.armor[slot]=stackOf(held.item,1); if(held.count>1)held.count--; else player.hotbar[selectedSlot]=null; refreshHotbar(); refreshStats(); return; } }
    // 弓（用剑右键示意射箭？这里改用珍珠）
    if (it.name==='ender_pearl'){ throwEnderPearl(); return; }
    // 放置方块
    if (it.block==null) return;
    if (!hit) return;
    const px=hit.x+hit.nx, py=hit.y+hit.ny, pz=hit.z+hit.nz;
    if (!(py>=0&&py<WORLD_H)) return;
    if (getVoxel(px,py,pz)!==AIR) return;
    if (cellHitsPlayer(px,py,pz) && BLOCKS[it.block].solid) return;
    updateVoxel(px,py,pz, it.block);
    if (!player.creative) consumeHeldOne();
    sfx('place');
  }
  function cellHitsPlayer(x,y,z){ const p=camera.position; return x<p.x+PW&&x+1>p.x-PW&&y<p.y+PHEAD&&y+1>p.y-EYE&&z<p.z+PW&&z+1>p.z-PW; }

  function tryMelee(){
    const dir=getLookDir(); const p=camera.position;
    let best=null,bestDot=0.86,bestDist=REACH+1.2;
    for (let i=0;i<mobs.length;i++){ const m=mobs[i]; const cx=m.pos.x-p.x,cy=(m.pos.y+m.cfg.bh/2)-p.y,cz=m.pos.z-p.z; const d=Math.hypot(cx,cy,cz); if(d>bestDist)continue; const dot=(cx*dir.x+cy*dir.y+cz*dir.z)/(d||1); if(dot>bestDot){best={mob:m,idx:i};bestDot=dot;} }
    let bossHit=false;
    if (boss){ const bx=boss.g.position.x-p.x,by=boss.g.position.y-p.y,bz=boss.g.position.z-p.z; const d=Math.hypot(bx,by,bz); if(d<REACH+4){const dot=(bx*dir.x+by*dir.y+bz*dir.z)/(d||1); if(dot>0.9)bossHit=true;} }
    const held=heldItem(); const atk = held!=null?ITEMS[held].attack:1;
    if (best){ const m=best.mob; m.hp-=atk; m.hurtT=0.25; const il=1/(Math.hypot(m.pos.x-p.x,m.pos.z-p.z)||1); m.vel.y=Math.max(m.vel.y,5); m.pos.x+=(m.pos.x-p.x)*il*0.6; m.pos.z+=(m.pos.z-p.z)*il*0.6; if(held!=null&&ITEMS[held].toolType)damageHeldTool(); if(m.hp<=0)killMob(m,best.idx); sfx('hit'); return true; }
    if (bossHit){ damageBoss(atk*1.5); sfx('hit'); return true; }
    return false;
  }

  /* ---- 挖掘裂纹高亮 ---- */
  let highlight, crackMesh, crackMat;
  function buildHighlight(){
    const e=new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002,1.002,1.002));
    highlight=new THREE.LineSegments(e,new THREE.LineBasicMaterial({color:0x000000,transparent:true,opacity:0.55})); highlight.visible=false; scene.add(highlight);
    crackMat=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.0,depthTest:true});
    crackMesh=new THREE.Mesh(new THREE.BoxGeometry(1.01,1.01,1.01),crackMat); crackMesh.visible=false; scene.add(crackMesh);
  }
  function showCrack(x,y,z,prog){ crackMesh.visible=true; crackMesh.position.set(x+0.5,y+0.5,z+0.5); crackMat.opacity=Math.min(0.6,prog*0.6); }
  function updateHighlight(){
    if (!isLocked){ highlight.visible=false; return; }
    const hit=raycastVoxel(camera.position,getLookDir(),REACH);
    if (hit){ highlight.visible=true; highlight.position.set(hit.x+0.5,hit.y+0.5,hit.z+0.5); }
    else highlight.visible=false;
  }

  /* ============================================================
     21. 传送门（搭建 + 点燃 + 维度切换）
     ============================================================ */
  // 检测以 (x,y,z) 为内部的黑曜石框架（竖直），4 宽 5 高（内部 2x3），简化：找最近的合法框
  function tryLightPortal(hit){
    if (!hit) return false;
    // 在被点击方块上方相邻空气处尝试形成竖直门
    // 简化规则：玩家看向一面黑曜石墙，墙内有 2x3 空气 → 填充 portal
    // 搜索一个以点击点为底框的门：扫描两种朝向
    for (const axis of ['x','z']){
      const frame = findPortalFrame(hit.x, hit.y, hit.z, axis);
      if (frame){ frame.forEach(c=>updateVoxel(c[0],c[1],c[2],B.portal)); sfx('portal'); banner('下界传送门已激活'); return true; }
    }
    return false;
  }
  function findPortalFrame(bx, by, bz, axis){
    // 底部两格黑曜石之上，向上找内部空腔被黑曜石环绕
    // 内部宽 2 高 3：尝试以 (bx,by) 起，axis 方向延展
    const dirv = axis==='x'?[1,0,0]:[0,0,1];
    // 找到底边：要求 (bx,by-1,bz) 与沿 dir 的下一格都是黑曜石（或我们就站在框内底部空气）
    // 这里采用更宽松：以点击的黑曜石为框，向内（法线方向）找 2x3 空气
    // 简化实现：检查标准朝向的固定模板
    for (let ox2=-2; ox2<=0; ox2++){
      const x0=axis==='x'?bx+ox2:bx, z0=axis==='z'?bz+ox2:bz;
      // 内部坐标
      const inner=[];
      let ok=true;
      for (let w=0; w<2; w++) for (let h=0; h<3; h++){
        const ix=x0 + (axis==='x'?(w+1):0);
        const iz=z0 + (axis==='z'?(w+1):0);
        const iy=by + h;
        if (getVoxel(ix,iy,iz)!==AIR){ ok=false; break; }
        inner.push([ix,iy,iz]);
      }
      if (!ok) continue;
      // 检查框架（底、顶、两侧）
      const need=[];
      for (let w=-1; w<=2; w++){ // 底和顶
        need.push([x0+(axis==='x'?w:0), by-1, z0+(axis==='z'?w:0)]);
        need.push([x0+(axis==='x'?w:0), by+3, z0+(axis==='z'?w:0)]);
      }
      for (let h=0; h<3; h++){ // 两侧
        need.push([x0+(axis==='x'?0:0), by+h, z0+(axis==='z'?0:0)]);
        need.push([x0+(axis==='x'?3:0), by+h, z0+(axis==='z'?3:0)]);
      }
      let frameOk=true;
      for (const c of need){ if(getVoxel(c[0],c[1],c[2])!==B.obsidian){ frameOk=false; break; } }
      if (frameOk) return inner;
    }
    return null;
  }
  function extinguishPortalAround(x,y,z){
    // BFS 清除相连 portal
    const stack=[[x,y,z]]; const seen=new Set();
    while (stack.length){ const [cx,cy,cz]=stack.pop(); const k=cx+','+cy+','+cz; if(seen.has(k))continue; seen.add(k); if(getVoxel(cx,cy,cz)!==B.portal)continue; updateVoxel(cx,cy,cz,AIR); [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].forEach(d=>stack.push([cx+d[0],cy+d[1],cz+d[2]])); }
  }
  // 站在传送门里 → 计时切换维度
  let portalT=0;
  function checkPortalStanding(dt){
    const p=camera.position;
    const at=getVoxel(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));
    const atFeet=getVoxel(Math.floor(p.x),Math.floor(p.y-EYE+0.2),Math.floor(p.z));
    if (at===B.portal || atFeet===B.portal){
      portalT+=dt; portalTint(Math.min(1,portalT/1.6));
      if (portalT>=1.6){ portalT=0; switchTo(curDim==='nether'?'overworld':'nether'); }
    } else if (at===B.end_portal || atFeet===B.end_portal){
      portalT+=dt; if(portalT>=0.8){ portalT=0; switchTo(curDim==='end'?'overworld':'end'); }
    } else { portalT=0; portalTint(0); }
  }
  function portalTint(a){ const ov=document.getElementById('portalTint'); if(ov)ov.style.opacity=(a*0.6).toFixed(2); }

  /* ============================================================
     22. 维度切换
     ============================================================ */
  let spawnPoint={x:0,y:40,z:0};
  let switching=false;
  function switchTo(dim){
    if (switching||dim===curDim) return; switching=true;
    const fade=document.getElementById('fade'); if(fade)fade.style.opacity='1';
    setTimeout(()=>{
      // 保存当前维度区块
      dimChunks[curDim] = chunks_snapshot();
      // 切换
      curDim=dim;
      chunks.forEach(c=>{ if(c.mesh){scene.remove(c.mesh);c.mesh.geometry.dispose();} if(c.meshT){scene.remove(c.meshT);c.meshT.geometry.dispose();} });
      chunks.clear(); dirtyChunks.clear(); loadQueue.length=0;
      clearMobs(); removeBoss(); projectiles.forEach((_,i)=>{}); while(projectiles.length)rmProj(0);
      drops.forEach(d=>scene.remove(d.mesh)); drops.length=0;
      // 恢复该维度区块（若有）
      const saved=dimChunks[dim];
      if (saved && saved.size){ saved.forEach((data,k)=>{ const [cx,cz]=k.split(',').map(Number); chunks.set(k,{data,mesh:null,meshT:null,cx,cz,dirty:false,generated:true}); }); }
      // 出生点
      decideSpawn(dim);
      camera.position.set(spawnPoint.x,spawnPoint.y,spawnPoint.z); player.vel.set(0,0,0);
      streamChunks(); processLoadQueue(64); rebuildDirty(64);
      applyDimLighting(dim);
      const db=document.getElementById('dimText'); if(db)db.textContent=DIMS[dim].name;
      const di=document.querySelector('#dimBadge .ic'); if(di)di.textContent=DIMS[dim].icon;
      if (dim==='end') summonBoss();
      if (fade) setTimeout(()=>fade.style.opacity='0',60);
      switching=false;
      chatLog('进入了'+DIMS[dim].name);
    },420);
  }
  function chunks_snapshot(){ const m=new Map(); chunks.forEach((c,k)=>m.set(k,c.data)); return m; }
  function decideSpawn(dim){
    // 找一个安全地表
    let bx=0,bz=0;
    if (dim==='end'){ bx=0; bz=0; }
    // 确保区块生成
    const cx=Math.floor(bx/CHUNK), cz=Math.floor(bz/CHUNK);
    for (let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) ensureChunk(cx+dx,cz+dz);
    let sy=topSolidY(bx,bz);
    if (sy<0){ for(let r=1;r<8&&sy<0;r++){ ensureChunk(Math.floor((bx+r)/CHUNK),cz); sy=topSolidY(bx+r,bz); if(sy>=0){bx+=r;} } }
    if (sy<0) sy=SEA;
    spawnPoint={x:bx+0.5,y:sy+2.2,z:bz+0.5};
    if (!player.spawn) player.spawn={...spawnPoint};
  }

  /* ============================================================
     23. 朝向 / 第一人称控制 / 物理
     ============================================================ */
  const _look=new THREE.Vector3();
  function getLookDir(){ const cp=Math.cos(pitch); _look.set(Math.sin(yaw)*cp, Math.sin(pitch), Math.cos(yaw)*cp).normalize(); return _look; }
  function applyLook(){ camera.rotation.set(0,0,0); camera.rotateY(yaw); camera.rotateX(pitch); }

  function collideAxis(np, axis){
    const p=camera.position;
    const minX=Math.floor(np.x-PW), maxX=Math.floor(np.x+PW);
    const minY=Math.floor(np.y-EYE), maxY=Math.floor(np.y+PHEAD);
    const minZ=Math.floor(np.z-PW), maxZ=Math.floor(np.z+PW);
    for (let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)for(let z=minZ;z<=maxZ;z++){
      if (isSolid(getVoxel(x,y,z))) return true;
    }
    return false;
  }
  function updateMovement(dt){
    if (!worldReady||player.dead||curScreen) { return; }
    const p=camera.position;
    // 输入方向
    let fx=0,fz=0;
    if (keys['KeyW'])fz-=1; if(keys['KeyS'])fz+=1; if(keys['KeyA'])fx-=1; if(keys['KeyD'])fx+=1;
    const len=Math.hypot(fx,fz)||1; fx/=len; fz/=len;
    // 相机以 rotateY(yaw) 定向：前方(forward)= -Z 方向旋转后 = (-sin yaw, -cos yaw)
    let mvx = 0, mvz = 0;
    {
      const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
      const rightX   =  Math.cos(yaw), rightZ   = -Math.sin(yaw);
      mvx = forwardX*(-fz) + rightX*(fx);
      mvz = forwardZ*(-fz) + rightZ*(fx);
    }

    player.sprint = !!keys['ShiftLeft'] && (keys['KeyW']) ;
    let speed = player.fly ? FLY_SPEED : (player.sprint?SPRINT:WALK);

    if (player.fly){
      player.vel.x=mvx*speed; player.vel.z=mvz*speed;
      let vy=0; if(keys['Space'])vy+=1; if(keys['ControlLeft']||keys['KeyC'])vy-=1; player.vel.y=vy*speed;
    } else {
      // 水平加速
      player.vel.x=mvx*speed; player.vel.z=mvz*speed;
      player.vel.y-=GRAVITY*dt;
      if (player.vel.y<-55)player.vel.y=-55;
      // 游泳/水中
      const inWater = getVoxel(Math.floor(p.x),Math.floor(p.y-1),Math.floor(p.z))===B.water || getVoxel(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))===B.water;
      if (inWater){ player.vel.y=Math.max(player.vel.y,-3); if(keys['Space'])player.vel.y=4; player.vel.x*=0.6; player.vel.z*=0.6; }
    }

    // 逐轴碰撞
    const np=p.clone();
    np.x+=player.vel.x*dt; if(collideAxis(np,'x')){ np.x=p.x; player.vel.x=0; }
    np.z+=player.vel.z*dt; if(collideAxis(np,'z')){ np.z=p.z; player.vel.z=0; }
    np.y+=player.vel.y*dt;
    if (collideAxis(np,'y')){
      if (player.vel.y<0){
        // 落地
        if (player.fallStart!=null && !player.fly){ const fall=player.fallStart-np.y; if(fall>3.5){ hurtPlayer(Math.floor(fall-3), '摔落', true); } }
        player.onGround=true; player.fallStart=null;
      }
      np.y=p.y; player.vel.y=0;
    } else {
      player.onGround=false;
      if (player.vel.y<0 && player.fallStart==null && !player.fly) player.fallStart=p.y;
      if (player.vel.y>0) player.fallStart=null;
    }
    camera.position.copy(np);

    // 跳跃
    if (keys['Space'] && player.onGround && !player.fly){ player.vel.y=JUMP; player.onGround=false; player.fallStart=null; }
    // 虚空
    if (camera.position.y<-32){ if(player.creative){camera.position.y=60;player.vel.y=0;} else { hurtPlayer(6,'虚空',true); if(player.hp>0){camera.position.y=60;player.vel.y=0;} } }
  }

  /* ============================================================
     24. 音效（WebAudio 合成，无需外部文件）
     ============================================================ */
  let actx=null, sfxOn=true;
  function ensureAudio(){ if(!actx){ try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ sfxOn=false; } } if(actx&&actx.state==='suspended')actx.resume(); }
  function tone(freq, dur, type, vol, slideTo){
    if (!sfxOn||!actx) return;
    const o=actx.createOscillator(), g=actx.createGain();
    o.type=type||'square'; o.frequency.value=freq;
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, actx.currentTime+dur);
    g.gain.value=(vol||0.12); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime+dur);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime+dur);
  }
  function noiseBurst(dur, vol){
    if (!sfxOn||!actx) return;
    const n=actx.sampleRate*dur, buf=actx.createBuffer(1,n,actx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);
    const s=actx.createBufferSource(); s.buffer=buf; const g=actx.createGain(); g.gain.value=vol||0.15; s.connect(g); g.connect(actx.destination); s.start();
  }
  function sfx(name){
    if (!sfxOn||!actx) return;
    switch(name){
      case 'dig': noiseBurst(0.08,0.10); break;
      case 'place': tone(180,0.08,'square',0.10,120); break;
      case 'hurt': tone(160,0.18,'sawtooth',0.16,90); break;
      case 'eat': tone(300,0.06,'sine',0.08); break;
      case 'pop': tone(520,0.06,'sine',0.10,720); break;
      case 'break': noiseBurst(0.14,0.16); break;
      case 'level': tone(523,0.12,'sine',0.12); setTimeout(()=>tone(784,0.16,'sine',0.12),110); break;
      case 'boom': noiseBurst(0.5,0.4); tone(60,0.5,'sawtooth',0.3,30); break;
      case 'hit': tone(220,0.05,'square',0.12,160); break;
      case 'portal': tone(300,0.4,'sine',0.10,500); break;
    }
  }

  /* ============================================================
     25. 聊天 + 指令系统
     ============================================================ */
  let chatOpen=false;
  const chatHistory=[]; let histIdx=-1;
  function chatLog(msg){
    const log=document.getElementById('chatLog'); if(!log)return;
    const line=document.createElement('div'); line.className='chatline'; line.innerHTML=parseColor(msg);
    log.appendChild(line);
    while (log.children.length>60) log.removeChild(log.firstChild);
    log.scrollTop=log.scrollHeight;
    line.style.animation='chatfade 9s forwards';
  }
  function parseColor(s){
    // 简易 §颜色码
    const map={'0':'#000','1':'#2a2acc','2':'#2acc2a','4':'#cc4040','5':'#a040c0','6':'#e0a000','r':'inherit','f':'#fff','7':'#aaa','e':'#ffe040'};
    s=String(s).replace(/</g,'&lt;');
    let out='', i=0, open=false;
    while (i<s.length){ if(s[i]==='§'){ const c=s[i+1]; i+=2; if(open)out+='</span>'; if(c==='r'){open=false;continue;} out+='<span style="color:'+(map[c]||'#fff')+'">'; open=true; } else { out+=s[i++]; } }
    if (open)out+='</span>';
    return out;
  }
  function banner(text){
    const b=document.getElementById('banner'); if(!b)return;
    b.textContent=text; b.style.opacity='1'; b.style.transform='translateX(-50%) scale(1)';
    clearTimeout(b._t); b._t=setTimeout(()=>{ b.style.opacity='0'; },2600);
  }
  function openChat(prefill){
    chatOpen=true; const bar=document.getElementById('chatBar'); const inp=document.getElementById('chatInput');
    if(!bar||!inp)return; bar.style.display='block'; inp.value=prefill||''; document.exitPointerLock();
    setTimeout(()=>inp.focus(),0); histIdx=chatHistory.length;
  }
  function closeChat(send){
    const bar=document.getElementById('chatBar'); const inp=document.getElementById('chatInput');
    if(bar)bar.style.display='none'; chatOpen=false;
    if (send && inp && inp.value.trim()){ const txt=inp.value.trim(); chatHistory.push(txt); if(txt[0]==='/'){ runCommand(txt.slice(1)); } else { chatLog('§e<玩家>§r '+txt); } }
    if (inp) inp.value='';
    if (worldReady && !player.dead && curScreen==null) renderer.domElement.requestPointerLock();
  }
  function findItemByName(n){
    n=n.toLowerCase().replace(/^minecraft:/,'');
    if (I[n]!=null) return I[n];
    // 中文名匹配
    for (let i=0;i<ITEMS.length;i++){ if(ITEMS[i].label===n) return i; }
    // 部分匹配
    for (let i=0;i<ITEMS.length;i++){ if(ITEMS[i].name.indexOf(n)>=0||ITEMS[i].label.indexOf(n)>=0) return i; }
    return null;
  }
  function runCommand(cmd){
    const a=cmd.trim().split(/\s+/); const name=a[0].toLowerCase();
    const reply=(m)=>chatLog(m);
    try{
    switch(name){
      case 'help': case '?':
        reply('§e可用指令：§r/give /tp /gamemode /time /weather /summon /kill /clear /xp /heal /seed /effect /setblock /fill /spawn /home /list');
        reply('例：/give diamond_sword 1 · /tp 0 80 0 · /gamemode creative · /time night · /summon zombie');
        break;
      case 'give': {
        const it=findItemByName(a[1]||''); const n=parseInt(a[2]||'1')||1;
        if (it==null){ reply('§4未找到物品：'+(a[1]||'')); break; }
        addItem(it,n); reply('§a已给予 '+n+' × '+ITEMS[it].label);
        break; }
      case 'tp': case 'teleport': {
        if (a.length>=4){ const x=+a[1],y=+a[2],z=+a[3]; if([x,y,z].every(v=>!isNaN(v))){ camera.position.set(x,y,z); player.vel.set(0,0,0); reply('§a已传送到 '+x+' '+y+' '+z); } }
        else reply('§4用法：/tp x y z');
        break; }
      case 'gamemode': case 'gm': {
        const m=(a[1]||'').toLowerCase();
        if (m==='creative'||m==='c'||m==='1'){ if(!player.creative)toggleCreative(); }
        else if (m==='survival'||m==='s'||m==='0'){ if(player.creative)toggleCreative(); }
        else reply('§4用法：/gamemode creative|survival'); break; }
      case 'time': {
        const m=(a[1]||'').toLowerCase();
        if (m==='day'||m==='1000') timeOfDay=0.3;
        else if (m==='night'||m==='13000') timeOfDay=0.75;
        else if (m==='noon') timeOfDay=0.5;
        else if (m==='midnight') timeOfDay=0.0;
        else if (!isNaN(+m)){ timeOfDay=((+m)%24000)/24000; }
        else { reply('§4用法：/time day|night|noon|midnight'); break; }
        reply('§a时间已设置'); break; }
      case 'weather': reply('§7（本模拟暂无降雨系统）'); break;
      case 'summon': {
        const t=(a[1]||'').toLowerCase().replace(/^minecraft:/,'');
        if (MOB[t]){ const m=spawnMob(t, camera.position.x+ (getLookDir().x*4), camera.position.z+(getLookDir().z*4)); reply(m?('§a已生成 '+mobName(t)):'§4此处无法生成'); }
        else if (t==='ender_dragon'||t==='dragon'){ summonBoss(); reply('§a已召唤末影龙'); }
        else reply('§4未知生物。可用：pig cow sheep chicken zombie skeleton creeper spider enderman blaze ghast ender_dragon'); break; }
      case 'kill': {
        if (a[1]==='@e'||a[1]==='all'){ while(mobs.length)killMob(mobs[0],0); removeBoss(); reply('§a已清除所有生物'); }
        else { hurtPlayer(1000,'/kill',true); reply('§7你被清除了'); } break; }
      case 'clear': { player.hotbar=new Array(HOTBAR_N).fill(null); player.inv=new Array(INV_N).fill(null); refreshHotbar(); reply('§a背包已清空'); break; }
      case 'xp': case 'experience': { const n=parseInt(a[1]||'0')||0; addXP(n); reply('§a获得 '+n+' 经验'); break; }
      case 'heal': { healPlayer(); reply('§a已恢复生命与饥饿'); break; }
      case 'seed': { reply('§a世界种子：§f'+WORLD_SEED); break; }
      case 'effect': {
        const e=(a[1]||'').toLowerCase();
        if (e==='speed'){ reply('§a（提示）使用 F 开关飞行更快'); }
        else if (e==='regeneration'||e==='heal'){ healPlayer(); reply('§a已治疗'); }
        else reply('§7支持：regeneration（治疗）'); break; }
      case 'setblock': {
        if (a.length>=5){ const x=+a[1],y=+a[2],z=+a[3]; const b=a[4].toLowerCase().replace(/^minecraft:/,''); if(B[b]!=null){ updateVoxel(x,y,z,B[b]); reply('§a已放置 '+b); } else reply('§4未知方块'); }
        else reply('§4用法：/setblock x y z 方块名'); break; }
      case 'fill': {
        if (a.length>=8){ const x1=+a[1],y1=+a[2],z1=+a[3],x2=+a[4],y2=+a[5],z2=+a[6]; const b=a[7].toLowerCase(); if(B[b]==null){reply('§4未知方块');break;} let n=0; for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++)for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++)for(let z=Math.min(z1,z2);z<=Math.max(z1,z2);z++){if(n>4000)break;setVoxelRaw(x,y,z,B[b]);n++;} chunks.forEach(c=>{c.dirty=true;dirtyChunks.add(c);}); reply('§a已填充 '+n+' 个方块'); }
        else reply('§4用法：/fill x1 y1 z1 x2 y2 z2 方块名'); break; }
      case 'spawn': case 'home': { respawnPos(); reply('§a已回到出生点'); break; }
      case 'setspawn': { player.spawn={x:camera.position.x,y:camera.position.y,z:camera.position.z}; reply('§a已设置出生点'); break; }
      case 'list': { reply('§7在线：玩家（你）· 生物 '+mobs.length+' 只'); break; }
      case 'tp_dim': case 'dimension': { const d=(a[1]||'').toLowerCase(); if(DIMS[d])switchTo(d); else reply('§4维度：overworld nether end'); break; }
      default: reply('§4未知指令："/'+name+'"，输入 /help 查看帮助');
    }
    }catch(err){ reply('§4指令出错：'+err.message); }
  }

  /* ============================================================
     26. 世界导出 / 导入（.json 文件）
     ============================================================ */
  function serializeSlot(s){ if(!s)return null; const o={i:s.item,c:s.count}; if(s.dur!=null)o.d=s.dur; return o; }
  function deserSlot(o){ if(!o)return null; const s={item:o.i,count:o.c}; if(o.d!=null)s.dur=o.d; return s; }
  function exportWorld(){
    // 仅导出“已生成且有改动”的当前维度方块 + 各维度改动快照
    dimChunks[curDim]=chunks_snapshot();
    const dimData={};
    for (const dim in dimChunks){
      const m=dimChunks[dim]; if(!m||!m.size)continue;
      const arr=[];
      m.forEach((data,k)=>{
        // 压缩：记录非空气方块的 RLE
        const rle=[]; let prev=data[0],run=1;
        for (let i=1;i<data.length;i++){ if(data[i]===prev){run++;} else {rle.push(prev,run);prev=data[i];run=1;} }
        rle.push(prev,run);
        arr.push({k, rle});
      });
      dimData[dim]=arr;
    }
    const save={
      version:2, seed:WORLD_SEED, dim:curDim, time:timeOfDay, day:dayCount,
      player:{
        x:camera.position.x,y:camera.position.y,z:camera.position.z, yaw,pitch,
        hp:player.hp,hunger:player.hunger,xp:player.xp,level:player.level,creative:player.creative,
        hotbar:player.hotbar.map(serializeSlot), inv:player.inv.map(serializeSlot),
        armor:{head:serializeSlot(player.armor.head),chest:serializeSlot(player.armor.chest),legs:serializeSlot(player.armor.legs),feet:serializeSlot(player.armor.feet)},
        spawn:player.spawn
      },
      chests:[...chestStore.entries()].map(([k,arr])=>[k,arr.map(serializeSlot)]),
      dims:dimData
    };
    const blob=new Blob([JSON.stringify(save)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download='mc-world-'+WORLD_SEED+'-'+Date.now()+'.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    chatLog('§a世界已导出为 .json 文件');
  }
  function importWorldData(save){
    if (!save||!save.seed){ alert('存档无效'); return; }
    // 重置
    chunks.forEach(c=>{ if(c.mesh){scene.remove(c.mesh);c.mesh.geometry.dispose();} if(c.meshT){scene.remove(c.meshT);c.meshT.geometry.dispose();} });
    chunks.clear(); dirtyChunks.clear(); loadQueue.length=0; clearMobs(); removeBoss(); while(projectiles.length)rmProj(0); drops.forEach(d=>scene.remove(d.mesh)); drops.length=0;
    dimChunks.overworld=new Map(); dimChunks.nether=new Map(); dimChunks.end=new Map();
    chestStore.clear();
    initNoise(save.seed>>>0);
    // 维度数据
    for (const dim in (save.dims||{})){
      const m=new Map();
      save.dims[dim].forEach(rec=>{
        const data=new Uint8Array(CHUNK*WORLD_H*CHUNK); let p=0;
        const rle=rec.rle; for(let i=0;i<rle.length;i+=2){ const val=rle[i],run=rle[i+1]; for(let j=0;j<run;j++)data[p++]=val; }
        m.set(rec.k,data);
      });
      dimChunks[dim]=m;
    }
    (save.chests||[]).forEach(([k,arr])=>chestStore.set(k,arr.map(deserSlot)));
    curDim=save.dim||'overworld'; timeOfDay=save.time||0.3; dayCount=save.day||1;
    // 恢复玩家
    const pl=save.player||{};
    player.hp=pl.hp||20; player.hunger=pl.hunger||20; player.xp=pl.xp||0; player.level=pl.level||0; player.creative=!!pl.creative;
    player.hotbar=(pl.hotbar||[]).map(deserSlot); while(player.hotbar.length<HOTBAR_N)player.hotbar.push(null);
    player.inv=(pl.inv||[]).map(deserSlot); while(player.inv.length<INV_N)player.inv.push(null);
    player.armor={head:deserSlot(pl.armor&&pl.armor.head),chest:deserSlot(pl.armor&&pl.armor.chest),legs:deserSlot(pl.armor&&pl.armor.legs),feet:deserSlot(pl.armor&&pl.armor.feet)};
    player.spawn=pl.spawn||null; player.dead=false;
    // 当前维度区块
    const saved=dimChunks[curDim];
    if (saved){ saved.forEach((data,k)=>{ const [cx,cz]=k.split(',').map(Number); chunks.set(k,{data,mesh:null,meshT:null,cx,cz,dirty:false,generated:true}); }); }
    camera.position.set(pl.x||0,pl.y||50,pl.z||0); yaw=pl.yaw||0; pitch=pl.pitch||0; applyLook();
    streamChunks(); processLoadQueue(80); rebuildDirty(80);
    applyDimLighting(curDim);
    const db=document.getElementById('dimText'); if(db)db.textContent=DIMS[curDim].name;
    const bm=document.getElementById('btnMode'); if(bm)bm.textContent='模式：'+(player.creative?'创造':'生存');
    refreshHotbar();
    const d=document.getElementById('death'); if(d)d.style.display='none';
    chatLog('§a世界已导入（种子 '+WORLD_SEED+'）');
    banner('世界已载入');
  }
  function triggerImport(){
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
    inp.onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{ try{ importWorldData(JSON.parse(r.result)); }catch(err){ alert('读取失败：'+err.message); } }; r.readAsText(f); };
    inp.click();
  }

  /* ============================================================
     27. 事件（键鼠 / 指针锁定 / UI 按钮）
     ============================================================ */
  let mouseDown=false, rightHeld=false;
  function setupEvents(){
    const cv=renderer.domElement;
    cv.addEventListener('click',()=>{ if(!isLocked && !player.dead && !curScreen && !chatOpen && worldReady){ ensureAudio(); cv.requestPointerLock(); } });
    document.addEventListener('pointerlockchange',()=>{ isLocked=(document.pointerLockElement===cv); const cr=document.getElementById('crosshair'); if(cr)cr.style.opacity=isLocked?'1':'0'; });
    document.addEventListener('mousemove',e=>{ if(!isLocked)return; const s=0.0024; yaw-=e.movementX*s; pitch-=e.movementY*s; const lim=Math.PI/2-0.02; pitch=Math.max(-lim,Math.min(lim,pitch)); applyLook(); });
    cv.addEventListener('mousedown',e=>{
      if (!isLocked) return; e.preventDefault();
      if (e.button===0){ mouseDown=true; // 左键：挖/打
        if (!tryMelee()){ startMining(); }
      } else if (e.button===2){ rightHeld=true; placeBlock(); }
    });
    window.addEventListener('mouseup',e=>{ if(e.button===0){mouseDown=false; if(crackMesh)crackMesh.visible=false; player.breakT=0;} if(e.button===2)rightHeld=false; });
    cv.addEventListener('contextmenu',e=>e.preventDefault());
    cv.addEventListener('wheel',e=>{ if(!isLocked)return; e.preventDefault(); if(e.deltaY>0)selectSlot((selectedSlot+1)%HOTBAR_N); else selectSlot((selectedSlot+HOTBAR_N-1)%HOTBAR_N); },{passive:false});

    document.addEventListener('keydown',e=>{
      // 聊天打开时只处理回车/Esc/上下
      if (chatOpen){
        if (e.code==='Enter'){ e.preventDefault(); closeChat(true); }
        else if (e.code==='Escape'){ e.preventDefault(); closeChat(false); }
        else if (e.code==='ArrowUp'){ e.preventDefault(); if(histIdx>0){histIdx--; document.getElementById('chatInput').value=chatHistory[histIdx]||'';} }
        else if (e.code==='ArrowDown'){ e.preventDefault(); if(histIdx<chatHistory.length-1){histIdx++; document.getElementById('chatInput').value=chatHistory[histIdx]||'';} }
        return;
      }
      if (curScreen){ if(e.code==='Escape'||e.code==='KeyE'){ e.preventDefault(); closeScreen(); } return; }
      if (player.dead){ if(e.code==='Enter'||e.code==='Space'){ respawnPlayer(); } return; }
      keys[e.code]=true;
      if (e.code.startsWith('Digit')){ const n=+e.code.slice(5); if(n>=1&&n<=9)selectSlot(n-1); }
      switch(e.code){
        case 'KeyE': e.preventDefault(); openScreen('inventory'); break;
        case 'KeyT': e.preventDefault(); ensureAudio(); openChat(''); break;
        case 'Slash': e.preventDefault(); ensureAudio(); openChat('/'); break;
        case 'KeyF': player.fly=!player.fly; player.vel.y=0; chatLog(player.fly?'§7飞行：开':'§7飞行：关'); break;
        case 'KeyQ': { const s=heldStack(); if(s){ spawnDrop(s.item,1,camera.position.x+getLookDir().x,camera.position.y-0.3,camera.position.z+getLookDir().z); consumeHeldOne(); } break; }
        case 'Escape': if(isLocked)document.exitPointerLock(); break;
        case 'KeyP': { // 调试快捷切维度
          break; }
      }
    });
    document.addEventListener('keyup',e=>{ keys[e.code]=false; });

    // 顶部按钮
    bindBtn('backBtn',()=>{ window.location.href='index.html'; });
    bindBtn('btnMode',()=>toggleCreative());
    bindBtn('btnDim',()=>{ const order=['overworld','nether','end']; switchTo(order[(order.indexOf(curDim)+1)%3]); });
    bindBtn('btnGfx',()=>setShadows(!shadowsOn));
    bindBtn('btnExport',()=>exportWorld());
    bindBtn('btnImport',()=>triggerImport());
    bindBtn('btnChat',()=>{ ensureAudio(); openChat(''); });
    bindBtn('respawnBtn',()=>respawnPlayer());

    window.addEventListener('resize',onResize);
    window.addEventListener('blur',()=>{ for(const k in keys)keys[k]=false; mouseDown=false; });
  }
  function bindBtn(id,fn){ const b=document.getElementById(id); if(b)b.addEventListener('click',e=>{e.preventDefault();fn();}); }
  function onResize(){ if(!renderer)return; camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth,window.innerHeight); }

  /* ============================================================
     28. 初始化 + 主循环
     ============================================================ */
  function getSeedFromURL(){
    const p=new URLSearchParams(location.search);
    let s=p.get('seed');
    const mode=p.get('mode');
    if (mode==='creative') player.creative=true;
    if (s==null||s==='') return (Math.random()*1e9)|0;
    // 字符串种子 -> 数字
    if (/^-?\d+$/.test(s)) return parseInt(s)>>>0;
    let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h>>>0;
  }
  function init(){
    scene=new THREE.Scene(); scene.background=new THREE.Color(0xbcd6f0);
    scene.fog=new THREE.Fog(0xbcd6f0, 60, RENDER_CHUNKS*CHUNK*0.95);
    camera=new THREE.PerspectiveCamera(72, window.innerWidth/window.innerHeight, 0.1, 1000);
    const cv=document.getElementById('app');
    renderer=new THREE.WebGLRenderer({canvas:cv, antialias:false, powerPreference:'high-performance'});
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 1.5));
    renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;

    buildAtlas(); buildLights(); buildSky(); buildHighlight(); buildHearts();

    const seed=getSeedFromURL(); initNoise(seed);
    const sl=document.getElementById('seedLabel'); if(sl)sl.textContent='种子：'+seed;

    // 生成出生区
    setOverlay('生成世界…','正在雕刻地形与洞穴');
    decideSpawn('overworld');
    camera.position.set(spawnPoint.x,spawnPoint.y,spawnPoint.z);
    // 预载出生周围
    streamChunks(); processLoadQueue(120); rebuildDirty(120);

    const bm=document.getElementById('btnMode'); if(bm)bm.textContent='模式：'+(player.creative?'创造':'生存');
    setupEvents(); applyLook(); refreshHotbar();

    // 进入按钮
    const ov=document.getElementById('overlay'), play=document.getElementById('ovPlay'), lb=document.getElementById('loadBar');
    if (lb)lb.style.width='100%';
    setOverlay('准备就绪','点击开始你的冒险');
    if (play){ play.style.display='inline-block'; play.addEventListener('click',()=>{ ensureAudio(); if(ov)ov.style.display='none'; worldReady=true; cv.requestPointerLock(); banner('欢迎来到 第 1 天'); chatLog('§e提示：§rWASD 移动 · 空格跳 · F 飞行 · E 背包 · T 聊天/指令 · 左键挖 · 右键放'); }); }

    requestAnimationFrame(loop);
  }
  function setOverlay(title,text){ const t=document.getElementById('ovTitle'),x=document.getElementById('ovText'); if(t)t.textContent=title; if(x)x.textContent=text; }

  let lastT=performance.now(), acc=0;
  let frameSkip=0;
  function loop(now){
    requestAnimationFrame(loop);
    let dt=(now-lastT)/1000; lastT=now;
    if (dt>0.1) dt=0.1;               // 防卡顿跳变
    if (!worldReady){ renderer.render(scene,camera); return; }

    // 物理与逻辑
    try{ updateMovement(dt); }catch(e){}
    try{ updateMining(dt); }catch(e){}
    try{ streamChunks(); }catch(e){}
    try{ processLoadQueue(2); }catch(e){}   // 每帧最多生成 2 区块，平滑
    try{ rebuildDirty(3); }catch(e){}
    try{ survivalTick(dt); }catch(e){}
    try{ updateDrops(dt); }catch(e){}
    try{ updateMobs(dt); }catch(e){}
    try{ updateBoss(dt); }catch(e){}
    try{ updateProjectiles(dt); }catch(e){}
    try{ mobSpawnTick(dt); }catch(e){}
    try{ checkPortalStanding(dt); }catch(e){}
    try{ tickFurnaces(dt); }catch(e){}
    try{ dayNight(dt); }catch(e){}
    try{ updateHighlight(); }catch(e){}

    // 天空/太阳跟随相机
    if (skyMesh) skyMesh.position.copy(camera.position);
    if (cloudPlane){ cloudPlane.position.x=camera.position.x; cloudPlane.position.z=camera.position.z; if(cloudTex)cloudTex.offset.x=(now*0.000006); }
    if (curDim==='overworld' && sun){
      const a=timeOfDay*Math.PI*2; const sx=Math.cos(a)*100, sy=Math.sin(a)*100;
      sun.position.set(camera.position.x+sx, camera.position.y+sy+20, camera.position.z+40);
      sun.target.position.copy(camera.position); sun.target.updateMatrixWorld();
      if (sunDisc) sunDisc.position.set(camera.position.x+sx*2.2, camera.position.y+sy*2.2, camera.position.z+80);
      if (moonMesh) moonMesh.position.set(camera.position.x-sx*2.2, camera.position.y-sy*2.2, camera.position.z-80);
    }

    renderer.render(scene,camera);
  }

  // 暴露少量调试接口
  window.MC = { exportWorld, importWorldData, runCommand, player, give:(n,c)=>{const it=findItemByName(n);if(it!=null)addItem(it,c||1);} };

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

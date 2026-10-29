---
name: html-dynamic-ppt
description: 生成与 mini-claude-code/docs 系列（m4.1 / m5 / m6）完全一致的 HTML 动态 PPT。当用户要求「制作 HTML 演示文稿 / 动态 PPT / 幻灯片 / 手搓系列的 PPT / 原理讲解动画页」时使用。核心：1920×1080 等比缩放舞台 + 深色暖橙主题 + 逐元素时间轴编排的 CSS 动画 + 点击/键盘翻页。
---

# HTML 动态 PPT 生成规范

## 概述

把任意技术主题制作成一份**单文件 HTML 动态 PPT**，视觉与交互风格完全对齐 `D:\workspace\202608\mini-claude-code\docs\` 下的 `m4.1.html` / `m5.html` / `m6.html`（作者「程序员 Cobyte」的手搓系列）。

三份样本共享同一套技术骨架，差异只在「每页内容 + 具体组件 + 动画时间编排」。本规范把骨架、设计系统、动画库、组件目录、工作流程全部固化，后续据此可生成**一模一样**的动态 PPT。

## 技术原理 DNA（务必内化）

1. **单文件、零依赖**——一个 `.html`，内联全部 CSS/JS，唯一外部资源是 Google Fonts（字体）。
2. **固定 1920×1080 舞台，JS 等比缩放**——`#stage` 写死 1920×1080，用 `transform: scale()` 按窗口比例缩放居中，任何屏幕比例都完整显示，不重排布局。
3. **深色暖橙主题 + CSS 变量**——深棕底 `#1B1410`、卡牌 `#261B14`、强调橙 `#D97757`、正文奶油 `#F5EDE4`、次要灰 `#A89888`。
4. **字体双轨**——中文用 `Noto Sans SC`，代码/英文用 `JetBrains Mono`（`.mono` 类）。
5. **动画 = 时间轴编排**——每个元素初始 `opacity:0`，进入由 `.slide.play` 触发；每个元素带一个**明确的秒级延迟**，逐条在时间轴上错开，形成「叙事式逐帧展开」。重播靠「移除 `play` 类 → 强制回流 → 重新加回」。
6. **翻页交互**——点击任意处或按 →/空格/Enter 下一页，← 上一页，R 重播当前页。

---

## 一、页面骨架（必须照抄的结构）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>标题</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
<style>/* 见下 */</style>
</head>
<body>
<div id="stage">
  <section class="slide active" id="slide0">…</section>
  <section class="slide" id="slide1">…</section>
  …
</div>
<script>/* 见下 */</script>
</body>
</html>
```

完整可复制模板见 `references/template.html`（含全部 CSS 变量、关键帧库、JS 控制器与示范页）。

---

## 二、设计系统（CSS 变量 + 全局）

```css
:root{
  --bg:#1B1410; --card:#261B14; --card-line:#3D2B1F;
  --orange:#D97757; --cream:#F5EDE4; --muted:#A89888;
  --bar-dark:#2A1D15; --bar-line:#4A3527;
}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;background:var(--bg);overflow:hidden;
  font-family:'Noto Sans SC',sans-serif;}
body{display:flex;align-items:center;justify-content:center;}
.mono{font-family:'JetBrains Mono',monospace;}

#stage{width:1920px;height:1080px;position:relative;flex:none;
  background:var(--bg);overflow:hidden;cursor:pointer;
  transform-origin:center center;}

.slide{position:absolute;inset:0;padding:100px;display:none;
  flex-direction:column;gap:36px;}
.slide.active{display:flex;}
```

补充色板（常用派生色）：
- 代码/终端底：`#211710`；高亮卡底/激活态：`#2A1B12`
- 代码高亮背景：`rgba(217,119,87,.16)`，左竖线 `3px solid var(--orange)`
- 字符串/关键字橙：`#E0977B`（代码内浅橙）
- 辉光橙：`rgba(217,119,87,.35~.7)`

---

## 三、动画系统（核心机制）

### 3.1 触发机制（三层）

```css
/* ① 所有待动画元素默认隐藏 */
.anim{opacity:0;}
/* ② 具体组件类也自带 opacity:0（如 .chip、.cline、.pcard） */

/* ③ 只有当前 slide 加了 .play 才播放，且 forwards 保持最终态 */
.slide.play .anim{animation-fill-mode:forwards;}
.slide.play .d0{animation:fadeUp .6s ease .1s forwards;}
.slide.play .d1{animation:fadeUp .6s ease .35s forwards;}
.slide.play .d2{animation:fadeUp .6s ease .6s forwards;}
```

**关键规则**：
- 时间轴用**绝对秒**：`animation: fadeUp .6s ease 1.4s forwards` = 持续 0.6s，延迟 1.4s。
- 同一页内所有延迟从 0 累加，构成一条连续叙事线（通常从 `.9s` 起到 6~9s 结束）。
- 每个「逻辑单元」的延迟间隔约 **0.3~0.5s**，代码行逐行 `0.15~0.3s` 递增。

### 3.2 关键帧库（全部内建，照抄即可）

| keyframes | 效果 | 用途 |
|---|---|---|
| `fadeUp` | 透明 + 上移 28px → 原位 | 标题/卡牌/区块进场 |
| `fadeIn` | 仅透明 0→1 | 文字/标签/代码行进场 |
| `fadeOut` | 透明 →0 | 状态切换（OPEN→CLOSED） |
| `popIn` | scale .85→1.03→1 | 卡牌/徽章「弹出」 |
| `drawX` | scaleX 0→1（原点左） | 横向线条/进度条绘制 |
| `drawY` | scaleY 0→1（原点顶） | 纵向轨道/时间轴绘制 |
| `blink` | opacity 1↔.25 | 光标、状态点闪烁 |
| `warnPulse` | scale 1↔1.18 | 警示图标脉冲 |
| `chipOn` | 右移 24px + 边框辉光 | 列表项/步骤条滑入 |
| `streamGlow` | box-shadow 呼吸辉光 | 持续推送的链路 |
| `processing`/`glowClosed`/`glowFinal` | box-shadow 放大再收 | 服务器处理/最终高亮 |
| `travel`/`travel3`/`travelRev`/`travelF`/`travelR` | 圆点沿轴移动 | 数据包流动 |
| `fillBar` | width 0→100% | 进度条填充 |
| `stripes` | 背景斜纹滚动 | 等待中的条纹 |
| `dimLine` | 变暗透明 | 链路熄灭 |
| `drawY`+`chipOn` | 竖直轨道 + 步骤 | 时间轴/流程四步 |
| `spin` | rotate 360° | 循环环上的轨道点 |
| `loopFwd`/`loopRev` | 圆点往返循环 | 双向/单向持续推送 |
| `sepFlash` | 分隔线闪一下 | 事件分隔 |
| `xStamp` | scale 2→1 盖章 | ✗ 限制项 |
| `kLoop`/`gapPulse`/`deltaPulse`/`shellGlow` | 背景/边框呼吸 | 强调循环/间隔 |

完整定义见 `references/template.html` 的 `<style>` 段。

---

## 四、组件目录（按需组合）

每页 = `header` + `h1` + `subtitle`（可选） + 内容组件 + `callout`（可选）。

### 4.1 通用组件（每页顶部/底部）
```html
<div class="header anim d0">
  <div class="tag mono">SSE · LIFECYCLE</div>      <!-- 章节英文小标，橙色 -->
  <div class="indicator mono">05 / 09</div>        <!-- 页码 -->
</div>
<h1 class="anim d1">标题</h1>
<p class="subtitle anim d2">副标题（一句话点题）</p>
```
CSS：`.tag`/`.indicator` 28px，`.tag` 橙 `letter-spacing:2px`，`.indicator` 灰；`h1` 72px 粗体奶油色；`.subtitle` 30px 灰。

### 4.2 警示条 callout（每页收尾结论）
```html
<div class="callout">
  <svg class="warn" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="13" stroke="#D97757" stroke-width="2.5"/>
    <path d="M10 16.5L14 20.5L22 12" stroke="#D97757" stroke-width="2.5"/>
  </svg>
  <p>结论一句话</p>
</div>
```
CSS：`.callout` 深底 `#231712` + 2px 橙边 + 圆角 16，`.warn` 36px 图标。负面警示用三角 `M16 4L29 27H3L16 4Z` + 感叹号。播放时 `fadeUp` 进场 + `.warn` 用 `warnPulse`。

### 4.3 终端窗口 term（展示代码/伪代码/命令）
```html
<div class="term">
  <div class="term-bar">
    <div class="tdot"></div><div class="tdot"></div><div class="tdot"></div>
    <div class="term-file mono">file.ts</div>
  </div>
  <div class="term-body mono">
    <span class="cline t1"><span class="cm">// 注释</span></span>
    <span class="cline t2">res.writeHead(200, {</span>
    <span class="cline t3 hl"><span class="st">"Content-Type"</span>: <span class="st">"text/event-stream"</span>,</span>
    …
  </div>
  <div class="term-out mono">
    <span class="oline o1"><span class="pr">&gt; </span>输出行</span>
  </div>
</div>
```
CSS 要点：`.term` 底 `#211710` + 1.5px 边 + 圆角 16；`.term-bar` 深底 + 三个 12px 圆点；`.cline` 逐行 `opacity:0`、`white-space:pre`；`.cm` 注释灰、`.st` 字符串浅橙 `#E0977B`、`.kw` 关键字橙；`.cline.hl` 高亮行（橙底 + 左竖线）；`.term-out` 模拟输出，`.o1/.o2/.o3` 由浅到深透明度渐变；`.cursor` 橙色块 `blink`。

### 4.4 卡牌 card / pcard / v-card
```html
<div class="card client anim">
  <div class="label mono">CLIENT</div>
  <div class="name">客户端</div>
  <div class="desc">发起 HTTP 请求</div>
</div>
```
- `.card` 340×250、`.card3` 同尺寸：`label` 橙小字、`name` 40px 粗体奶油、`desc` 28px 灰。
- `.pcard` 三列对比卡（封面「三选一」），`.pcard.sse/.here` 加 2px 橙边 + `#2A1B12`，右上角 `.badge` 橙底胶囊。
- `.v-card` / `.bacard` / `.vcard`：对比两栏，`done`（灰边灰字）/ `next`/`sse`（橙边高亮）。

### 4.5 列表 chip（步骤/限制/事件）
```html
<div class="chip sc1"><div class="idx mono">1</div>
  <div><div class="nm mono">名称</div><div class="ds">描述</div></div></div>
```
CSS：`.chip` 卡牌底 + 圆角 12，`.idx` 橙色序号，`.nm` 粗体奶油，`.ds` 灰。进场用 `chipOn`，竖直轨道配 `.rail`/`.rail-fill`（`drawY`）。

### 4.6 箭头 + 数据包（请求/响应流）
```html
<div class="arrow-group g1">
  <div class="arrow-label anim">① 发送请求</div>
  <div class="arrow-track">
    <div class="arrow-line"></div>   <!-- drawX 绘制 -->
    <div class="packet"></div>       <!-- travel 流动 -->
    <div class="arrow-head"></div>   <!-- fadeIn 出现 -->
  </div>
</div>
```
CSS：`.arrow-track` 120px×3px 灰底，`.arrow-line` 橙色 `scaleX(0)` 待 `drawX`，`.arrow-head` CSS 三角，`.packet` 橙色发光圆点 `travel`。方向反向用 `transform-origin:right` + `travelRev`。

### 4.7 时间轴/进度条
```html
<div class="bar server-bar"><div class="bar-fill"></div><span>数据处理中…</span></div>
```
CSS：`.bar` 960×100 圆角，`.bar-fill` `width:0` 待 `fillBar`；`.client-bar .bar-fill` 斜纹背景 + `stripes` 滚动。纵向轨道同 `.rail`/`.rail-fill`。

### 4.8 循环环 loop-ring（循环/闭环概念）
```html
<div class="loop-ring">
  <div class="orbit"><div class="odot"></div></div>   <!-- spin 旋转 -->
  <div class="ring-center mono">AGENT<br>LOOP</div>
  <div class="lnode ln-top ln1"><div class="ln">…</div><div class="ls">…</div></div>
  <!-- 四个 .lnode 定位 top/right/bottom/left -->
</div>
```
CSS：`.loop-ring` 400×400 虚线圆，`.orbit` `spin` 旋转，`.lnode` 绝对定位四角，`.odot` 发光圆点。

### 4.9 流程图 fpipe / fbox（数据流/管道）
```html
<div class="fpipe">
  <div class="fnode">输入</div>
  <div class="fconn">▼</div>
  <div class="fnode key">关键步骤<span class="sub">…</span></div>
  …
</div>
```
CSS：`.fnode` 卡牌底圆角，`.fnode.key` 橙边 `#2A1B12`，`.fconn` 橙色 `▼`，`.sub` 灰小字缩进。可用于「处理管道」逐层展开。

---

## 五、JS 控制器（必须照抄）

```js
const stage = document.getElementById('stage');
const slides = ['slide0','slide1','slide2',…].map(id=>document.getElementById(id));
let cur = 0;

function fit(){
  const s = Math.min(innerWidth/1920, innerHeight/1080);
  stage.style.transform = `scale(${s})`;
}
addEventListener('resize', fit); fit();

function play(i){
  slides.forEach((sl,idx)=>sl.classList.toggle('active', idx===i));
  cur = i;
  restart();
}

function restart(){
  const sl = slides[cur];
  sl.classList.remove('play');
  void sl.offsetWidth;               // ★ 强制回流，重置动画
  sl.classList.add('play');
}

const next = ()=>play((cur+1)%slides.length);
stage.addEventListener('click', next);
addEventListener('keydown', e=>{
  if(e.key==='ArrowRight'||e.key===' '||e.key==='Enter') next();
  if(e.key==='ArrowLeft') play((cur-1+slides.length)%slides.length);
  if(e.key==='r'||e.key==='R') restart();
});

play(0);
```

**注意**：`slides` 数组顺序 = 实际放映顺序，`id` 可乱序（如 m4.1 里 `slide6` 排在第 5 位）；首页必须 `class="slide active"`；`void sl.offsetWidth` 是重播动画的关键，不可省略。

---

## 六、工作流程（从主题到成品）

1. **定内容**：把主题拆成 N 页，每页一个「论点/机制/步骤」，首尾为封面页与总结页。
2. **画分镜**：为每页选一个核心组件（流程图 / 时间轴 / 对比卡 / 终端 / 循环环 / 管道图），配 header + h1 + subtitle + callout。
3. **写结构**：搭 `<section class="slide" id="slideN">` 骨架，填入内容，标注每个待动画元素的类名（`d0/d1/d2`、`t1..tn`、`c1..cn`、`sp1..`、`s1..`）。
4. **排时间轴**：从 `.9s` 开始，逐单元 +0.3~0.5s；代码行逐行 +0.15~0.3s；收尾 callout 放在整页最后一拍（6~9s）。
5. **上动画**：每类元素套对应关键帧（标题 `fadeUp`、列表 `chipOn`、线条 `drawX`、数据包 `travel`、持续推送 `streamGlow`/`loopRev` infinite）。
6. **套控制器**：补 `<script>`，填 `slides` 数组（放映顺序）。
7. **自检**：见下清单。

---

## 七、质量自检清单

- [ ] 舞台固定 1920×1080，`fit()` 等比缩放，body flex 居中
- [ ] CSS 变量色板与字体双轨（Noto Sans SC + JetBrains Mono）齐全
- [ ] 每页 `display:none`，仅 `.active` 显示；首页 `active`
- [ ] 所有待动画元素初始 `opacity:0`，动画由 `.slide.play` 触发且 `forwards`
- [ ] 时间轴延迟连续递进（无重叠错乱），叙事顺序 = 讲解顺序
- [ ] 每页有 header（tag+页码）+ 结论 callout
- [ ] JS 含 `void sl.offsetWidth` 强制回流；`slides` 数组 = 放映顺序
- [ ] 翻页：点击 + 方向键 + R 重播
- [ ] 浏览器打开即自动 `play(0)` 并适配窗口

## 参考资料

- `references/template.html` — 完整可复制骨架（含全套 CSS 变量、关键帧、JS、示范页与组件演示）。
- 原始样本：`D:\workspace\202608\mini-claude-code\docs\m4.1.html`（SSE 流式）、`m5.html`（Agent Loop）、`m6.html`（Bash 工具）。

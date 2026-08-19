# 风格标签库与曲风百科

传给生成模型的风格标签是**能复现听感的关键**。用 2-6 个英文短标签，按「曲风 → 情绪 → 唱腔 → 质感」的顺序组合，例如：

```
dreamy pop, female vocals, lofi          （梦幻流行、女声、低保真质感）
upbeat rock, male vocals, energetic      （明快摇滚、男声、有冲劲）
sad ballad, piano, cinematic             （悲伤抒情、钢琴、电影感）
lo-fi hip hop, chill, rap                （低保真嘻哈、松弛、说唱）
EDM, euphoric, female vocals, festival   （电子舞曲、亢奋、女声、音乐节感）
```

## 曲风（genre）

pop · rock · hip hop · R&B · folk · country · jazz · blues · soul · funk · gospel · punk · metal · indie · ballad · electronic / EDM / house / techno / trance · lo-fi · dream pop · synthwave · ambient · classical · acoustic

## 情绪（mood）

upbeat · dreamy · melancholic · energetic · calm · romantic · nostalgic · epic · dark · playful · bittersweet · euphoric · chill · aggressive · tender

## 唱腔（vocal）

female vocals · male vocals · child vocals · duet · choir · rap · whisper vocals · falsetto · operatic · no vocals（纯音乐，用 instrumental 参数）

## 质感与时代（texture）

lofi · vintage · acoustic · electronic · cinematic · bedroom pop · trap · indie · retro · modern · minimalist · orchestral

## 选择原则

1. **互不矛盾**：不要同时出现风格冲突的标签（如 heavy metal, lullaby）
2. **足够具体**：选到「能想象出听感」为止；拿不准时宁可少而准
3. **服务于主题**：标签组合要能承载歌词的情绪——先定情绪，再配曲风
4. 每个标签 1-2 个词；不用完整句子

## 曲风百科（给新手讲听感）

| 曲风 | 听感（人话） | BPM | 代表音色 | 适配情绪 | 注意 |
|---|---|---|---|---|---|
| pop | 旋律顺耳、段落分明、大众友好 | 90-130 | 人声主导，吉他/钢琴/合成器 | 通用 | 太泛时叠加质感标签 |
| ballad | 慢、深情、情绪铺开 | 60-80 | 钢琴/弦乐 | 悲伤/浪漫/怀旧 | 副歌需要爆发点 |
| rock | 有劲、吉他驱动 | 110-160 | 电吉他/鼓 | 愤怒/自由/热血 | 配 live 类质感去塑料感 |
| indie | 有想法、不套路 | 90-130 | 吉他/合成器混搭 | 疏离/清新 | — |
| folk | 像在讲故事 | 70-100 | 木吉他/口琴 | 思念/温暖/乡愁 | 叙事优先，配 acoustic |
| R&B | 丝滑、转音多 | 60-90 | 电钢/贝斯线条 | 暧昧/温柔/性感 | 唱腔配 soulful |
| hip hop | 律动、有态度 | 80-100 | 鼓机/采样 | 酷/愤怒/自嘲 | 歌词按 flow 断行 |
| jazz | 慵懒、即兴感 | 60-180 | 萨克斯/钢琴/低音提琴 | 优雅/夜晚 | 结构自由，慎配固定段落模板 |
| blues | 苦中带甜、一唱一叹 | 60-120 | 电吉他/口琴 | 忧郁/释然 | — |
| funk | 让人想抖腿 | 100-120 | 贝斯 slap/铜管 | 欢快/自信 | — |
| soul | 有灵魂的深情 | 60-90 | 管风琴/和声组 | 深情/希望 | — |
| EDM / house | 舞池感、四拍踢鼓 | 118-130 | 合成器/踢鼓 | 亢奋/释放 | 见质感原则防塑料感 |
| techno / trance | 循环推进、迷幻 | 120-150 | 合成器音序 | 沉浸/出神 | 结构长，不适合短歌 |
| lo-fi | 像老磁带、暖糊 | 60-90 | 采样鼓/低保真钢琴 | 松弛/怀旧/专注 | 适合 instrumental |
| dream pop | 像隔层雾听歌 | 80-120 | 混响吉他/气声 | 梦幻/飘 | — |
| synthwave | 80 年代霓虹夜 | 90-120 | 复古合成器 | 怀旧/未来感 | 配 retro/vintage |
| ambient | 没有主旋律的氛围 | 自由 | 合成器音垫 | 平静/空灵 | 纯氛围，不适合歌词密集 |
| classical | 交响/室内乐质感 | 自由 | 弦乐/钢琴/木管 | 宏大/优雅 | instrumental 为主 |
| acoustic | 不插电 | 60-120 | 木吉他 | 真诚/亲近 | 常作质感叠加而非主风格 |

**给新手讲风格的人话公式**：「这个风格听起来像____，节奏____，音色主要是____」。
例：「city pop 听起来像 80 年代都市夜景，节奏轻快有律动，贝斯和合成器是主角」——不要说「这是一种 20 世纪 80 年代源于日本的流行音乐流派」。

## 中文语境对照（用户常说的话 → 标签）

| 用户说法 | 对应方向 |
|---|---|
| 「周杰伦/陶喆那种」 | pop + R&B 融合，melodic rap 点缀 |
| 「赵雷/宋冬野那种」 | folk, acoustic, male vocals，叙事歌词 |
| 「抖音神曲那种」 | catchy pop, upbeat，Hook 前置短结构 |
| 「古风/仙侠那种」 | 见国风知识（五声调式 + 传统乐器标签） |
| 「偶像/选秀那种」 | dance pop, energetic，副歌齐唱感 |
| 「告五人/落日飞车那种」 | indie pop, dreamy，乐队质感 |
| 「港风/复古那种」 | retro pop, vintage, synth |
| 「二次元/动漫那种」 | j-pop / anime rock，燃系副歌 |

## 质感原则（控制「不自然的电音」）

**电子本身是正常元素，不回避**。要避免的是「不自然的电音」：廉价合成器预设感、塑料质感、生硬 autotune、过量 EDM 鼓组。

- **电子元素要「自然化」**：用电子时叠加具体质感标签——warm analog synth、vintage synth、retro synth、soft synth pads（温暖/复古/柔和，而不是默认的塑料音色）
- **电子 + 有机融合优先**：synth + live drums、electronic + acoustic guitar、synth + piano——混合编制天然去掉廉价感
- 避免裸露的硬电子组合：raw EDM、big room、hard trap（除非用户明确要舞曲/蹦迪感）
- 若用户只说「流行」，默认理解为乐队编制流行（live band, pop）；用户提到电子/合成器/复古时再用电子元素并自然化

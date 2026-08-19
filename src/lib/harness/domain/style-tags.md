# 风格标签库

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

## 质感原则（控制「不自然的电音」）

**电子本身是正常元素，不回避**。要避免的是「不自然的电音」：廉价合成器预设感、塑料质感、生硬 autotune、过量 EDM 鼓组。

- **电子元素要「自然化」**：用电子时叠加具体质感标签——warm analog synth、vintage synth、retro synth、soft synth pads（温暖/复古/柔和，而不是默认的塑料音色）
- **电子 + 有机融合优先**：synth + live drums、electronic + acoustic guitar、synth + piano——混合编制天然去掉廉价感
- 避免裸露的硬电子组合：raw EDM、big room、hard trap（除非用户明确要舞曲/蹦迪感）
- 若用户只说「流行」，默认理解为乐队编制流行（live band, pop）；用户提到电子/合成器/复古时再用电子元素并自然化

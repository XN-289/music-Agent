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

## 默认质感倾向（重要：控制「电音味」）

真实生成实测反馈：合成器/电子质感过重。**除非用户明确要求电子、舞曲、合成器、游戏感**，默认优先选「有机/原声」质感组合：

- 首选质感：acoustic, live band, piano, acoustic guitar, jazz trio, string quartet, folk band, upright bass
- 克制使用：synth, synthwave, electronic, EDM, trap, 808（用户点名才用，且一次只叠一个电子标签）
- 避免默认叠加：dreamy pop 类自带合成器底色的标签 + 电子质感标签的「双电子」组合
- 若用户只说「流行」，默认理解为「band 编制流行」（live band, pop）而非电子流行

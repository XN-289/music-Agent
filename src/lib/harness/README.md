# Harness 分层说明

本目录是产品内「音乐制作人脑子」的实验场：`prompt.ts` 在运行时读取这里的 Markdown 组装系统提示词。

`D:\music-customization-skill\` 是从本目录蒸馏出的开源社区 skill「音乐定制」（2026-08-19 打包，待建独立 GitHub 仓库发布）。

**同步纪律**：新经验先在产品内验证（真实生成 + 用户试听反馈），验证有效后再蒸馏进 skill 仓库。两边不是双向同步——harness 是源头，skill 是蒸馏产物。修改 harness 时检查改动是否具有普适性（产品特有的工具名/模型参数不进 skill）。

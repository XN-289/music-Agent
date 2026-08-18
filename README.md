# Music Agent

音乐 Agent Web 应用：用户用自然语言描述歌曲 → Agent（pi + DeepSeek/中转站）规划风格、写歌词 → 调用 Suno 第三方 API 生成 → 试听与迭代（Extend / Cover / 替换段落，版本树管理）。

**对标**：[MusicMake.ai](https://musicmake.ai)（架构与迭代套件）+ [海绵音乐](https://www.haimian.com)（玩法层：仿写/音色克隆，P2）。交付市场：国内。

## 技术栈

- **Web**：Next.js 16.3（App Router + Turbopack）+ TypeScript + Tailwind v4 + React 19（手写极简 UI 组件集，`src/components/ui/`）
- **Agent 运行时**：`@earendil-works/pi-agent-core` / `pi-coding-agent`（badlogic 的 pi Agent，MIT，92k★）——领域无关运行时，自定义系统提示词 + 自定义工具，无编码工具集
- **LLM**：直连 DeepSeek 或任意 OpenAI 兼容中转站（env 切换，见下）
- **音乐生成**：SunoProvider 兼容层（`src/lib/providers/`）——Mock（本地合成，离线可演示）与 sunoapi.org 第三方 API（Suno V4.5/V5）可切换
- **数据**：SQLite（better-sqlite3 + Drizzle），表：chats / messages / songs（parentId 版本树）/ generation_jobs

## 快速开始

```bash
pnpm install
pnpm db:push        # 初始化 SQLite 表（data/music-agent.db）
cp .env.example .env.local   # 然后填下面的 key
pnpm dev            # http://localhost:3000
```

### .env.local 配置

```bash
# LLM 二选一：
DEEPSEEK_API_KEY=sk-xxx                    # 直连 DeepSeek（默认 deepseek-v4-flash）
# 或中转站（OpenAI 兼容格式，设置后优先）：
LLM_BASE_URL=https://你的中转站/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=模型id

# 音乐生成：
SUNO_PROVIDER=mock       # mock=本地合成演示 | sunoapi=真实生成
SUNO_API_KEY=xxx         # sunoapi.org 注册购买（$5/1k credits）
```

⚠️ 修改 env 后必须重启 `pnpm dev`（Next 只在启动时读取环境变量）。

## 架构

```
浏览器（聊天页 / 歌曲详情 / 曲库 / 常驻播放栏）
   │  SSE（text_delta 增量 + 工具事件）          │ 轮询 /api/jobs/[id]
   ▼                                            ▼
/api/chat ──→ pi AgentSession（pi-agent-core）   /api/jobs/[id] ──→ SunoProvider.getJob
   │  prompt()/subscribe() 事件广播（hub）        │（完成时把结果落库：variants/LRC）
   │  自定工具：generate_music / extend_music / cover_music / replace_section
   ▼
SunoProvider 兼容层 ── Mock（本地合成 WAV）| SunoApi（sunoapi.org）
   │  generate → jobId（异步：提交→轮询 record-info）
   ▼
SQLite：songs（parentId 版本树）+ generation_jobs
```

关键设计：
- **异步 job 模型**：所有 Suno 后端都是提交→轮询，LLM 工具立即返回 jobId，前端轮询推进 UI（不阻塞 Agent 循环）
- **版本树**：每次 Extend/Cover/替换段落创建子歌曲（parentId 指向原歌），详情页展示父子版本链
- **播放器**：全局单例 `HTMLAudioElement` + zustand store，详情页 wavesurfer 通过 `media` 选项共享同一元素，天然同步
- **LLM 中转站**：`LLM_BASE_URL` 存在时运行时生成 `data/pi-agent/models.json` 注册 `relay` provider（api: openai-completions）
- **会话持久化**：消息写穿透落库（chatId 维度），页面刷新自动恢复历史，可开新对话
- **可靠性**：SSE 15s 心跳 + 客户端空闲看门狗 + 断线安全自动重试；提示词串行化防并发串流；mock 任务状态落盘跨重启恢复；滑动窗口限流（按 IP）

## API 一览

| 端点 | 说明 |
|---|---|
| `POST /api/chat` | Agent SSE 对话（delta_chunk/delta/tool_start/tool_end/done/error，心跳注释帧） |
| `GET /api/chats/[id]/messages` | 会话历史（多轮恢复） |
| `GET /api/jobs/[id]` | 任务轮询（完成时幂等落库，返回 { job, song }） |
| `GET /api/credits` | 额度信息（sunoapi 真实余额 / mock 今日生成数） |
| `POST /api/dev/generate` | 跳过 LLM 的直连生成（演示/测试通道） |
| `POST /api/songs/[id]/extend` | 延长歌曲（direction/prompt/contextSeconds） |
| `POST /api/songs/[id]/cover` | 翻唱/重混（prompt/title） |

调试工具：`node scripts/debug-pi-model.mjs` 可绕过 Next 单独验证 LLM 流（key 配好后先跑它）。

## 验证状态（2026-08-18）

| 项 | 状态 |
|---|---|
| Mock 全链路：生成→Extend→Cover→版本树 | ✅ 实测通过 |
| LRC 时间戳歌词 / 2 变体 / UTF-8 | ✅ 实测通过 |
| 会话持久化（历史恢复）/ 限流 429 / credits 接口 | ✅ 实测通过 |
| mock 任务跨重启持久化 + 僵尸任务清扫 | ✅ 实测通过 |
| 三路代码评审（对照 pi/sunoapi/wavesurfer 源码）缺陷修复 | ✅ 4 严重 + 11 主要已修 |
| 页面渲染（首页/详情/曲库/播放栏） | ✅ HTTP 层验证；浏览器交互走查待做 |
| 真实 LLM 对话（pi Agent） | ⏳ 等 key（旧 DeepSeek key 已失效） |
| 真实 Suno 生成/迭代 | ⏳ 等 SUNO_API_KEY |

## 已知限制与坑

- **单实例部署**：pi 会话/限流桶/事件 hub 在进程内存；多实例前置清单见下节
- **单用户**：无账号体系，限流按 IP，credits 未按用户记账
- Mock 任务持久化为「恢复语义」：重启时进行中的任务标记为中断失败（真实后端任务状态以远端为准，不受影响）
- pi 系列包必须在 `next.config.ts` 的 `serverExternalPackages`（Turbopack 打包其动态 require 会崩）
- pnpm 11 构建白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`
- drizzle better-sqlite3 是同步驱动且查询惰性：事务回调里必须 `.run()`，否则空提交
- Turbopack 偶发 worker 崩溃，重启 `pnpm dev` 即可

## 部署与多实例

**现状（P0-P2）**：单实例部署。组件按可迁移设计，但存在内存态：
- pi Agent 会话、提示词串行队列、限流桶、mock 任务状态（已落盘 data/mock-jobs.json，但恢复语义是「中断即失败」）
- SQLite 单文件（WAL + busy_timeout 已配置，多进程只读可，写入方必须唯一）

**多实例化前置条件清单**（按顺序）：
1. **共享数据库**：SQLite → Postgres（Drizzle 迁移成本低，`DB_PATH` → `DATABASE_URL`）；songs/messages/generation_jobs 天然支持共享
2. **Agent 会话外置**：pi 会话按 conversationId 存到 Postgres/S3（当前单例 session 必须改为会话池）
3. **任务状态入库**：generation_jobs 已有行，但轮询驱动要从「客户端 poll 服务端 provider」演进为「后台 worker 轮询 + 回调」，避免多实例重复轮询/扣费
4. **限流与事件总线外置**：rate-limit 内存桶 → Redis；pi 事件 hub → Redis pub/sub（否则同会话请求落到不同实例时消息会散）
5. **文件存储**：public/generated → 对象存储（真实后端音频 URL 本就在远端，只有 mock 本地合成涉及）
6. **认证**：多用户需要账号体系，credit 按用户记账（当前按 IP 限流、无用户概念）

**国内上线合规前置（P2 玩法层之前评审）**：生成式 AI 服务备案与深度合成标识、仿写热歌/音色克隆的版权与声音权益、域名 ICP 备案。

## 路线

- **P0**（✅ 完成）：底座——Next.js + pi Agent 运行时 + Provider 兼容层（Mock）+ 聊天/详情/曲库/播放器 + 版本树雏形
- **P1**（✅ 代码完成，待真实 key 验证）：sunoapi 适配器 + Agent 迭代工具（Extend/Cover/替换段落）+ 详情页迭代 UI + 版本树
- **P1.5 评审修复**（✅ 完成）：三路代码评审 4 严重 + 11 主要缺陷全部修复
- **P2 工程项**（✅ 完成）：会话持久化、SSE 心跳重连、credits/限流、mock 跨重启持久化、多实例部署方案（文档+架构预留）
- **P2 产品项**（下一步）：Agent 深度（自动选工具、@曲库上下文、自动修复失败、参考音频）+ 玩法层（仿写热歌/音色克隆，对齐海绵音乐）+ 国内合规评审（生成式 AI 备案/标识、版权与声音权益）
- **P3**：社区 feed / 分享 / credits 订阅闭环、多实例化

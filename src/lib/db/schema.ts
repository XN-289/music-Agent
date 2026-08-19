import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// P0 用 SQLite 起步（务实 MVP，零部署依赖）；Drizzle 迁移到 Postgres 只需换驱动 + 微调列类型。

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id')
    .notNull()
    .references(() => chats.id),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  /** UIMessage parts 的 JSON 序列化，用于会话恢复 */
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const songs = sqliteTable(
  'songs',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id').references(() => chats.id),
    /** 版本树：extend/cover/remix 生成的歌曲指向来源歌曲（P2 迭代闭环的数据基础） */
    parentId: text('parent_id'),
    title: text('title').notNull(),
    /** 带 [Verse]/[Chorus] 结构标记的歌词原文 */
    lyrics: text('lyrics'),
    /** 逐行时间戳歌词（JSON: LyricsLine[]），由任务完成时按实际时长生成 */
    lyricsLrc: text('lyrics_lrc'),
    styleTags: text('style_tags', { mode: 'json' }).$type<string[]>(),
    prompt: text('prompt'),
    instrumental: integer('instrumental', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['draft', 'processing', 'done', 'failed'] })
      .notNull()
      .default('draft'),
    progress: integer('progress').notNull().default(0),
    stage: text('stage'),
    /** 生成的变体（Suno 惯例一次出 2 个，天然 A/B 对比） */
    variants: text('variants', { mode: 'json' }).$type<SongVariantMeta[]>(),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_songs_parent_id').on(table.parentId), // 版本树查询
    index('idx_songs_status').on(table.status), // 清扫/曲库筛选
  ],
);

export interface SongVariantMeta {
  id: string;
  audioUrl: string;
  title: string;
  durationSec: number;
  /** Provider 原生音频 id（extend/cover 等迭代操作的输入） */
  audioId?: string;
}

export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    songId: text('song_id')
      .notNull()
      .references(() => songs.id),
    providerId: text('provider_id').notNull(),
    status: text('status', { enum: ['pending', 'processing', 'success', 'failed'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_jobs_song_id').on(table.songId)],
);

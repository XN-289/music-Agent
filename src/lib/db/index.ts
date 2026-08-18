import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

// 仅服务端使用（Next.js serverExternalPackages 需包含 better-sqlite3）
const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'music-agent.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000'); // 多连接/未来多进程写入冲突时等待，而非直接 SQLITE_BUSY

export const db = drizzle(sqlite, { schema });
export { schema };

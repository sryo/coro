import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { CORO_HOME, DB_FILE } from './config';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (db) return db;
    fs.mkdirSync(CORO_HOME, { recursive: true });
    db = new Database(DB_FILE);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return db;
}

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}

function runMigrations(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
    `);
    const applied = new Set(
        db.prepare('SELECT version FROM _migrations').all().map((r: any) => r.version)
    );
    const tx = db.transaction((version: number, sql: string) => {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)')
            .run(version, Date.now());
    });
    for (const m of MIGRATIONS) {
        if (!applied.has(m.version)) tx(m.version, m.sql);
    }
}

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
    {
        version: 1,
        sql: `
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repo_path TEXT NOT NULL UNIQUE,
                base_branch TEXT NOT NULL DEFAULT 'main',
                default_model TEXT,
                project_brief TEXT,
                settings_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE stages (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                position INTEGER NOT NULL,
                kind TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(project_id, name),
                UNIQUE(project_id, position)
            );

            CREATE TABLE cards (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                slug TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                stage_id TEXT NOT NULL REFERENCES stages(id),
                branch_name TEXT,
                worktree_path TEXT,
                base_sha TEXT,
                model_override TEXT,
                position INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                started_at INTEGER,
                testing_at INTEGER,
                review_at INTEGER,
                done_at INTEGER,
                merged_at INTEGER,
                abandoned_at INTEGER
            );
            CREATE INDEX cards_project_stage ON cards(project_id, stage_id);
        `,
    },
    {
        version: 2,
        sql: `
            CREATE TABLE worktrees (
                id TEXT PRIMARY KEY,
                card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
                path TEXT NOT NULL,
                branch TEXT NOT NULL,
                base_branch TEXT NOT NULL,
                base_sha TEXT NOT NULL,
                repo_path TEXT NOT NULL,
                state TEXT NOT NULL,
                last_seen_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
                project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                actor TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX events_card ON events(card_id, id);
            CREATE INDEX events_project ON events(project_id, id);
        `,
    },
    {
        version: 3,
        sql: `
            CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
                system_prompt_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                message_id TEXT NOT NULL UNIQUE,
                turn_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content_text TEXT,
                content_json TEXT,
                tool_name TEXT,
                streaming_complete INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX messages_conv ON messages(conversation_id, id);
        `,
    },
    {
        version: 4,
        sql: `
            ALTER TABLE worktrees ADD COLUMN dirty_files INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE worktrees ADD COLUMN behind INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE worktrees ADD COLUMN merge_conflict_at INTEGER;
        `,
    },
    {
        version: 5,
        sql: `
            CREATE TABLE turns (
                id TEXT PRIMARY KEY,
                card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                status TEXT NOT NULL DEFAULT 'running'
            );
            CREATE INDEX turns_card ON turns(card_id);
            CREATE INDEX turns_status ON turns(status);
        `,
    },
    {
        version: 6,
        sql: `
            ALTER TABLE worktrees ADD COLUMN additions INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE worktrees ADD COLUMN deletions INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE worktrees ADD COLUMN changed_files INTEGER NOT NULL DEFAULT 0;
        `,
    },
];

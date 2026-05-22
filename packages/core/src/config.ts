import path from 'path';
import os from 'os';
import type { StageKind } from '@concerto/types';

export type { StageKind } from '@concerto/types';

export const CONCERTO_HOME = process.env.CONCERTO_HOME
    || path.join(os.homedir(), '.concerto');

export const DB_FILE = path.join(CONCERTO_HOME, 'state.db');
export const DAEMON_INFO_FILE = path.join(CONCERTO_HOME, 'daemon.json');
export const LOG_FILE = path.join(CONCERTO_HOME, 'daemon.log');

export const DEFAULT_API_PORT = 7419;
export const DEFAULT_DASHBOARD_PORT = 7420;

export const DEFAULT_STAGES: ReadonlyArray<{ name: string; kind: StageKind }> = [
    { name: 'Backlog', kind: 'backlog' },
    { name: 'Ready', kind: 'ready' },
    { name: 'In Progress', kind: 'active' },
    { name: 'Testing', kind: 'active' },
    { name: 'Review', kind: 'review' },
    { name: 'Done', kind: 'done' },
    { name: 'Merged', kind: 'archive' },
];

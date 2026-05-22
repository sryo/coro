'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/utils';

interface Props {
    ms: number | null | undefined;
    refreshMs?: number;
}

// Client-only relative-time formatter. Renders empty on SSR, fills in after mount, and
// optionally ticks so the label stays fresh. Avoids the hydration mismatch you get if
// the server renders "0s ago" and the client mounts a second later as "1s ago".
export function TimeAgo({ ms, refreshMs = 30_000 }: Props) {
    const [text, setText] = useState<string>('');

    useEffect(() => {
        if (!ms) {
            setText('');
            return;
        }
        const update = () => setText(timeAgo(ms));
        update();
        const id = window.setInterval(update, refreshMs);
        return () => window.clearInterval(id);
    }, [ms, refreshMs]);

    return <span suppressHydrationWarning>{text}</span>;
}

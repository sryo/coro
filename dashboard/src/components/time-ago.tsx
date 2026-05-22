'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/utils';

interface Props {
    ms: number | null | undefined;
    refreshMs?: number;
}

// Client-only relative-time formatter. Renders empty on SSR, fills in after mount, and
// ticks on an interval so the label stays fresh. Setting state inside the effect is
// the right call here even though react-hooks/set-state-in-effect flags it — the
// component must render empty on the server to avoid hydration drift, then populate
// once we're past hydration.
export function TimeAgo({ ms, refreshMs = 30_000 }: Props) {
    const [text, setText] = useState<string>('');

    useEffect(() => {
        if (!ms) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
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

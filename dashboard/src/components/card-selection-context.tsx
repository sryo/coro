'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface SelectionAPI {
    selectedIds: Set<string>;
    count: number;
    has: (id: string) => boolean;
    toggle: (id: string) => void;
    select: (id: string) => void;
    clear: () => void;
}

const SelectionContext = createContext<SelectionAPI | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
    const [selectedIds, setSelected] = useState<Set<string>>(() => new Set());

    const toggle = useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const select = useCallback((id: string) => {
        setSelected((prev) => (prev.has(id) && prev.size === 1 ? prev : new Set([id])));
    }, []);

    const clear = useCallback(() => {
        setSelected((prev) => (prev.size === 0 ? prev : new Set()));
    }, []);

    const has = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

    const value = useMemo<SelectionAPI>(
        () => ({ selectedIds, count: selectedIds.size, has, toggle, select, clear }),
        [selectedIds, has, toggle, select, clear],
    );

    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionAPI | null {
    return useContext(SelectionContext);
}

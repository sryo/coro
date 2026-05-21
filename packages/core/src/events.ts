type EventListener = (type: string, data: Record<string, unknown>) => void;

const listeners: EventListener[] = [];

export function onEvent(listener: EventListener): () => void {
    listeners.push(listener);
    return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
    };
}

export function emitEvent(type: string, data: Record<string, unknown>): void {
    for (const listener of listeners) {
        try {
            listener(type, data);
        } catch {
            // never let a misbehaving listener crash the emitter
        }
    }
}

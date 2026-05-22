import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Coro',
    description: 'A kanban board for Claude Code conversations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}

import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'subtle';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
}

const base = 'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none';
const variants: Record<Variant, string> = {
    primary: 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90',
    ghost: 'hover:bg-[var(--muted)]',
    subtle: 'bg-[var(--muted)] hover:bg-[var(--border)]',
};
const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'primary', size = 'md', className, ...props }, ref) => (
        <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props} />
    ),
);
Button.displayName = 'Button';

export function slugify(input: string, maxLen = 40): string {
    const slug = input
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug.slice(0, maxLen).replace(/-+$/, '') || 'card';
}

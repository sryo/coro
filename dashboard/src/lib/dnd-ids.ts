const STAGE_SORT_PREFIX = 'stage-sort:';
const STAGE_DROP_PREFIX = 'stage:';

export const stageSortId = (id: string) => `${STAGE_SORT_PREFIX}${id}`;
export const stageDropId = (id: string) => `${STAGE_DROP_PREFIX}${id}`;

export const isStageSortId = (id: string) => id.startsWith(STAGE_SORT_PREFIX);

export const parseStageSortId = (id: string): string | null =>
    id.startsWith(STAGE_SORT_PREFIX) ? id.slice(STAGE_SORT_PREFIX.length) : null;

export const parseStageDropId = (id: string): string | null => {
    if (id.startsWith(STAGE_SORT_PREFIX)) return null;
    return id.startsWith(STAGE_DROP_PREFIX) ? id.slice(STAGE_DROP_PREFIX.length) : null;
};

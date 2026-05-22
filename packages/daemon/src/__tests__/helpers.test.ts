import { describe, it, expect } from 'vitest';
import { errorStatus } from '../routes/_helpers';

describe('errorStatus mapping', () => {
    it('maps known lookup-miss codes to 404', () => {
        expect(errorStatus('card_not_found')).toBe(404);
        expect(errorStatus('stage_not_found')).toBe(404);
        expect(errorStatus('project_not_found')).toBe(404);
        expect(errorStatus('unbound')).toBe(404);
    });

    it('maps bad_request to 400', () => {
        expect(errorStatus('bad_request')).toBe(400);
        expect(errorStatus('invalid_stages')).toBe(400);
    });

    it('defaults state-machine rejections to 409', () => {
        expect(errorStatus('conflict')).toBe(409);
        expect(errorStatus('archive_immutable')).toBe(409);
        expect(errorStatus('merge_requires_done')).toBe(409);
        expect(errorStatus('done_requires_review_user')).toBe(409);
        expect(errorStatus('totally_made_up_code')).toBe(409);
    });
});

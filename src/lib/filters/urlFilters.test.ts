import { describe, it, expect } from 'vitest';
import { parseFilters, buildFilterUrl } from './urlFilters';

describe('parseFilters', () => {
	it('reads from/to/dept params, defaulting missing ones to null', () => {
		const params = new URLSearchParams('from=2026-08-01&to=2026-08-07&dept=eng-id');
		expect(parseFilters(params)).toEqual({ from: '2026-08-01', to: '2026-08-07', departmentId: 'eng-id' });
	});

	it('defaults everything to null when no params present', () => {
		expect(parseFilters(new URLSearchParams())).toEqual({ from: null, to: null, departmentId: null });
	});
});

describe('buildFilterUrl', () => {
	it('serializes non-null filters as query params', () => {
		const url = buildFilterUrl('/report', { from: '2026-08-01', to: null, departmentId: 'eng-id' });
		expect(url).toBe('/report?from=2026-08-01&dept=eng-id');
	});

	it('returns the bare path when all filters are null', () => {
		expect(buildFilterUrl('/report', { from: null, to: null, departmentId: null })).toBe('/report');
	});
});

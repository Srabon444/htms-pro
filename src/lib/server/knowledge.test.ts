import { describe, expect, it } from 'vitest';
import { excerpt } from './knowledge';

describe('article excerpt', () => {
	it('drops markdown marks and link targets, keeps the words, and caps the length', () => {
		expect(excerpt('# Welcome\n\nRead the **handbook** and [the guide](https://x.test/a).\n- one\n- two')).toBe(
			'Welcome Read the handbook and the guide. - one - two'
		);
		expect(excerpt('word '.repeat(100))).toHaveLength(180);
		expect(excerpt('> quoted <b>x</b>')).toBe('quoted <b>x</b>');
	});
});

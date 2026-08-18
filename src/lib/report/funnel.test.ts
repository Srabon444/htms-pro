import { describe, it, expect } from 'vitest';
import { computeFunnel, type PipelineStage, type Candidate } from './funnel';

describe('computeFunnel', () => {
	it('counts candidates per stage, ordered by sort_order', () => {
		const stages: PipelineStage[] = [
			{ id: 's2', name: 'Screening call', sort_order: 1 },
			{ id: 's1', name: 'Application review', sort_order: 0 }
		];
		const candidates: Candidate[] = [
			{ id: 'c1', current_stage_id: 's1' },
			{ id: 'c2', current_stage_id: 's1' },
			{ id: 'c3', current_stage_id: 's2' }
		];

		expect(computeFunnel(stages, candidates)).toEqual([
			{ stageId: 's1', stageName: 'Application review', count: 2 },
			{ stageId: 's2', stageName: 'Screening call', count: 1 }
		]);
	});

	it('shows zero for a stage with no candidates', () => {
		const stages: PipelineStage[] = [{ id: 's1', name: 'Application review', sort_order: 0 }];
		expect(computeFunnel(stages, [])).toEqual([{ stageId: 's1', stageName: 'Application review', count: 0 }]);
	});
});

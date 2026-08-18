export type PipelineStage = { id: string; name: string; sort_order: number };
export type Candidate = { id: string; current_stage_id: string | null };
export type FunnelStage = { stageId: string; stageName: string; count: number };

export function computeFunnel(stages: PipelineStage[], candidates: Candidate[]): FunnelStage[] {
	const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);

	return sorted.map((stage) => ({
		stageId: stage.id,
		stageName: stage.name,
		count: candidates.filter((c) => c.current_stage_id === stage.id).length
	}));
}

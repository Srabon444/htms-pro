export type ReportFilters = {
	from: string | null;
	to: string | null;
	departmentId: string | null;
};

export function parseFilters(searchParams: URLSearchParams): ReportFilters {
	return {
		from: searchParams.get('from'),
		to: searchParams.get('to'),
		departmentId: searchParams.get('dept')
	};
}

export function buildFilterUrl(pathname: string, filters: ReportFilters): string {
	const params = new URLSearchParams();
	if (filters.from) params.set('from', filters.from);
	if (filters.to) params.set('to', filters.to);
	if (filters.departmentId) params.set('dept', filters.departmentId);

	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
}

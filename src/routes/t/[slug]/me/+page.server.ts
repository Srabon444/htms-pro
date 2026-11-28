import { myActivity, myDetails, myRequests, tabOf } from '#lib/server/me.ts';
import { myPayslips } from '#lib/server/payroll.ts';
import { requireMember, userCtx } from '#lib/server/rbac/access.ts';
import { withTenant } from '#lib/server/tenancy/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const m = requireMember(locals);
	const tab = tabOf(url.searchParams.get('tab'));
	const payslips = tab === 'payslips' ? await myPayslips(m) : [];
	return withTenant(userCtx(m), async (tx) => ({
		tab,
		payslips,
		details: tab === 'details' ? await myDetails(tx, m) : null,
		requests: tab === 'requests' ? await myRequests(tx, m) : [],
		activity: tab === 'activity' ? await myActivity(tx, m, url.searchParams.get('before')) : { entries: [], next: null }
	}));
};

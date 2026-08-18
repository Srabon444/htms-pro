import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();
		const email = String(form.get('email'));

		await locals.supabase.auth.resetPasswordForEmail(email, {
			redirectTo: `${url.origin}/reset-password`
		});

		// Always report success, even if the email doesn't exist — don't leak which
		// emails are registered.
		return { sent: true };
	}
};

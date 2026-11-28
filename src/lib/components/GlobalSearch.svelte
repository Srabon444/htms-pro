<script lang="ts">
	import { afterNavigate } from '$app/navigation';

	type Page = { href: string; label: string; group: string };
	type Hit = { kind: string; id: string; title: string; sub: string | null; href: string };
	type Option = { key: string; group: string; label: string; sub: string | null; href: string; page: boolean };

	let { root, userId, pages }: { root: string; userId: string; pages: Page[] } = $props();

	const KIND_GROUP: Record<string, string> = {
		employee: 'People',
		document: 'Documents',
		letter: 'Letters',
		policy: 'Policies',
		article: 'Knowledge base',
		announcement: 'Announcements',
		event: 'Events',
		ticket: 'Tickets',
		expense: 'Expenses',
		asset: 'Assets',
		project: 'Projects',
		opening: 'Openings',
		candidate: 'Candidates',
		payroll: 'Payroll',
		course: 'Courses'
	};
	const recentKey = $derived(`hrms.recent.${userId}`);
	const SLASH_KEY = 'hrms.search.slash';

	let dialog: HTMLDialogElement;
	let listbox = $state<HTMLElement>();
	let q = $state('');
	let active = $state(0);
	let hits = $state<Hit[]>([]);
	let status = $state<'idle' | 'loading' | 'error' | 'busy'>('idle');
	let slash = $state(true);
	let recent = $state<string[]>([]);

	const read = (key: string) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const write = (key: string, value: string | null) => {
		try {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {
			return;
		}
	};

	const storedRecent = (): string[] => {
		try {
			const value: unknown = JSON.parse(read(recentKey) ?? '[]');
			return Array.isArray(value) ? value.filter((h): h is string => typeof h === 'string') : [];
		} catch {
			return [];
		}
	};

	const score = (label: string, term: string) => {
		const l = label.toLowerCase();
		if (l.startsWith(term)) return 0;
		if (l.split(/[\s/-]+/).some((w) => w.startsWith(term))) return 1;
		return l.includes(term) ? 2 : -1;
	};

	const options = $derived.by<Option[]>(() => {
		const term = q.trim().toLowerCase();
		const asOption = (p: Page, group: string): Option => ({
			key: `page:${p.href}`,
			group,
			label: p.label,
			sub: p.group,
			href: p.href,
			page: true
		});
		if (!term)
			return recent.flatMap((href) => {
				const p = pages.find((x) => x.href === href);
				return p ? [asOption(p, 'Recent')] : [];
			});
		const menu = pages
			.map((p) => ({ p, s: score(p.label, term) }))
			.filter((x) => x.s >= 0)
			.sort((a, b) => a.s - b.s)
			.slice(0, 8)
			.map((x) => asOption(x.p, 'Pages'));
		const records = hits.map<Option>((h) => ({
			key: `${h.kind}:${h.id}`,
			group: KIND_GROUP[h.kind] ?? h.kind,
			label: h.title,
			sub: h.sub,
			href: `${root}/${h.href}`,
			page: false
		}));
		return [...menu, ...records];
	});

	const groups = $derived(
		options.reduce<{ name: string; items: { o: Option; i: number }[] }[]>((acc, o, i) => {
			const last = acc.at(-1);
			if (last?.name === o.group) last.items.push({ o, i });
			else acc.push({ name: o.group, items: [{ o, i }] });
			return acc;
		}, [])
	);

	let seq = 0;
	let controller: AbortController | undefined;
	$effect(() => {
		const term = q.trim();
		controller?.abort();
		active = 0;
		hits = [];
		if (term.length < 2) {
			status = 'idle';
			return;
		}
		status = 'loading';
		const mine = ++seq;
		const timer = setTimeout(async () => {
			controller = new AbortController();
			try {
				const res = await fetch(`${root}/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
				if (mine !== seq) return;
				if (res.status === 429) {
					status = 'busy';
					return;
				}
				if (!res.ok) throw new Error(String(res.status));
				const body: { hits: Hit[] } = await res.json();
				if (mine !== seq) return;
				hits = body.hits;
				status = 'idle';
			} catch (err) {
				if (mine === seq && (err as Error).name !== 'AbortError') status = 'error';
			}
		}, 200);
		return () => clearTimeout(timer);
	});

	export function show() {
		recent = storedRecent().filter((h) => pages.some((p) => p.href === h));
		slash = read(SLASH_KEY) !== 'off';
		q = '';
		active = 0;
		if (!dialog.open) dialog.showModal();
	}

	afterNavigate(() => dialog?.close());

	const remember = (o: Option) => {
		if (!o.page) return;
		write(recentKey, JSON.stringify([o.href, ...recent.filter((h) => h !== o.href)].slice(0, 5)));
	};

	const choose = (i: number) => listbox?.querySelector<HTMLAnchorElement>(`#search-opt-${i}`)?.click();

	const onInputKey = (e: KeyboardEvent) => {
		if (!options.length) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + options.length) % options.length;
			listbox?.querySelector(`#search-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(active);
		}
	};

	const typing = (el: EventTarget | null) =>
		el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

	const onWindowKey = (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			show();
		} else if (
			e.key === '/' &&
			read(SLASH_KEY) !== 'off' &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey &&
			!typing(e.target)
		) {
			e.preventDefault();
			show();
		}
	};

	const toggleSlash = () => {
		slash = !slash;
		write(SLASH_KEY, slash ? null : 'off');
	};

	export function forget() {
		write(recentKey, null);
	}
</script>

<svelte:window onkeydown={onWindowKey} />

<button
	type="button"
	class="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
	aria-haspopup="dialog"
	onclick={show}
>
	Search
	<kbd class="hidden rounded border border-slate-300 px-1 text-xs text-slate-500 sm:inline">Ctrl K</kbd>
</button>

<dialog
	bind:this={dialog}
	aria-label="Quick find"
	class="mx-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<div class="border-b border-slate-200 p-3">
		<input
			bind:value={q}
			type="search"
			role="combobox"
			aria-label="Find pages and records"
			aria-expanded={options.length > 0}
			aria-controls="search-results"
			aria-autocomplete="list"
			aria-activedescendant={options.length ? `search-opt-${active}` : undefined}
			placeholder="Search pages, people, documents…"
			maxlength="80"
			autocomplete="off"
			class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
			onkeydown={onInputKey}
		/>
	</div>
	<div
		bind:this={listbox}
		id="search-results"
		role="listbox"
		aria-label="Results"
		class="max-h-[60vh] overflow-y-auto p-2"
	>
		{#each groups as g (g.name)}
			<div role="group" aria-label={g.name}>
				<p class="px-3 pt-2 pb-1 text-xs font-medium text-slate-500" aria-hidden="true">{g.name}</p>
				{#each g.items as { o, i } (o.key)}
					<a
						id="search-opt-{i}"
						role="option"
						aria-selected={i === active}
						href={o.href}
						tabindex="-1"
						class={[
							'block rounded-lg px-3 py-2 text-sm no-underline',
							i === active ? 'bg-brand-50 text-brand-900' : 'text-slate-800'
						]}
						onmousemove={() => (active = i)}
						onclick={() => remember(o)}
					>
						<span class="block truncate font-medium">{o.label}</span>
						{#if o.sub}<span class="block truncate text-xs text-slate-500">{o.sub}</span>{/if}
					</a>
				{/each}
			</div>
		{/each}
		<p class="px-3 py-2 text-sm text-slate-500" aria-live="polite">
			{#if status === 'loading'}
				Searching…
			{:else if status === 'error'}
				Search failed. Try again.
			{:else if status === 'busy'}
				Too many searches. Wait a moment.
			{:else if q.trim() && !options.length}
				No matches.
			{:else if !q.trim() && !options.length}
				Type to search pages and records.
			{/if}
		</p>
	</div>
	<div class="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
		<span class="hidden sm:inline">↑↓ to move · Enter to open · Esc to close</span>
		<label class="flex items-center gap-2">
			<input type="checkbox" checked={slash} onchange={toggleSlash} />
			Open with /
		</label>
	</div>
</dialog>

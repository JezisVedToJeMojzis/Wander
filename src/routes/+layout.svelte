<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children, data } = $props();

	const navItems = [
		{ href: '/trips', label: 'Trips', icon: '🧳' },
		{ href: '/profile', label: 'You', icon: '🙂' }
	];

	const showNav = $derived(!!data.user);
	const path = $derived(page.url.pathname);
</script>

<div class="mx-auto flex min-h-screen w-full max-w-md flex-col">
	<main class="safe-top flex-1 px-4 {showNav ? 'pb-24' : 'pb-6'}">
		{@render children()}
	</main>

	{#if showNav}
		<nav
			class="safe-bottom fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md justify-around border-t border-slate-800 bg-slate-900/95 backdrop-blur"
		>
			{#each navItems as item (item.href)}
				{@const active = path === item.href || path.startsWith(item.href + '/')}
				<a
					href={item.href}
					class="flex flex-1 flex-col items-center gap-0.5 py-3 text-xs {active
						? 'text-sky-400'
						: 'text-slate-400'}"
				>
					<span class="text-xl">{item.icon}</span>
					{item.label}
				</a>
			{/each}
		</nav>
	{/if}
</div>

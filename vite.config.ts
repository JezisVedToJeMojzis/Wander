import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Wander — plan trips together',
				short_name: 'Wander',
				description: 'Create a trip, invite friends, vote on activities, and build the itinerary together.',
				theme_color: '#0f172a',
				background_color: '#0f172a',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
				icons: [
					{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
					{ src: '/icons/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
				]
			},
			workbox: {
				// Don't try to precache the dynamic, auth-gated pages.
				navigateFallback: null,
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}']
			},
			devOptions: {
				enabled: false
			}
		})
	]
});

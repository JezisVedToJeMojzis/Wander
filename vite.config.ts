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
			// Serve the manifest + service worker on the dev server too, so the app is
			// installable (standalone) when testing locally, not just in prod.
			devOptions: {
				enabled: true,
				type: 'module',
				suppressWarnings: true
			},
			manifest: {
				id: '/',
				name: 'Wander — plan trips together',
				short_name: 'Wander',
				description: 'Create a trip, invite friends, vote on activities, and build the itinerary together.',
				theme_color: '#0f172a',
				background_color: '#0f172a',
				display: 'standalone',
				display_override: ['standalone'],
				orientation: 'portrait',
				start_url: '/',
				scope: '/',
				icons: [
					// PNGs at 192/512 are what Chrome needs to treat the app as installable
					// (and launch it standalone, without the browser address bar).
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}']
			}
		})
	]
});

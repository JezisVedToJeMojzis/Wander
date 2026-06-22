<script lang="ts">
	let { data } = $props();
</script>

<h1 class="mb-5 text-2xl font-bold">You</h1>

<div class="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
	<p class="text-lg font-semibold">{data.user?.name}</p>
	<p class="text-sm text-slate-400">{data.user?.email}</p>
</div>

<form method="POST" action="/logout">
	<button
		type="submit"
		class="w-full rounded-xl border border-red-900 bg-red-950/50 py-3 font-semibold text-red-300 active:bg-red-950"
	>
		Log out
	</button>
</form>

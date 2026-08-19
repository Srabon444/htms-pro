<script lang="ts">
	import { toPng } from 'html-to-image';
	import jsPDF from 'jspdf';

	let { targetId, filename = 'report' } = $props<{ targetId: string; filename?: string }>();

	async function capture(): Promise<string> {
		const node = document.getElementById(targetId);
		if (!node) throw new Error(`No element with id ${targetId}`);
		return toPng(node, { backgroundColor: '#ffffff' });
	}

	async function downloadPng() {
		const dataUrl = await capture();
		const link = document.createElement('a');
		link.href = dataUrl;
		link.download = `${filename}.png`;
		link.click();
	}

	async function downloadPdf() {
		const dataUrl = await capture();
		const img = new Image();
		img.src = dataUrl;
		await new Promise((resolve) => (img.onload = resolve));

		const pdf = new jsPDF({
			orientation: img.width > img.height ? 'landscape' : 'portrait',
			unit: 'px',
			format: [img.width, img.height]
		});
		pdf.addImage(dataUrl, 'PNG', 0, 0, img.width, img.height);
		pdf.save(`${filename}.pdf`);
	}

	async function copyToClipboard() {
		const dataUrl = await capture();
		const blob = await (await fetch(dataUrl)).blob();
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
	}
</script>

<div class="share-export-bar">
	<button onclick={downloadPng}>Screenshot (PNG)</button>
	<button onclick={downloadPdf}>Export PDF</button>
	<button onclick={copyToClipboard}>Copy to clipboard</button>
</div>

// Shared primitive elements as plain functions returning HTML strings.
// Cheaper than full Components for things that are pure markup.

export interface IconButtonOptions {
	icon: string; // svg string
	label?: string; // visible text
	title?: string; // tooltip
	id?: string;
	ariaLabel?: string;
	variant?: "ghost" | "round" | "round-danger" | "primary" | "pill";
	dropdown?: boolean; // show small caret on the right
	active?: boolean;
	disabled?: boolean;
	dataset?: Record<string, string>;
}

export function IconButton(opts: IconButtonOptions): string {
	const classes = [
		"icon-btn",
		`icon-btn--${opts.variant ?? "ghost"}`,
		opts.active ? "is-active" : "",
		opts.disabled ? "is-disabled" : "",
	].filter(Boolean).join(" ");
	const dataAttrs = opts.dataset
		? Object.entries(opts.dataset)
				.map(([k, v]) => `data-${k}="${escapeAttr(v)}"`)
				.join(" ")
		: "";
	const caret = opts.dropdown ? '<span class="icon-btn__caret">▾</span>' : "";
	const text = opts.label ? `<span class="icon-btn__label">${escapeHtml(opts.label)}</span>` : "";
	return `<button class="${classes}"${opts.id ? ` id="${opts.id}"` : ""}${opts.title ? ` title="${escapeAttr(opts.title)}"` : ""}${opts.ariaLabel ? ` aria-label="${escapeAttr(opts.ariaLabel)}"` : ""}${opts.disabled ? " disabled" : ""} ${dataAttrs}>
		<span class="icon-btn__icon">${opts.icon}</span>${text}${caret}
	</button>`;
}

export interface StatusPillOptions {
	label: string;
	tone?: "neutral" | "live" | "purple" | "info" | "warning";
	id?: string;
}

export function StatusPill(opts: StatusPillOptions): string {
	return `<span class="status-pill status-pill--${opts.tone ?? "neutral"}"${opts.id ? ` id="${opts.id}"` : ""}>${escapeHtml(opts.label)}</span>`;
}

export function Tooltip(text: string): string {
	return `<span class="tooltip">${escapeHtml(text)}</span>`;
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function escapeAttr(s: string): string {
	return escapeHtml(s).replace(/'/g, "&#39;");
}

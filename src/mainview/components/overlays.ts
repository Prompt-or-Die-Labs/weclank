// Modal, Popover, Toast — top-layer UI. All three share a single root element
// (#overlay-root) so positioning and z-index are predictable.

import { escapeHtml } from "./primitives";

let overlayRoot: HTMLElement | null = null;
let overlayId = 0;

function ensureRoot(): HTMLElement {
	if (overlayRoot) return overlayRoot;
	overlayRoot = document.createElement("div");
	overlayRoot.id = "overlay-root";
	document.body.appendChild(overlayRoot);
	return overlayRoot;
}

// ---------- Modal ----------

export interface ModalOptions {
	title: string;
	body: string | HTMLElement;
	onClose?: () => void;
	/**
	 * Focus this element on open (selector scoped to the modal backdrop).
	 * Use for dialogs where the primary control is not the close button (e.g. combobox filter, textarea).
	 * If missing or not focusable, falls back to the first focusable control in tab order.
	 */
	initialFocusSelector?: string;
}

export class Modal {
	private el: HTMLElement;
	private onKeyDown: (e: KeyboardEvent) => void;
	private previouslyFocused: HTMLElement | null;
	private closed = false;

	constructor(private opts: ModalOptions) {
		const root = ensureRoot();
		const titleId = `modal-title-${++overlayId}`;
		this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		this.el = document.createElement("div");
		this.el.className = "modal-backdrop";
		this.el.innerHTML = `
			<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
				<header class="modal__header">
					<h2 id="${titleId}">${escapeHtml(opts.title)}</h2>
					<button class="modal__close" aria-label="Close">×</button>
				</header>
				<div class="modal__body"></div>
			</div>
		`;
		const body = this.el.querySelector(".modal__body") as HTMLElement;
		if (typeof opts.body === "string") body.innerHTML = opts.body;
		else body.appendChild(opts.body);

		this.el.querySelector(".modal__close")?.addEventListener("click", () => this.close());
		this.el.addEventListener("click", (e) => {
			if (e.target === this.el) this.close();
		});
		// Escape closes; Tab cycles WITHIN the modal so keyboard users
		// can't accidentally focus the studio behind the backdrop.
		this.onKeyDown = (e: KeyboardEvent): void => {
			if (e.key === "Escape") {
				this.close();
				return;
			}
			if (e.key === "Tab") this.trapTab(e);
		};
		document.addEventListener("keydown", this.onKeyDown);
		root.appendChild(this.el);

		// Focus a sensible first control — optional override for filter-first / form-first dialogs.
		setTimeout(() => this.focusInitial(), 0);
	}

	private focusInitial(): void {
		const sel = this.opts.initialFocusSelector?.trim();
		if (sel) {
			const el = this.el.querySelector<HTMLElement>(sel);
			if (el && !el.hasAttribute("disabled") && !el.hidden && el.offsetParent !== null) {
				el.focus();
				return;
			}
		}
		this.focusable()[0]?.focus();
	}

	private focusable(): HTMLElement[] {
		const selector = [
			"a[href]",
			"button:not([disabled])",
			"input:not([disabled])",
			"textarea:not([disabled])",
			"select:not([disabled])",
			"[tabindex]:not([tabindex='-1'])",
		].join(",");
		return Array.from(this.el.querySelectorAll<HTMLElement>(selector))
			.filter((el) => !el.hidden && el.offsetParent !== null);
	}

	private trapTab(e: KeyboardEvent): void {
		const items = this.focusable();
		if (items.length === 0) return;
		const first = items[0]!;
		const last = items[items.length - 1]!;
		const active = document.activeElement as HTMLElement | null;
		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		document.removeEventListener("keydown", this.onKeyDown);
		this.opts.onClose?.();
		this.el.remove();
		this.previouslyFocused?.focus();
	}
}

// ---------- Popover ----------

export interface PopoverOptions {
	anchor: HTMLElement;
	content: string | HTMLElement;
	placement?: "top" | "bottom";
}

export class Popover {
	private el: HTMLElement;
	private close = (): void => {};
	private anchor: HTMLElement;
	private previouslyFocused: HTMLElement | null;
	private previousExpanded: string | null;
	private previousHasPopup: string | null;
	private closed = false;

	constructor(opts: PopoverOptions) {
		const root = ensureRoot();
		this.anchor = opts.anchor;
		this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		this.previousExpanded = opts.anchor.getAttribute("aria-expanded");
		this.previousHasPopup = opts.anchor.getAttribute("aria-haspopup");
		this.el = document.createElement("div");
		this.el.className = `popover popover--${opts.placement ?? "bottom"}`;
		// Hide until positioned so there's no flash at (0,0).
		this.el.style.visibility = "hidden";
		if (typeof opts.content === "string") this.el.innerHTML = opts.content;
		else this.el.appendChild(opts.content);
		this.prepareMenu();
		root.appendChild(this.el);

		// Defer coordinate calculation until after the browser has laid
		// out the element — offsetWidth/offsetHeight are 0 on the same
		// tick as appendChild, so the fallback (220/200) was always used
		// and the menu landed off-screen for right-edge anchors like the
		// user avatar.
		requestAnimationFrame(() => {
			const rect = opts.anchor.getBoundingClientRect();
			const placement = opts.placement ?? "bottom";

			const popW = this.el.offsetWidth || 220;
			const popH = this.el.offsetHeight || 200;
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const MARGIN = 8;

			// Horizontal: prefer left-aligned to anchor; if that overflows
			// the right edge, right-align to anchor instead; clamp to viewport.
			let left = rect.left;
			if (left + popW + MARGIN > vw) left = rect.right - popW;
			left = Math.max(MARGIN, Math.min(left, vw - popW - MARGIN));

			// Vertical: respect the requested placement but flip if it
			// would push the popover off-screen.
			let top = placement === "bottom" ? rect.bottom + 8 : rect.top - popH - 8;
			if (placement === "bottom" && top + popH + MARGIN > vh) top = rect.top - popH - 8;
			if (placement === "top" && top < MARGIN) top = rect.bottom + 8;
			top = Math.max(MARGIN, Math.min(top, vh - popH - MARGIN));

			this.el.style.left = `${left}px`;
			this.el.style.top = `${top}px`;
			this.el.style.visibility = "";
			this.firstMenuItem()?.focus();
		});

		const onDocClick = (e: MouseEvent): void => {
			if (!this.el.contains(e.target as Node) && e.target !== opts.anchor) this.dismiss();
		};
		const onKeyDown = (e: KeyboardEvent): void => this.onKeyDown(e);
		setTimeout(() => document.addEventListener("click", onDocClick), 0);
		document.addEventListener("keydown", onKeyDown);
		this.close = () => {
			document.removeEventListener("click", onDocClick);
			document.removeEventListener("keydown", onKeyDown);
		};
	}

	dismiss(): void {
		if (this.closed) return;
		this.closed = true;
		this.close();
		this.el.remove();
		this.restoreAnchorAttributes();
		(this.previouslyFocused ?? this.anchor).focus();
	}

	private prepareMenu(): void {
		const menu = this.el.querySelector<HTMLElement>(".menu");
		if (!menu) return;
		menu.setAttribute("role", "menu");
		this.anchor.setAttribute("aria-expanded", "true");
		this.anchor.setAttribute("aria-haspopup", "menu");
		for (const item of menu.querySelectorAll<HTMLButtonElement>(".menu__item")) {
			item.type = "button";
			item.setAttribute("role", "menuitem");
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			e.preventDefault();
			this.dismiss();
			return;
		}
		if (!this.el.contains(document.activeElement)) return;
		const items = this.menuItems();
		if (items.length === 0) return;
		const current = document.activeElement instanceof HTMLElement
			? items.indexOf(document.activeElement as HTMLButtonElement)
			: -1;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			items[(current + 1 + items.length) % items.length]?.focus();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			items[(current - 1 + items.length) % items.length]?.focus();
		} else if (e.key === "Home") {
			e.preventDefault();
			items[0]?.focus();
		} else if (e.key === "End") {
			e.preventDefault();
			items[items.length - 1]?.focus();
		}
	}

	private menuItems(): HTMLButtonElement[] {
		return Array.from(this.el.querySelectorAll<HTMLButtonElement>(".menu__item:not([disabled])"));
	}

	private firstMenuItem(): HTMLButtonElement | undefined {
		return this.menuItems()[0];
	}

	private restoreAnchorAttributes(): void {
		if (this.previousExpanded === null) this.anchor.removeAttribute("aria-expanded");
		else this.anchor.setAttribute("aria-expanded", this.previousExpanded);
		if (this.previousHasPopup === null) this.anchor.removeAttribute("aria-haspopup");
		else this.anchor.setAttribute("aria-haspopup", this.previousHasPopup);
	}
}

// ---------- Toast ----------

export function toast(message: string, tone: "info" | "success" | "error" = "info"): void {
	const root = ensureRoot();
	const el = document.createElement("div");
	el.className = `toast toast--${tone}`;
	el.setAttribute("role", "status");
	el.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
	el.textContent = message;
	root.appendChild(el);
	setTimeout(() => el.classList.add("toast--leaving"), 2400);
	setTimeout(() => el.remove(), 2900);
}

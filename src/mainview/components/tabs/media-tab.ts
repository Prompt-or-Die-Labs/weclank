// Media library — user-chosen root folder, categories as subfolders, import
// and thumbnails, and “use in scene” for voice-image agents.

import { Component } from "../../core/component";
import { openQrDialog } from "../qr-dialog";
import { studio } from "../../state/studio-store";
import { bunRpc } from "../../rpc";
import { toast } from "../overlays";
import { userMessageFor } from "../../core/errors";
import { mediaLibraryCategories } from "../../media/media-library";
import { DEFAULT_MEDIA_LIBRARY_CATEGORIES } from "../../core/types";
import { addVoiceImageFromLibraryPath } from "../../state/source-factory";

interface MediaTabState {
	root: string;
	categories: string[];
	selectedCategory: string;
	newCategory: string;
	filesByCat: Array<{ name: string; files: Array<{ name: string; path: string }> }>;
	thumbHtml: string;
}

export class MediaTab extends Component<MediaTabState> {
	private previewTokens = new Set<string>();

	constructor() {
		super({
			root: "",
			categories: [...DEFAULT_MEDIA_LIBRARY_CATEGORIES],
			selectedCategory: "QR codes",
			newCategory: "",
			filesByCat: [],
			thumbHtml: "",
		});
	}

	protected rootClass(): string {
		return "tab tab-media";
	}

	protected template(): string {
		const { root, categories, newCategory, thumbHtml } = this.state;
		const catOptions = categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
		const rootLine = root
			? `<p class="tab-media__path"><code>${escapeHtml(root)}</code></p>`
			: `<p class="tab-media__hint">Choose a folder on disk — saved QR codes, generated stills, and imports go into category subfolders.</p>`;
		return `
			<div class="tab-media__intro">
				<h3>Media library</h3>
				<p>Save broadcast graphics here, import images, and drop them into scenes as voice + image agents.</p>
			</div>
			<section class="tab-media__section">
				<h4>Library folder</h4>
				${rootLine}
				<div class="tab-media__row">
					<button type="button" data-action="pick-root">${root ? "Change folder…" : "Choose folder…"}</button>
					${root ? `<button type="button" data-action="clear-root">Clear</button>` : ""}
				</div>
			</section>
			<section class="tab-media__section">
				<h4>Categories</h4>
				<p class="tab-media__muted">Each category is a subfolder under the library root (defaults: ${DEFAULT_MEDIA_LIBRARY_CATEGORIES.join(", ")}).</p>
				<div class="tab-media__row">
					<input type="text" data-field="new-cat" placeholder="New category name" value="${escapeAttr(newCategory)}" />
					<button type="button" data-action="add-cat">Add</button>
				</div>
				<ul class="tab-media__cat-list">${categories.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
			</section>
			<section class="tab-media__section">
				<h4>Import images</h4>
				<label class="tab-media__row">
					<span>Into category</span>
					<select data-field="import-cat">${catOptions}</select>
				</label>
				<button type="button" data-action="import" ${root ? "" : "disabled"}>Import images…</button>
			</section>
			<section class="tab-media__section">
				<h4>Browse</h4>
				<label class="tab-media__row">
					<span>Category</span>
					<select data-field="browse-cat">${catOptions}</select>
				</label>
				<button type="button" data-action="refresh" ${root ? "" : "disabled"}>Refresh</button>
				<div class="tab-media__grid" data-region="thumbs">${thumbHtml}</div>
			</section>
			<section class="tab-media__section">
				<h4>QR code</h4>
				<button type="button" data-action="qr">QR Code…</button>
			</section>
		`;
	}

	protected bind(): void {
		const browseCat = this.el.querySelector<HTMLSelectElement>("[data-field=browse-cat]");
		if (browseCat) browseCat.value = this.state.selectedCategory;
		const importCat = this.el.querySelector<HTMLSelectElement>("[data-field=import-cat]");
		if (importCat) importCat.value = this.state.selectedCategory;

		this.on(this.el.querySelector("[data-action=pick-root]")!, "click", () => void this.pickRoot());
		const clearBtn = this.el.querySelector("[data-action=clear-root]");
		if (clearBtn) {
			this.on(clearBtn, "click", () => {
				studio.setStudioPrefs({ mediaLibraryRoot: undefined });
				this.clearThumbs();
				this.setState({ root: "", filesByCat: [], thumbHtml: "" });
			});
		}
		this.on(this.el.querySelector("[data-action=add-cat]")!, "click", () => {
			const input = this.el.querySelector<HTMLInputElement>("[data-field=new-cat]")!;
			const name = input.value.trim();
			if (!name) return;
			const next = [...new Set([...this.state.categories, name])];
			studio.setStudioPrefs({ mediaLibraryCategories: next });
			input.value = "";
			this.setState({ categories: next, newCategory: "" });
		});
		this.on(this.el.querySelector("[data-action=import]")!, "click", () => void this.importImages());
		this.on(this.el.querySelector("[data-action=refresh]")!, "click", () => void this.refreshThumbs());
		this.on(this.el.querySelector("[data-action=qr]")!, "click", () => openQrDialog());
		this.on(this.el.querySelector("[data-field=browse-cat]")!, "change", (e) => {
			const v = (e.target as HTMLSelectElement).value;
			this.setState({ selectedCategory: v });
		});
		this.on(this.el.querySelector("[data-field=import-cat]")!, "change", (e) => {
			this.setState({ selectedCategory: (e.target as HTMLSelectElement).value });
		});
		this.on(this.el, "click", (e) => {
			const t = (e.target as HTMLElement).closest("[data-action=scene]");
			if (!t) return;
			const enc = t.getAttribute("data-path");
			if (!enc) return;
			const path = decodeURIComponent(enc);
			void this.useInScene(path);
		});
	}

	protected afterMount(): void {
		const off = studio.select(
			(s) =>
				`${s.studioPrefs?.mediaLibraryRoot ?? ""}\x00${mediaLibraryCategories(s.studioPrefs).join("\x1e")}`,
			() => {
				this.setState({
					root: studio.state.studioPrefs?.mediaLibraryRoot ?? "",
					categories: mediaLibraryCategories(studio.state.studioPrefs),
				});
				void this.refreshThumbs();
			},
		);
		this.track(() => off());
		this.setState({
			root: studio.state.studioPrefs?.mediaLibraryRoot ?? "",
			categories: mediaLibraryCategories(studio.state.studioPrefs),
		});
		void this.refreshThumbs();
	}

	protected beforeDestroy(): void {
		this.clearThumbs();
	}

	private clearThumbs(): void {
		for (const token of this.previewTokens) {
			void bunRpc.unregisterRecordingPreview({ token }).catch(() => {});
		}
		this.previewTokens.clear();
	}

	private async pickRoot(): Promise<void> {
		try {
			const r = await bunRpc.pickMediaLibraryRoot({});
			if (r.canceled || !r.path) return;
			if (r.error) {
				toast(r.error, "error");
				return;
			}
			studio.setStudioPrefs({ mediaLibraryRoot: r.path });
			toast("Media library folder set", "success");
		} catch (err) {
			toast(userMessageFor(err), "error");
		}
	}

	private async importImages(): Promise<void> {
		const root = this.state.root.trim();
		if (!root) return;
		const cat =
			this.el.querySelector<HTMLSelectElement>("[data-field=import-cat]")?.value ?? this.state.selectedCategory;
		try {
			const r = await bunRpc.importMediaLibraryFromDialog({ rootPath: root, category: cat });
			if (r.canceled) return;
			if (!r.ok) {
				toast(r.error ?? "Import failed", "error");
				return;
			}
			const n = r.copied?.length ?? 0;
			toast(n ? `Imported ${n} image(s)` : "No supported images selected", n ? "success" : "info");
			await this.refreshThumbs();
		} catch (err) {
			toast(userMessageFor(err), "error");
		}
	}

	private async refreshThumbs(): Promise<void> {
		const root = this.state.root.trim();
		const cat =
			this.el.querySelector<HTMLSelectElement>("[data-field=browse-cat]")?.value ?? this.state.selectedCategory;
		this.clearThumbs();
		if (!root) {
			this.setState({ filesByCat: [], thumbHtml: "<p class=\"tab-media__muted\">Set a library folder to browse.</p>" });
			return;
		}
		try {
			const r = await bunRpc.listMediaLibrary({
				rootPath: root,
				categories: [cat],
			});
			if (!r.ok) {
				this.setState({ thumbHtml: `<p class="tab-media__muted">${escapeHtml(r.error ?? "List failed")}</p>` });
				return;
			}
			const block = r.categories?.[0];
			const files = block?.files ?? [];
			if (files.length === 0) {
				this.setState({ filesByCat: r.categories ?? [], thumbHtml: "<p class=\"tab-media__muted\">No images in this category yet.</p>" });
				return;
			}
			const parts: string[] = [];
			for (const f of files) {
				const reg = await bunRpc.registerMediaLibraryImagePreview({ path: f.path });
				if (!reg.ok || !reg.url || !reg.token) continue;
				this.previewTokens.add(reg.token);
				const pathEnc = encodeURIComponent(f.path);
				parts.push(`
					<div class="media-tab__thumb">
						<img src="${reg.url}" alt="" width="80" height="80" loading="lazy" />
						<div class="media-tab__thumb-meta">${escapeHtml(f.name)}</div>
						<button type="button" data-action="scene" data-path="${pathEnc}">Use in scene</button>
					</div>`);
			}
			this.setState({
				filesByCat: r.categories ?? [],
				thumbHtml: parts.join("") || "<p class=\"tab-media__muted\">No previews available.</p>",
			});
		} catch (err) {
			this.setState({ thumbHtml: `<p class="tab-media__muted">${escapeHtml(userMessageFor(err))}</p>` });
		}
	}

	private async useInScene(absPath: string): Promise<void> {
		try {
			const id = await addVoiceImageFromLibraryPath(absPath);
			if (id) toast("Voice + image source added to the active scene", "success");
		} catch (err) {
			toast(userMessageFor(err), "error");
		}
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
	return escapeHtml(s).replace(/'/g, "&#39;");
}

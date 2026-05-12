// Studio Live entrypoint. Loads RPC, gates on auth, hydrates per-user
// state, then mounts the studio shell or a utility window.

import "./rpc";
import { getUtilityWindowKind } from "./rpc";
import { AppHeader } from "./components/app-header";
import { ScenePanel } from "./components/scene-panel";
import { StageCanvas } from "./components/stage-canvas";
import { StageToolbar } from "./components/stage-toolbar";
import { TransformOverlay } from "./components/transform-overlay";
import { BackstageStrip } from "./components/backstage-strip";
import { rendererFarm } from "./components/renderer-farm";
import { RightSidebar } from "./components/right-sidebar";
import { AudioMixerStrip } from "./components/audio-mixer-strip";
import { StatsStrip } from "./components/stats-strip";
import { ProducerTray } from "./components/producer-tray";
import { audioMixer } from "./streaming/audio-mixer";
import { syncTranscriptFeed } from "./transcript/feed";
import { resumeMusicOnBoot } from "./streaming/music-player";
import { authStore } from "./auth/auth-store";
import { mountSplash } from "./views/splash";
import { hydrateFromUser } from "./state/persistence";
import { studio } from "./state/studio-store";
import { initTheme } from "./components/theme";
import { installHotkeys } from "./components/hotkeys";
import { mountUtilityWindow, parseUtilityWindowKind, type UtilityWindowKind } from "./components/utility-window";
import { installNativeContextMenu } from "./components/native-context-menu";
import { SetupChecklistStrip } from "./components/setup-strip";
import { StudioHealthBanner } from "./components/studio-health-banner";
import { shouldOfferFirstRunWizard, openSetupWizard } from "./components/setup-wizard";

async function boot(): Promise<void> {
	initTheme();
	installNativeContextMenu();
	
	// Restore user first
	let user = await authStore.restore();
	let utilityKind = parseUtilityWindowKind() ?? coerceUtilityWindowKind(getUtilityWindowKind());
	if (!user && !utilityKind) {
		// Only show splash if this is the main window and not logged in
		user = await mountSplash();
	}

	// Hydrate studio state if logged in
	if (user) {
		studio.installRestored(await hydrateFromUser(user.id));
	}

	// Wait for the initializeUtilityWindow RPC message (sent on dom-ready).
	// Poll briefly so we reliably detect utility windows even if the message
	// arrives after the first tick.
	for (let i = 0; i < 10 && !utilityKind; i++) {
		await new Promise((r) => setTimeout(r, 30));
		utilityKind = coerceUtilityWindowKind(getUtilityWindowKind());
	}

	if (utilityKind) {
		mountUtilityWindow(utilityKind);
		return;
	}

	// This is the main studio window
	mountShell();
}

function mountShell(): void {
	const app = document.getElementById("app");
	if (!app) throw new Error("#app missing");
	app.className = "app";
	app.innerHTML = ""; // clear any auth-time content

	const skip = document.createElement("a");
	skip.className = "skip-link";
	skip.href = "#program-main";
	skip.textContent = "Skip to program stage";
	app.appendChild(skip);

	// Mount the offscreen renderer farm first so any participants that
	// hydrated from persistence get their renderers attached before the
	// stream engine starts requesting frames.
	rendererFarm.mount();
	void rendererFarm.hydrate();

	// Each component's root has the grid-area class baked in. Mounting
	// direct to #app keeps them as direct grid children so named areas
	// actually apply.
	const preflight = document.createElement("div");
	preflight.className = "app-preflight";
	app.appendChild(preflight);
	new StudioHealthBanner().mount(preflight);
	new SetupChecklistStrip().mount(preflight);

	new AppHeader().mount(app);
	new ScenePanel().mount(app);

	const stageWrap = document.createElement("div");
	stageWrap.id = "program-main";
	stageWrap.className = "stage-wrap";
	stageWrap.setAttribute("role", "main");
	stageWrap.setAttribute("aria-label", "Program preview and stage");
	app.appendChild(stageWrap);
	new StageToolbar().mount(stageWrap);
	const stage = new StageCanvas();
	stage.mount(stageWrap);
	const overlayHost = stage.getOverlayHost();
	if (overlayHost) new TransformOverlay().mount(overlayHost);
	new BackstageStrip().mount(stageWrap);

	new RightSidebar().mount(app);
	new AudioMixerStrip().mount(app);
	new StatsStrip().mount(app);

	// Producer tray — mounted to body so it floats above the grid and
	// the slide animation doesn't reflow anything else.
	new ProducerTray().mount(document.body);

	installHotkeys();

	if (shouldOfferFirstRunWizard()) {
		queueMicrotask(() => openSetupWizard());
	}

	// Resume the transcript watcher if persistence has a path.
	void syncTranscriptFeed();

	// WebAudio contexts require a user gesture before they can resume.
	// First click anywhere unblocks audio and re-attaches any persisted
	// background music track.
	const arm = (): void => {
		audioMixer.resume().catch(() => {});
		void resumeMusicOnBoot();
		window.removeEventListener("click", arm);
	};
	window.addEventListener("click", arm, { once: true });
}

document.addEventListener("DOMContentLoaded", () => void boot());

function coerceUtilityWindowKind(value: string | null): UtilityWindowKind | null {
	switch (value) {
		case "studio":
		case "chat":
		case "producer":
		case "stats":
		case "overlay":
		case "prompter":
			return value;
		default:
			return null;
	}
}

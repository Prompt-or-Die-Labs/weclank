// `window.obsstudio` shim. Injected into browser-source iframes by the
// renderer (see `renderers/browser-renderer.ts`), this makes
// StreamElements / Streamlabs / Nightbot / custom alert pages
// feature-detect us as OBS and emit their OBS-specific overlay
// behavior (transparent bg, scene-aware widgets, etc.).
//
// Communication with the host happens over postMessage. The renderer
// listens for "obs:method" messages and responds with "obs:result";
// state-change events are pushed FROM the renderer as "obs:event"
// messages which the shim dispatches as `obsSceneChanged`/etc.
// CustomEvents on the iframe's window.
//
// Stays small + dependency-free: this code runs in the browser-source
// page, not in weclank itself, so we don't want to ship a kitchen-sink
// runtime to every overlay page.

export const SHIM_VERSION = "0.3.0";

/** Build the inline script that gets injected into the iframe.
 *  Generated as a string so it can be added via `<script>` or
 *  `iframe.contentWindow.eval(...)` without bundler involvement. */
export function obsStudioShimSource(version: string = SHIM_VERSION): string {
	return `
(function () {
	if (window.obsstudio) return; // already initialised
	var nextId = 1;
	var pending = new Map(); // callId → callback

	function call(method, args, callback) {
		var id = nextId++;
		if (callback) pending.set(id, callback);
		window.parent.postMessage({
			type: "obs:method",
			id: id,
			method: method,
			args: args || [],
		}, "*");
	}

	function emit(eventName, detail) {
		try {
			window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
		} catch (e) {
			// Some pages may freeze CustomEvent in restricted contexts; ignore.
		}
	}

	window.addEventListener("message", function (event) {
		var data = event.data;
		if (!data || typeof data !== "object") return;
		if (data.type === "obs:result" && data.id && pending.has(data.id)) {
			var cb = pending.get(data.id);
			pending.delete(data.id);
			try { cb(data.value); } catch (e) {}
		} else if (data.type === "obs:event" && data.name) {
			emit(data.name, data.detail);
		}
	});

	window.obsstudio = {
		pluginVersion: ${JSON.stringify(version)},
		getControlLevel: function (cb) { call("getControlLevel", [], cb); },
		getStatus: function (cb) { call("getStatus", [], cb); },
		getCurrentScene: function (cb) { call("getCurrentScene", [], cb); },
		getScenes: function (cb) { call("getScenes", [], cb); },
		getTransitions: function (cb) { call("getTransitions", [], cb); },
		getCurrentTransition: function (cb) { call("getCurrentTransition", [], cb); },
		setCurrentScene: function (name) { call("setCurrentScene", [name]); },
		setCurrentTransition: function (name) { call("setCurrentTransition", [name]); },
		startStreaming: function () { call("startStreaming", []); },
		stopStreaming: function () { call("stopStreaming", []); },
		startRecording: function () { call("startRecording", []); },
		stopRecording: function () { call("stopRecording", []); },
		pauseRecording: function () { call("pauseRecording", []); },
		unpauseRecording: function () { call("unpauseRecording", []); },
		saveReplayBuffer: function () { call("saveReplayBuffer", []); },
		startReplayBuffer: function () { call("startReplayBuffer", []); },
		stopReplayBuffer: function () { call("stopReplayBuffer", []); },
		startVirtualcam: function () { call("startVirtualcam", []); },
		stopVirtualcam: function () { call("stopVirtualcam", []); },
	};
})();
`;
}

// Mirror types for the host side. The renderer constructs these
// messages when dispatching events to iframes; tests can use them
// to assert message shapes.

export type ObsMethodCall = {
	type: "obs:method";
	id: number;
	method: string;
	args: unknown[];
};

export type ObsMethodResult = {
	type: "obs:result";
	id: number;
	value: unknown;
};

export type ObsHostEvent = {
	type: "obs:event";
	/** Custom-event name as dispatched on the iframe's window
	 *  (e.g. `obsSceneChanged`, `obsStreamingStarted`). */
	name: string;
	detail?: unknown;
};

export const OBS_EVENTS = {
	sceneChanged: "obsSceneChanged",
	sceneListChanged: "obsSceneListChanged",
	streamingStarting: "obsStreamingStarting",
	streamingStarted: "obsStreamingStarted",
	streamingStopping: "obsStreamingStopping",
	streamingStopped: "obsStreamingStopped",
	recordingStarting: "obsRecordingStarting",
	recordingStarted: "obsRecordingStarted",
	recordingPaused: "obsRecordingPaused",
	recordingUnpaused: "obsRecordingUnpaused",
	recordingStopping: "obsRecordingStopping",
	recordingStopped: "obsRecordingStopped",
	replaybufferStarting: "obsReplaybufferStarting",
	replaybufferStarted: "obsReplaybufferStarted",
	replaybufferSaved: "obsReplaybufferSaved",
	replaybufferStopping: "obsReplaybufferStopping",
	replaybufferStopped: "obsReplaybufferStopped",
	sourceVisibleChanged: "obsSourceVisibleChanged",
	sourceActiveChanged: "obsSourceActiveChanged",
	exit: "obsExit",
} as const;

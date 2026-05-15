import type { ElectrobunConfig } from "electrobun";
import { PRODUCT_VERSION } from "./src/mainview/product";

export default {
	app: {
		name: "weclank",
		identifier: "weclank.localfirst.dev",
		version: PRODUCT_VERSION,
	},
	build: {
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
			prompter: {
				entrypoint: "src/prompter/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"src/mainview/assets/retaketv.svg": "views/mainview/assets/retaketv.svg",
			"src/prompter/index.html": "views/prompter/index.html",
			// Tray icon is resolved at runtime via `views://icons/trayicon.png`
			// from src/bun/index.ts. The Bun-generated build/canary-*/Resources/
			// app/views/icons/ path is what Electrobun's Tray.resolveImagePath
			// joins against.
			"assets/icons/trayicon.png": "views/icons/trayicon.png",
		},
		mac: {
			bundleCEF: false,
			codesign: false,
			icons: "assets/icons/icon.iconset",
			entitlements: {
				"com.apple.security.device.camera":
					"Weclank uses the camera for webcam sources in your scenes",
				"com.apple.security.device.audio-input":
					"Weclank uses the microphone for audio sources, including external-voice AI agents that pipe audio through a virtual audio device",
				"com.apple.security.screen-recording":
					"Weclank uses screen recording to capture displays and windows as scene sources",
			},
		},
		linux: {
			bundleCEF: true,
			icon: "assets/icons/icon.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/icons/icon.ico",
		},
	},
} satisfies ElectrobunConfig;

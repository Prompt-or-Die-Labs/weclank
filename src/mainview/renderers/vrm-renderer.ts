// VRM renderer — loads a .vrm file with three-vrm, drives the mouth from
// audio amplitude, plays an idle pose by default. When no model URL is set,
// renders a placeholder sphere so the tile is never empty.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";
import { createThreeHost, type ThreeHost } from "./three-host";
import { LipSync } from "./lip-sync";

export class VRMRenderer implements AgentRenderer {
	readonly kind = "voice-vrm" as const;
	private host: ThreeHost | null = null;
	private vrm: VRM | null = null;
	private placeholder: THREE.Mesh | null = null;
	private lipSync: LipSync | null = null;
	private raf = 0;
	private resizeObserver: ResizeObserver | null = null;

	async attach(ctx: RendererContext, participant: Participant): Promise<void> {
		this.host = createThreeHost({ background: null });
		this.host.canvas.className = "renderer-canvas";
		ctx.host.appendChild(this.host.canvas);

		this.resizeObserver = new ResizeObserver(([entry]) => {
			if (!this.host || !entry) return;
			const { width, height } = entry.contentRect;
			this.host.resize(width, height);
		});
		this.resizeObserver.observe(ctx.host);

		if (ctx.analyser) this.lipSync = new LipSync(ctx.analyser);

		const url = participant.visual?.modelUrl;
		if (url) {
			await this.loadModel(url);
		} else {
			this.addPlaceholder();
		}

		this.raf = requestAnimationFrame(this.loop);
		ctx.onReady?.();
	}

	private async loadModel(url: string): Promise<void> {
		const loader = new GLTFLoader();
		loader.register((parser) => new VRMLoaderPlugin(parser));
		const gltf = await loader.loadAsync(url);
		const vrm = gltf.userData["vrm"] as VRM;
		VRMUtils.removeUnnecessaryVertices(gltf.scene);
		VRMUtils.combineSkeletons(gltf.scene);
		vrm.scene.traverse((obj) => {
			obj.frustumCulled = false;
		});
		this.host!.scene.add(vrm.scene);
		this.vrm = vrm;
	}

	private addPlaceholder(): void {
		// Soft glowing sphere so the tile reads as "agent is here, model
		// pending" instead of looking broken.
		const geo = new THREE.SphereGeometry(0.4, 48, 48);
		const mat = new THREE.MeshStandardMaterial({
			color: 0x6c5ce7,
			emissive: 0x6c5ce7,
			emissiveIntensity: 0.25,
			roughness: 0.4,
			metalness: 0.1,
		});
		const sphere = new THREE.Mesh(geo, mat);
		sphere.position.set(0, 1.3, 0);
		this.host!.scene.add(sphere);
		this.placeholder = sphere;
	}

	update(_p: Participant): void {}

	detach(): void {
		cancelAnimationFrame(this.raf);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.host?.dispose();
		this.host = null;
		this.vrm = null;
		this.placeholder = null;
		this.lipSync = null;
	}

	getFrameSource(): CanvasImageSource | null {
		return this.host?.canvas ?? null;
	}

	// Idle-aware throttle: when the agent isn't speaking and there's no
	// active animation, drop from full rAF (60fps) to ~10fps. The user
	// can't see the difference on a still avatar, and we save the GPU
	// pipeline cost.
	private lastRenderAt = 0;
	private lastActivityAt = 0;

	private loop = (now: number): void => {
		this.raf = requestAnimationFrame(this.loop);
		if (!this.host) return;

		const open = this.lipSync?.read() ?? 0;
		if (open > 0.04) this.lastActivityAt = now;
		const idle = now - this.lastActivityAt > 400;
		const targetInterval = idle ? 1000 / 10 : 1000 / 30;
		if (now - this.lastRenderAt < targetInterval) return;
		this.lastRenderAt = now;

		const dt = this.host.clock.getDelta();
		if (this.vrm && this.lipSync) {
			this.vrm.expressionManager?.setValue("aa", open);
			this.vrm.update(dt);
		}
		if (this.placeholder) {
			this.placeholder.rotation.y += dt * 0.4;
			this.placeholder.scale.setScalar(1 + open * 0.15);
		}
		this.host.renderer.render(this.host.scene, this.host.camera);
	};
}

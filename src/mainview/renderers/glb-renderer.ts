// GLB renderer — loads any glTF/GLB asset (no VRM rigging required) and plays
// an "idle" / "talking" animation clip if provided. Mouth bone scale picks
// up audio amplitude as a fallback for non-rigged models.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";
import { createThreeHost, type ThreeHost } from "./three-host";
import { LipSync } from "./lip-sync";

export class GLBRenderer implements AgentRenderer {
	readonly kind = "voice-glb" as const;
	private host: ThreeHost | null = null;
	private root: THREE.Object3D | null = null;
	private mixer: THREE.AnimationMixer | null = null;
	private idleAction: THREE.AnimationAction | null = null;
	private talkAction: THREE.AnimationAction | null = null;
	private mouthBone: THREE.Object3D | null = null;
	private lipSync: LipSync | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private raf = 0;

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
		if (url) await this.loadModel(url, participant);
		else this.addPlaceholder();

		this.raf = requestAnimationFrame(this.loop);
		ctx.onReady?.();
	}

	private async loadModel(url: string, p: Participant): Promise<void> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(url);
		const root = gltf.scene;
		root.traverse((obj) => {
			obj.frustumCulled = false;
			if ((obj as THREE.Bone).isBone && /jaw|mouth/i.test(obj.name)) {
				this.mouthBone = obj;
			}
		});
		this.host!.scene.add(root);
		this.root = root;

		if (gltf.animations.length > 0) {
			this.mixer = new THREE.AnimationMixer(root);
			const idleName = p.visual?.animations?.idle;
			const talkName = p.visual?.animations?.talking;
			const idle = idleName
				? gltf.animations.find((c) => c.name === idleName)
				: gltf.animations[0];
			const talk = talkName ? gltf.animations.find((c) => c.name === talkName) : undefined;
			if (idle) {
				this.idleAction = this.mixer.clipAction(idle).play();
			}
			if (talk) {
				this.talkAction = this.mixer.clipAction(talk);
				this.talkAction.setEffectiveWeight(0);
				this.talkAction.play();
			}
		}
	}

	private addPlaceholder(): void {
		const geo = new THREE.IcosahedronGeometry(0.45, 1);
		const mat = new THREE.MeshStandardMaterial({
			color: 0x00b894,
			emissive: 0x00b894,
			emissiveIntensity: 0.2,
			flatShading: true,
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(0, 1.3, 0);
		this.host!.scene.add(mesh);
		this.root = mesh;
	}

	update(_p: Participant): void {}

	detach(): void {
		cancelAnimationFrame(this.raf);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.mixer = null;
		this.idleAction = null;
		this.talkAction = null;
		this.root = null;
		this.mouthBone = null;
		this.host?.dispose();
		this.host = null;
		this.lipSync = null;
	}

	getFrameSource(): CanvasImageSource | null {
		return this.host?.canvas ?? null;
	}

	// Throttle like the VRM renderer — animated clips look fine at 30fps,
	// still scenes can drop to ~10fps with no perceptible difference.
	private lastRenderAt = 0;
	private lastActivityAt = 0;

	private loop = (now: number): void => {
		this.raf = requestAnimationFrame(this.loop);
		if (!this.host) return;

		const open = this.lipSync?.read() ?? 0;
		// "Active" = audio is going OR a baked animation clip is playing.
		// The latter is hard to detect from outside three.js, so we just
		// stay at 30fps whenever a mixer exists.
		const animationActive = this.mixer != null;
		if (open > 0.04 || animationActive) this.lastActivityAt = now;
		const idle = now - this.lastActivityAt > 400;
		const targetInterval = idle ? 1000 / 10 : 1000 / 30;
		if (now - this.lastRenderAt < targetInterval) return;
		this.lastRenderAt = now;

		const dt = this.host.clock.getDelta();
		if (this.talkAction && this.idleAction) {
			this.talkAction.setEffectiveWeight(open);
			this.idleAction.setEffectiveWeight(1 - open * 0.7);
		} else if (this.mouthBone) {
			this.mouthBone.scale.y = 1 + open * 0.6;
		} else if (this.root && !this.mixer) {
			this.root.rotation.y += dt * 0.35;
			this.root.scale.setScalar(1 + open * 0.15);
		}

		this.mixer?.update(dt);
		this.host.renderer.render(this.host.scene, this.host.camera);
	};
}

// Shared three.js setup. Both VRM and GLB renderers stand up the same scene,
// camera, lighting, and renderer; only the loader and the per-frame update
// differ. We expose the renderer's domElement so the tile can append it.

import * as THREE from "three";

export interface ThreeHostOptions {
	background?: THREE.ColorRepresentation | null;
	cameraPosition?: [number, number, number];
}

export interface ThreeHost {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	renderer: THREE.WebGLRenderer;
	clock: THREE.Clock;
	canvas: HTMLCanvasElement;
	resize(width: number, height: number): void;
	dispose(): void;
}

export function createThreeHost(opts: ThreeHostOptions = {}): ThreeHost {
	const scene = new THREE.Scene();
	if (opts.background !== null) {
		scene.background = new THREE.Color(opts.background ?? 0x0a0a0a);
	}

	const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
	const [cx, cy, cz] = opts.cameraPosition ?? [0, 1.4, 2.5];
	camera.position.set(cx, cy, cz);
	camera.lookAt(0, 1.3, 0);

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const key = new THREE.DirectionalLight(0xffffff, 1.4);
	key.position.set(2, 4, 3);
	scene.add(key);
	const fill = new THREE.DirectionalLight(0xb0c4ff, 0.6);
	fill.position.set(-3, 2, -1);
	scene.add(fill);
	scene.add(new THREE.AmbientLight(0xffffff, 0.25));

	const clock = new THREE.Clock();

	return {
		scene,
		camera,
		renderer,
		clock,
		canvas: renderer.domElement,
		resize(width, height) {
			renderer.setSize(width, height, false);
			camera.aspect = width / Math.max(1, height);
			camera.updateProjectionMatrix();
		},
		dispose() {
			// Walk the scene and dispose every GL resource we can see —
			// geometry, materials, AND the textures hanging off those
			// materials. Missing the textures was leaking VRAM on every
			// avatar swap.
			scene.traverse((obj) => {
				const mesh = obj as THREE.Mesh;
				if (mesh.geometry) mesh.geometry.dispose();
				const materials = Array.isArray(mesh.material)
					? mesh.material
					: mesh.material ? [mesh.material] : [];
				for (const mat of materials) {
					const bag = mat as unknown as Record<string, unknown>;
					for (const key of Object.keys(bag)) {
						const value = bag[key];
						if (value && typeof value === "object" && "dispose" in value && typeof (value as { dispose: unknown }).dispose === "function") {
							try { (value as { dispose: () => void }).dispose(); } catch { /* noop */ }
						}
					}
					mat.dispose();
				}
			});
			renderer.dispose();
		},
	};
}

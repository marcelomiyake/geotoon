import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { GroundLayer } from '../scene/ground.js';
import type { MeshData } from '../scene/mesh-buffer.js';
import {
  CROWN_COLOUR,
  INK_COLOUR,
  MARKER_COLOUR,
  SKY_COLOUR,
  TRUNK_COLOUR,
} from '../scene/palette.js';
import type { BuiltScene } from '../scene/scene-builder.js';

export const EYE_HEIGHT_M = 1.7;
const FOG_NEAR_M = 150;
const FOG_FAR_M = 600;
/** Silhouette outline (OutlineEffect), as a fraction of the screen height. */
const OUTLINE_THICKNESS = 0.006;
/** Contour lines on every building edge, in CSS pixels at any distance (anime ink style). */
const CONTOUR_WIDTH_PX = 2.2;
/** Two-tone cel shading: shadow and lit, with no soft mid band. */
const CEL_STEPS = [150, 255];
const MARKER_HEIGHT_M = 24;

/** Draw order and depth bias for flat layers: later layers win where they overlap. */
const GROUND_ORDER: readonly GroundLayer[] = ['base', 'landuse', 'water', 'green', 'roads'];

type OutlineUserData = { outlineParameters?: { visible?: boolean; thickness?: number } };

/** WebGL scene with toon materials, ink outlines, fog and a fixed sun. */
export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.2, FOG_FAR_M + 50);
  private readonly effect: OutlineEffect;
  private readonly gradient: THREE.DataTexture;
  private content = new THREE.Group();
  private contourMaterial: LineMaterial | undefined;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    onContextLost: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      onContextLost();
    });

    this.effect = new OutlineEffect(this.renderer, {
      defaultThickness: OUTLINE_THICKNESS,
      defaultColor: new THREE.Color(INK_COLOUR).toArray(),
      defaultAlpha: 1,
    });
    this.gradient = new THREE.DataTexture(new Uint8Array(CEL_STEPS), CEL_STEPS.length, 1, THREE.RedFormat);
    this.gradient.minFilter = THREE.NearestFilter;
    this.gradient.magFilter = THREE.NearestFilter;
    this.gradient.generateMipmaps = false;
    this.gradient.needsUpdate = true;

    this.scene.background = new THREE.Color(SKY_COLOUR);
    this.scene.fog = new THREE.Fog(SKY_COLOUR, FOG_NEAR_M, FOG_FAR_M);
    const sun = new THREE.DirectionalLight(0xfff6e5, 2.6);
    sun.position.set(-0.7, 1, -0.7);
    this.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0xb8a888, 1));
    this.scene.add(this.content);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setScene(built: BuiltScene): void {
    this.clear();
    const group = new THREE.Group();
    // Faces are pushed back a little so the contour lines on their edges always win the depth test.
    const buildingMaterial = this.toonMaterial({
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    for (const chunk of built.buildings) {
      group.add(this.mesh(chunk, buildingMaterial));
    }
    group.add(...this.contours(built.buildingEdges));
    GROUND_ORDER.forEach((layer, index) => {
      const data = built.ground[layer];
      if (data.triangles === 0) {
        return;
      }
      const material = this.toonMaterial({
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -index,
        polygonOffsetUnits: -index * 4,
      });
      hideOutline(material);
      const mesh = this.mesh(data, material);
      mesh.renderOrder = index;
      group.add(mesh);
    });
    group.add(...this.trees(built));
    group.add(this.marker());
    this.content = group;
    this.scene.add(group);
  }

  render(): void {
    this.effect.render(this.scene, this.camera);
  }

  setAnimationLoop(callback: ((time: number) => void) | null): void {
    this.renderer.setAnimationLoop(callback);
  }

  triangleCount(): number {
    return this.renderer.info.render.triangles;
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.contourMaterial?.resolution.set(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private toonMaterial(parameters: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({ gradientMap: this.gradient, ...parameters });
  }

  private mesh(data: MeshData, material: THREE.Material): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  /** Ink lines along every building edge; screen-space width, faded by the fog like the rest. */
  private contours(edges: readonly Float32Array[]): THREE.Object3D[] {
    if (edges.length === 0) {
      return [];
    }
    const material = new LineMaterial({
      color: INK_COLOUR,
      linewidth: CONTOUR_WIDTH_PX,
      worldUnits: false,
      fog: true,
    });
    material.resolution.set(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight));
    hideOutline(material);
    this.contourMaterial = material;
    return edges.map((positions) => new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material));
  }

  private trees(built: BuiltScene): THREE.Object3D[] {
    const { data, count } = built.trees;
    if (count === 0) {
      return [];
    }
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.22, 2.2, 6).translate(0, 1.1, 0);
    const crownGeometry = new THREE.ConeGeometry(1.7, 4.2, 7).translate(0, 4.1, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeometry,
      this.toonMaterial({ color: TRUNK_COLOUR }),
      count,
    );
    const crowns = new THREE.InstancedMesh(
      crownGeometry,
      this.toonMaterial({ color: CROWN_COLOUR }),
      count,
    );
    // OutlineEffect does not support instancing; trees keep toon shading without ink lines.
    hideOutline(trunks.material);
    hideOutline(crowns.material);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i += 1) {
      position.set(data[i * 4]!, 0, data[i * 4 + 1]);
      const s = data[i * 4 + 2]!;
      scale.set(s, s, s);
      rotation.setFromAxisAngle(up, data[i * 4 + 3]!);
      matrix.compose(position, rotation, scale);
      trunks.setMatrixAt(i, matrix);
      crowns.setMatrixAt(i, matrix);
    }
    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();
    return [trunks, crowns];
  }

  /** A pin at the searched address (the area centre), tall enough to show above most roofs. */
  private marker(): THREE.Object3D {
    const material = this.toonMaterial({ color: MARKER_COLOUR });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, MARKER_HEIGHT_M, 8).translate(0, MARKER_HEIGHT_M / 2, 0),
      material,
    );
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 16, 12).translate(0, MARKER_HEIGHT_M + 1, 0),
      material,
    );
    const marker = new THREE.Group();
    marker.add(pole, head);
    return marker;
  }

  private clear(): void {
    this.scene.remove(this.content);
    this.content.traverse((object) => {
      if (!isMesh(object)) {
        return;
      }
      const mesh = object;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
    this.content = new THREE.Group();
  }
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && object.isMesh === true;
}

function hideOutline(material: THREE.Material): void {
  (material.userData as OutlineUserData).outlineParameters = { visible: false };
}

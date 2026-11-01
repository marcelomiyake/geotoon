import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FacadeStyle } from '../scene/architecture.js';
import { GROUND_LAYERS } from '../scene/ground.js';
import type { MeshData } from '../scene/mesh-buffer.js';
import {
  CROWN_COLOUR,
  FRAME_COLOUR,
  GLASS_COLOUR,
  GLASS_HIGHLIGHT_COLOUR,
  INK_COLOUR,
  LIT_TINT,
  MARKER_COLOUR,
  POLE_COLOUR,
  type Rgb,
  SHADE_LIFT,
  SHADOW_TINT,
  SKY_HORIZON_COLOUR,
  TRIM_COLOUR,
  TRUNK_COLOUR,
} from '../scene/palette.js';
import type { BuiltScene } from '../scene/scene-builder.js';
import { CROSSARM_Y_M, POLE_HEIGHT_M } from '../scene/street.js';
import { Backdrop } from './backdrop.js';
import { FACADE_FRAGMENT, FACADE_FRAGMENT_PARS, FACADE_VERTEX, FACADE_VERTEX_PARS } from './facade-shader.js';
import { createStreetSigns } from './street-signs.js';

export const EYE_HEIGHT_M = 1.7;
const FOG_NEAR_M = 180;
const FOG_FAR_M = 700;
/** Silhouette outline (OutlineEffect), as a fraction of the screen height. */
const OUTLINE_THICKNESS = 0.004;
/** Contour lines on every building edge, in CSS pixels at any distance (anime ink style). */
const CONTOUR_WIDTH_PX = 1.8;
const WIRE_WIDTH_PX = 1.2;
/** Two-tone cel shading: a face either faces the sun or gets only the shade light. */
const CEL_STEPS = [0, 255];
const MARKER_HEIGHT_M = 24;

/** Toward the sun: high in the north-west (the sun is to the north in São Paulo). */
const SUN_DIRECTION = new THREE.Vector3(-0.45, 1.05, -0.62).normalize();
const SUN_DISTANCE_M = 400;
/** Cast shadows cover a square this many metres either side of the walker. */
const SHADOW_HALF_M = 130;
const SHADOW_MAP_PX = 4096;
/** The shadow map is redrawn only when the walker has moved this far. */
const SHADOW_RECENTRE_M = 40;

type OutlineUserData = { outlineParameters?: { visible?: boolean; thickness?: number } };

/** WebGL scene with cel lighting, cast shadows, ink outlines, fog and a painted sky. */
export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.2, FOG_FAR_M + 20);
  private readonly effect: OutlineEffect;
  private readonly gradient: THREE.DataTexture;
  private readonly backdrop: Backdrop;
  private readonly sun: THREE.DirectionalLight;
  private shadowCentre: THREE.Vector2 | undefined;
  private content = new THREE.Group();
  private lineMaterials: LineMaterial[] = [];
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    onContextLost: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
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
    (this.effect as unknown as { autoClear: boolean }).autoClear = false;
    this.gradient = new THREE.DataTexture(new Uint8Array(CEL_STEPS), CEL_STEPS.length, 1, THREE.RedFormat);
    this.gradient.minFilter = THREE.NearestFilter;
    this.gradient.magFilter = THREE.NearestFilter;
    this.gradient.generateMipmaps = false;
    this.gradient.needsUpdate = true;
    this.backdrop = new Backdrop(this.gradient, SUN_DIRECTION);

    this.scene.fog = new THREE.Fog(SKY_HORIZON_COLOUR, FOG_NEAR_M, FOG_FAR_M);
    // Lit faces get LIT_TINT and faces in shade get SHADOW_TINT (BRDF_Lambert divides by pi).
    this.sun = new THREE.DirectionalLight(
      linearColour([LIT_TINT[0] - SHADOW_TINT[0], LIT_TINT[1] - SHADOW_TINT[1], LIT_TINT[2] - SHADOW_TINT[2]]),
      Math.PI,
    );
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
    Object.assign(this.sun.shadow.camera, {
      left: -SHADOW_HALF_M,
      right: SHADOW_HALF_M,
      top: SHADOW_HALF_M,
      bottom: -SHADOW_HALF_M,
      near: 1,
      far: SUN_DISTANCE_M * 2,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    // A tight filter keeps shadow edges crisp, like painted shadows.
    this.sun.shadow.radius = 0.5;
    this.scene.add(this.sun, this.sun.target, new THREE.AmbientLight(linearColour(SHADOW_TINT), Math.PI));
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
    const buildingMaterial = this.facadeMaterial(built.architecture.facade);
    for (const chunk of built.buildings) {
      group.add(this.mesh(chunk, buildingMaterial, true));
    }
    group.add(...this.lines(built.buildingEdges, CONTOUR_WIDTH_PX));
    group.add(...this.lines(built.wires.length > 0 ? [built.wires] : [], WIRE_WIDTH_PX));
    GROUND_LAYERS.forEach((layer, index) => {
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
      const mesh = this.mesh(data, material, false);
      mesh.renderOrder = index;
      group.add(mesh);
    });
    group.add(...this.trees(built), ...this.poles(built), this.marker());
    if (built.streetSigns.length > 0) {
      const signPostMaterial = this.toonMaterial({ color: 0x8f999f });
      hideOutline(signPostMaterial);
      group.add(createStreetSigns(built, signPostMaterial));
    }
    this.content = group;
    this.scene.add(group);
    this.shadowCentre = undefined;
  }

  render(): void {
    this.followWithShadows();
    this.backdrop.follow(this.camera);
    this.renderer.clear();
    this.effect.render(this.backdrop.scene, this.backdrop.camera);
    this.renderer.clearDepth();
    this.effect.render(this.scene, this.camera);
  }

  setAnimationLoop(callback: ((time: number) => void) | null): void {
    this.renderer.setAnimationLoop(callback);
  }

  triangleCount(): number {
    return this.renderer.info.render.triangles;
  }

  /** Keeps the shadow-casting box around the walker, redrawing the shadow map only on a move. */
  private followWithShadows(): void {
    const { x, z } = this.camera.position;
    if (this.shadowCentre !== undefined && Math.hypot(x - this.shadowCentre.x, z - this.shadowCentre.y) < SHADOW_RECENTRE_M) {
      return;
    }
    this.shadowCentre = new THREE.Vector2(Math.round(x), Math.round(z));
    this.sun.target.position.set(this.shadowCentre.x, 0, this.shadowCentre.y);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE_M);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.lineMaterials.forEach((material) => material.resolution.set(width, height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private toonMaterial(parameters: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({
      gradientMap: this.gradient,
      emissive: linearColour(SHADE_LIFT),
      ...parameters,
    });
  }

  /**
   * Building faces: vertex colours plus windows, frames and roof trim drawn in the shader
   * from the facade attribute. Faces are pushed back a little so the contour lines on
   * their edges always win the depth test.
   */
  private facadeMaterial(facade: FacadeStyle): THREE.MeshToonMaterial {
    const material = this.toonMaterial({
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const uniforms = {
      glassColour: { value: linearColour(GLASS_COLOUR) },
      glassHighlight: { value: linearColour(GLASS_HIGHLIGHT_COLOUR) },
      frameColour: { value: linearColour(FRAME_COLOUR) },
      trimColour: { value: linearColour(TRIM_COLOUR) },
      inkColour: { value: new THREE.Color(INK_COLOUR) },
      storeyM: { value: facade.storeyM },
      sillM: { value: facade.sillM },
      headM: { value: facade.headM },
      halfWindowM: { value: facade.halfWindowM },
      frameM: { value: facade.frameM },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FACADE_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACADE_FRAGMENT_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_FRAGMENT}`);
    };
    material.customProgramCacheKey = () => 'geotoon-facade';
    return material;
  }

  private mesh(data: MeshData, material: THREE.Material, castShadow: boolean): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    if (data.facade !== undefined) {
      geometry.setAttribute('facade', new THREE.BufferAttribute(data.facade, 3));
    }
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Ink lines with a screen-space width, faded by the fog like the rest. */
  private lines(segments: readonly Float32Array[], widthPx: number): THREE.Object3D[] {
    if (segments.length === 0) {
      return [];
    }
    const material = new LineMaterial({ color: INK_COLOUR, linewidth: widthPx, worldUnits: false, fog: true });
    material.resolution.set(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight));
    hideOutline(material);
    this.lineMaterials.push(material);
    return segments.map((positions) => new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material));
  }

  /** Round, bushy crowns with an ink rim (an inverted hull, since OutlineEffect skips instances). */
  private trees(built: BuiltScene): THREE.Object3D[] {
    const { data, count } = built.trees;
    if (count === 0) {
      return [];
    }
    const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.24, 3, 6).translate(0, 1.5, 0);
    const crownGeometry = crown(1);
    const rimGeometry = crown(1.07);
    const trunks = new THREE.InstancedMesh(trunkGeometry, this.toonMaterial({ color: TRUNK_COLOUR }), count);
    const crowns = new THREE.InstancedMesh(crownGeometry, this.toonMaterial({ color: CROWN_COLOUR }), count);
    const rims = new THREE.InstancedMesh(
      rimGeometry,
      new THREE.MeshBasicMaterial({ color: INK_COLOUR, side: THREE.BackSide }),
      count,
    );
    for (const mesh of [trunks, crowns, rims]) {
      hideOutline(mesh.material);
    }
    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
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
      rims.setMatrixAt(i, matrix);
    }
    for (const mesh of [trunks, crowns, rims]) {
      mesh.computeBoundingSphere();
    }
    return [trunks, crowns, rims];
  }

  /** Concrete utility poles with a crossarm across the street. */
  private poles(built: BuiltScene): THREE.Object3D[] {
    const { data, count } = built.poles;
    if (count === 0) {
      return [];
    }
    const shaft = new THREE.CylinderGeometry(0.11, 0.16, POLE_HEIGHT_M, 8).translate(0, POLE_HEIGHT_M / 2, 0);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 1.8).translate(0, CROSSARM_Y_M, 0);
    const geometry = mergeGeometries([shaft, arm]);
    shaft.dispose();
    arm.dispose();
    const poles = new THREE.InstancedMesh(geometry, this.toonMaterial({ color: POLE_COLOUR }), count);
    hideOutline(poles.material);
    poles.castShadow = true;
    poles.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i += 1) {
      matrix.makeRotationAxis(up, -data[i * 3 + 2]!);
      matrix.setPosition(data[i * 3]!, 0, data[i * 3 + 1]!);
      poles.setMatrixAt(i, matrix);
    }
    poles.computeBoundingSphere();
    return [poles];
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
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.content.traverse((object) => {
      if (!isMesh(object)) {
        return;
      }
      const mesh = object;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        if ('map' in material && material.map instanceof THREE.Texture) {
          textures.add(material.map as THREE.Texture);
        }
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    this.lineMaterials = [];
    this.content = new THREE.Group();
  }
}

/** A crown of four overlapping spheres; `grow` scales it about its centre (for the ink rim). */
function crown(grow: number): THREE.BufferGeometry {
  const centre = new THREE.Vector3(0, 4.2, 0);
  const puffs = (
    [
      [0, 4.2, 0, 1.9],
      [1, 3.7, 0.45, 1.35],
      [-0.85, 3.8, -0.55, 1.45],
      [0.15, 5.1, -0.2, 1.35],
    ] as const
  ).map(([x, y, z, r]) => {
    const offset = new THREE.Vector3(x, y, z).sub(centre).multiplyScalar(grow).add(centre);
    return new THREE.IcosahedronGeometry(r * grow, 1).translate(offset.x, offset.y, offset.z);
  });
  const merged = mergeGeometries(puffs);
  puffs.forEach((puff) => puff.dispose());
  return merged;
}

/** A colour given directly in linear RGB (no sRGB decoding). */
function linearColour(rgb: Rgb): THREE.Color {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && object.isMesh === true;
}

function hideOutline(material: THREE.Material | THREE.Material[]): void {
  for (const each of Array.isArray(material) ? material : [material]) {
    (each.userData as OutlineUserData).outlineParameters = { visible: false };
  }
}

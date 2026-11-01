import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CLOUD_SHADE_COLOUR,
  MOUNTAIN_COLOUR,
  SKY_HORIZON_COLOUR,
  SKY_ZENITH_COLOUR,
} from '../scene/palette.js';

const SKY_RADIUS_M = 5000;
const CLOUD_COUNT = 18;
const CLOUD_SEED = 20_260_901;
const MOUNTAIN_SEGMENTS = 256;

type OutlineUserData = {
  outlineParameters?: { visible?: boolean; thickness?: number; color?: number[] };
};

/**
 * The sky, clouds and far hills. They are drawn first, from a camera that turns with the
 * walker but never moves, so they behave as if infinitely far away.
 */
export class Backdrop {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 1, SKY_RADIUS_M * 1.1);

  constructor(gradient: THREE.Texture, sunDirection: THREE.Vector3) {
    this.scene.add(sky());
    this.scene.add(hills(3200, 70, 150, 11, new THREE.Color(MOUNTAIN_COLOUR).lerp(new THREE.Color(SKY_HORIZON_COLOUR), 0.45)));
    this.scene.add(hills(2600, 35, 80, 23, new THREE.Color(MOUNTAIN_COLOUR)));
    this.scene.add(clouds(gradient));
    const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.75);
    sun.position.copy(sunDirection);
    const shade = new THREE.Color(CLOUD_SHADE_COLOUR);
    this.scene.add(sun, new THREE.AmbientLight(shade, Math.PI));
  }

  /** Copies the walker's view direction and lens. */
  follow(camera: THREE.PerspectiveCamera): void {
    this.camera.quaternion.copy(camera.quaternion);
    if (this.camera.aspect !== camera.aspect || this.camera.fov !== camera.fov) {
      this.camera.aspect = camera.aspect;
      this.camera.fov = camera.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

/** A dome with a cyan zenith fading to a pale horizon; below the horizon stays pale. */
function sky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(SKY_ZENITH_COLOUR) },
      horizon: { value: new THREE.Color(SKY_HORIZON_COLOUR) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      varying vec3 vDirection;
      void main() {
        float height = clamp(normalize(vDirection).y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, zenith, pow(height, 0.5)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  hideOutline(material);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS_M, 32, 16), material);
  dome.renderOrder = -2;
  return dome;
}

/** A ring of rolling hills on the horizon, hazy at the foot. */
function hills(distance: number, minHeight: number, maxHeight: number, seed: number, colour: THREE.Color): THREE.Mesh {
  const random = mulberry32(seed);
  const phases = [random(), random(), random()].map((r) => r * Math.PI * 2);
  const haze = new THREE.Color(SKY_HORIZON_COLOUR);
  const positions: number[] = [];
  const colours: number[] = [];
  const baseY = -60;
  const heightAt = (angle: number): number => {
    const wave =
      0.5 * Math.sin(angle * 3 + phases[0]!) + 0.3 * Math.sin(angle * 7 + phases[1]!) + 0.2 * Math.sin(angle * 17 + phases[2]!);
    return minHeight + ((wave + 1) / 2) * (maxHeight - minHeight);
  };
  for (let i = 0; i < MOUNTAIN_SEGMENTS; i += 1) {
    const a0 = (i / MOUNTAIN_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / MOUNTAIN_SEGMENTS) * Math.PI * 2;
    const [x0, z0, x1, z1] = [Math.cos(a0) * distance, Math.sin(a0) * distance, Math.cos(a1) * distance, Math.sin(a1) * distance];
    const [h0, h1] = [heightAt(a0), heightAt(a1)];
    positions.push(x0, baseY, z0, x1, h1, z1, x1, baseY, z1, x0, baseY, z0, x0, h0, z0, x1, h1, z1);
    for (const top of [false, true, false, false, true, true]) {
      const c = top ? colour : haze;
      colours.push(c.r, c.g, c.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  hideOutline(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  return mesh;
}

/** Puffy cumulus with flat bases: clusters of spheres, toon-shaded with a soft blue outline. */
function clouds(gradient: THREE.Texture): THREE.Mesh {
  const random = mulberry32(CLOUD_SEED);
  const puffs: THREE.BufferGeometry[] = [];
  for (let c = 0; c < CLOUD_COUNT; c += 1) {
    const azimuth = (c / CLOUD_COUNT) * Math.PI * 2 + random() * 0.3;
    const distance = 1500 + random() * 1300;
    const elevation = ((4 + random() * 22) * Math.PI) / 180;
    const size = 70 + random() * 110;
    const centre = new THREE.Vector3(
      Math.cos(azimuth) * distance,
      Math.tan(elevation) * distance,
      Math.sin(azimuth) * distance,
    );
    const across = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth));
    const count = 5 + Math.floor(random() * 5);
    const parts: THREE.BufferGeometry[] = [];
    for (let p = 0; p < count; p += 1) {
      const offset = (p / (count - 1) - 0.5) * size * 2.2;
      const radius = size * (0.45 + random() * 0.45) * (1 - Math.abs(offset) / (size * 2.4));
      const puff = new THREE.IcosahedronGeometry(radius, 2);
      puff.translate(across.x * offset, radius * 0.35 + random() * size * 0.25, across.z * offset + (random() - 0.5) * size * 0.4);
      parts.push(puff);
    }
    const cloud = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    flattenBase(cloud);
    cloud.translate(centre.x, centre.y, centre.z);
    puffs.push(cloud);
  }
  const geometry = mergeGeometries(puffs);
  puffs.forEach((puff) => puff.dispose());
  const material = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, fog: false });
  (material.userData as OutlineUserData).outlineParameters = {
    thickness: 0.0035,
    color: new THREE.Color(CLOUD_SHADE_COLOUR).multiplyScalar(0.7).toArray(),
  };
  return new THREE.Mesh(geometry, material);
}

/** Squashes everything below the cloud's base plane onto it, facing down. */
function flattenBase(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i += 1) {
    if (position.getY(i) < 0) {
      position.setY(i, 0);
      normal.setXYZ(i, 0, -1, 0);
    }
  }
}

/** Small deterministic PRNG, so the sky looks the same on every visit. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hideOutline(material: THREE.Material): void {
  (material.userData as OutlineUserData).outlineParameters = { visible: false };
}

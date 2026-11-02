import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DiurnalState } from '../scene/diurnal-cycle.js';
import { buildStars } from '../scene/stars.js';
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
  private readonly dome = sky();
  private readonly stars = stars();
  private readonly mountains: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  private readonly sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.75);
  private readonly ambient = new THREE.AmbientLight(CLOUD_SHADE_COLOUR, Math.PI);
  private readonly cloud: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;

  constructor(gradient: THREE.Texture) {
    this.mountains = [
      hills(3200, 70, 150, 11, new THREE.Color(MOUNTAIN_COLOUR).lerp(new THREE.Color(SKY_HORIZON_COLOUR), 0.45)),
      hills(2600, 35, 80, 23, new THREE.Color(MOUNTAIN_COLOUR)),
    ];
    this.cloud = clouds(gradient);
    this.scene.add(this.dome, this.stars, ...this.mountains, this.cloud, this.sun, this.ambient);
  }

  update(cycle: DiurnalState): void {
    (this.dome.material.uniforms['zenith']!.value as THREE.Color).setRGB(...cycle.skyZenith, THREE.LinearSRGBColorSpace);
    (this.dome.material.uniforms['horizon']!.value as THREE.Color).setRGB(...cycle.skyHorizon, THREE.LinearSRGBColorSpace);
    (this.dome.material.uniforms['sunDirection']!.value as THREE.Vector3).set(...cycle.sunDirection);
    (this.dome.material.uniforms['moonDirection']!.value as THREE.Vector3).set(...cycle.moonDirection);
    this.dome.material.uniforms['sunVisibility']!.value = cycle.sunVisibility;
    this.dome.material.uniforms['moonVisibility']!.value = cycle.moonVisibility;
    this.stars.material.uniforms['visibility']!.value = cycle.starVisibility;
    (this.stars.material.uniforms['moonDirection']!.value as THREE.Vector3).set(...cycle.moonDirection);
    this.stars.material.uniforms['moonVisibility']!.value = cycle.moonVisibility;
    this.sun.position.set(...cycle.sunDirection);
    this.sun.intensity = cycle.sunIntensity * 0.75;
    this.sun.color.setRGB(...cycle.sunColour, THREE.LinearSRGBColorSpace);
    this.ambient.color.setRGB(...cycle.ambientColour, THREE.LinearSRGBColorSpace);
    for (const mountain of this.mountains) {
      mountain.material.color.setRGB(...cycle.landscapeTint, THREE.LinearSRGBColorSpace);
    }
    const outline = this.cloud.material.userData as OutlineUserData;
    outline.outlineParameters!.color = cycle.skyHorizon.map((value) => value * 0.7);
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
function sky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(SKY_ZENITH_COLOUR) },
      horizon: { value: new THREE.Color(SKY_HORIZON_COLOUR) },
      sunDirection: { value: new THREE.Vector3() },
      moonDirection: { value: new THREE.Vector3() },
      sunVisibility: { value: 0 },
      moonVisibility: { value: 0 },
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
      uniform vec3 sunDirection;
      uniform vec3 moonDirection;
      uniform float sunVisibility;
      uniform float moonVisibility;
      varying vec3 vDirection;
      void main() {
        vec3 direction = normalize(vDirection);
        float height = clamp(direction.y, 0.0, 1.0);
        vec3 colour = mix(horizon, zenith, pow(height, 0.5));
        float sunDot = dot(direction, sunDirection);
        float sunDisc = smoothstep(cos(0.024), cos(0.021), sunDot) * sunVisibility;
        vec3 sunColour = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.93, 0.61), clamp(sunDirection.y * 3.0, 0.0, 1.0));
        colour += sunColour * pow(max(sunDot, 0.0), 600.0) * 0.2 * sunVisibility;
        colour = mix(colour, sunColour, sunDisc);
        float moonDot = dot(direction, moonDirection);
        float moonDisc = smoothstep(cos(0.026), cos(0.023), moonDot) * moonVisibility;
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), moonDirection));
        vec3 up = cross(moonDirection, right);
        vec2 moonUV = vec2(dot(direction, right), dot(direction, up)) / 0.024;
        float craters = (1.0 - smoothstep(0.15, 0.24, length(moonUV - vec2(-0.3, 0.25))))
          + (1.0 - smoothstep(0.1, 0.18, length(moonUV - vec2(0.35, -0.25))))
          + (1.0 - smoothstep(0.08, 0.15, length(moonUV - vec2(-0.1, -0.45))));
        vec3 moonColour = vec3(0.78, 0.85, 0.98) * (0.92 + 0.08 * moonUV.x - craters * 0.17);
        colour += vec3(0.3, 0.4, 0.65) * pow(max(moonDot, 0.0), 700.0) * 0.08 * moonVisibility;
        colour = mix(colour, moonColour, moonDisc);
        gl_FragColor = vec4(colour, 1.0);
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

/** Round star points sit behind clouds and hills; only their opacity changes with time. */
function stars(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const field = buildStars();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
  geometry.setAttribute('brightness', new THREE.BufferAttribute(field.brightness, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      visibility: { value: 0 },
      moonDirection: { value: new THREE.Vector3() },
      moonVisibility: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float brightness;
      uniform vec3 moonDirection;
      uniform float moonVisibility;
      varying float vBrightness;
      void main() {
        float covered = smoothstep(cos(0.028), cos(0.026), dot(normalize(position), moonDirection)) * moonVisibility;
        vBrightness = brightness * (1.0 - covered);
        gl_PointSize = 1.2 + brightness * 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float visibility;
      varying float vBrightness;
      void main() {
        float point = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(0.78, 0.86, 1.0), point * vBrightness * visibility);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

/** A ring of rolling hills on the horizon, hazy at the foot. */
function hills(distance: number, minHeight: number, maxHeight: number, seed: number, colour: THREE.Color): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
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
function clouds(gradient: THREE.Texture): THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial> {
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

import * as THREE from 'three';
import type { BuiltScene } from '../scene/scene-builder.js';
import {
  MAX_NEARBY_STREET_LIGHTS, STREET_LIGHT_HEIGHT_M, STREET_LIGHT_RANGE_M, STREET_LIGHT_REACH_M,
  type StreetLight, nearbyStreetLights, streetLightsFor,
} from '../scene/street-lights.js';

const LAMP_COLOUR = 0xffd28a;
const LAMP_INTENSITY = 12;

/** Instanced fixtures and a fixed pool of nearby lights keep city-wide lighting bounded. */
export class StreetLights {
  readonly group = new THREE.Group();
  private readonly lamps = new THREE.MeshToonMaterial({ color: 0x302b22, emissive: LAMP_COLOUR, emissiveIntensity: 0 });
  private readonly lights: THREE.PointLight[] = [];
  private readonly positions: readonly StreetLight[];
  private activeCount = 0;
  private lastPosition: THREE.Vector3 | undefined;

  constructor(built: BuiltScene, poleMaterial: THREE.Material) {
    this.positions = streetLightsFor(built);
    const height = STREET_LIGHT_HEIGHT_M;
    const reach = STREET_LIGHT_REACH_M;
    const count = built.poles.count;
    const fixtures = [
      new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, reach).translate(0, height, -reach / 2), poleMaterial, count),
      new THREE.InstancedMesh(new THREE.BoxGeometry(0.65, 0.22, 1).translate(0, height, -reach), poleMaterial, count),
      new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.75).translate(0, height - 0.13, -reach), this.lamps, count),
    ];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) {
      const x = built.poles.data[i * 3]!;
      const z = built.poles.data[i * 3 + 1]!;
      matrix.makeRotationY(-built.poles.data[i * 3 + 2]!);
      matrix.setPosition(x, built.terrain.heightAt(x, z), z);
      fixtures.forEach((mesh) => mesh.setMatrixAt(i, matrix));
    }
    for (const mesh of fixtures) {
      mesh.material.userData['outlineParameters'] = { visible: false };
      mesh.computeBoundingSphere();
    }
    this.group.add(...fixtures);
    for (let i = 0; i < Math.min(count, MAX_NEARBY_STREET_LIGHTS); i += 1) {
      const light = new THREE.PointLight(LAMP_COLOUR, 0, STREET_LIGHT_RANGE_M, 2);
      this.lights.push(light);
      this.group.add(light);
    }
  }

  update(nightLights: number, cameraPosition: THREE.Vector3): void {
    this.lamps.emissiveIntensity = nightLights * 1.8;
    if (this.lastPosition === undefined || this.lastPosition.distanceToSquared(cameraPosition) > 4) {
      this.lastPosition = cameraPosition.clone();
      const nearby = nearbyStreetLights(this.positions, cameraPosition.x, cameraPosition.y, cameraPosition.z);
      this.activeCount = nearby.length;
      this.lights.forEach((light, i) => {
        const position = nearby[i];
        if (position !== undefined) {
          light.position.set(position.x, position.y, position.z);
        }
      });
    }
    this.lights.forEach((light, i) => {
      light.intensity = i < this.activeCount ? nightLights * LAMP_INTENSITY : 0;
    });
  }
}

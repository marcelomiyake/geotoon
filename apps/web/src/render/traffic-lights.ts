import * as THREE from 'three';
import type { BuiltScene } from '../scene/scene-builder.js';
import { signalColour } from '../scene/traffic.js';

const LAMP_COLOURS = ['red', 'amber', 'green'] as const;
const LIT = [0xff3535, 0xffbf30, 0x25ef83];
const UNLIT = [0x40191b, 0x44351b, 0x133e2a];

/** Shared instanced poles, arms, heads and lamps: the number of draw calls stays bounded. */
export class TrafficLights {
  readonly group = new THREE.Group();
  private readonly lamps: THREE.InstancedMesh;
  private lastState = '';

  constructor(private readonly built: BuiltScene, poleMaterial: THREE.Material) {
    const count = built.trafficLights.length;
    const dark = new THREE.MeshToonMaterial({ color: 0x20252b });
    const lampMaterial = new THREE.MeshBasicMaterial();
    dark.userData['outlineParameters'] = { visible: false };
    lampMaterial.userData['outlineParameters'] = { visible: false };
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.1, 5.2, 8), poleMaterial, count);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 0.12), poleMaterial, count);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 1.2, 0.32), dark, count);
    this.lamps = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12).rotateX(Math.PI / 2), lampMaterial, count * 3,
    );
    const base = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    built.trafficLights.forEach((light, index) => {
      base.makeRotationY(Math.PI / 2 - light.angle);
      base.setPosition(light.x, built.terrain.heightAt(light.x, light.z), light.z);
      const place = (mesh: THREE.InstancedMesh, at: number, x: number, y: number, z: number, scaleX = 1): void => {
        local.makeScale(scaleX, 1, 1).setPosition(x, y, z);
        mesh.setMatrixAt(at, world.multiplyMatrices(base, local));
      };
      place(poles, index, 0, 2.6, 0);
      place(arms, index, -light.armM / 2, 5.1, 0, light.armM + 0.2);
      place(heads, index, -light.armM, 4.5, 0);
      LAMP_COLOURS.forEach((_, lamp) => place(this.lamps, index * 3 + lamp, -light.armM, 4.85 - lamp * 0.35, 0.18));
    });
    for (const mesh of [poles, arms, heads, this.lamps]) {
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.update(0);
  }

  update(seconds: number): void {
    const state = `${signalColour(0, seconds)}:${signalColour(1, seconds)}`;
    if (state === this.lastState) {
      return;
    }
    this.lastState = state;
    const colour = new THREE.Color();
    this.built.trafficLights.forEach((light, index) => {
      const active = signalColour(light.phase, seconds);
      LAMP_COLOURS.forEach((lamp, i) => {
        this.lamps.setColorAt(index * 3 + i, colour.setHex(lamp === active ? LIT[i]! : UNLIT[i]!));
      });
    });
    if (this.lamps.instanceColor !== null) {
      this.lamps.instanceColor.needsUpdate = true;
    }
  }
}

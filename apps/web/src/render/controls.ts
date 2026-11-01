import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { type CollisionIndex, clampToRadius } from '../scene/collision.js';
import { EYE_HEIGHT_M } from './renderer.js';

/** About 22 km/h: faster than a person, like a bicycle, so a 2 km area is quick to cross. */
export const WALK_SPEED_M_S = 6;
/** About 54 km/h with Shift: car speed on a city street. */
export const FAST_SPEED_M_S = 15;
export const TURN_SPEED_RAD_S = Math.PI / 2;
/** The walker stops this far inside the loaded radius. */
export const EDGE_MARGIN_M = 2;
const MAX_STEP_S = 0.05;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const FAST = new Set(['ShiftLeft', 'ShiftRight']);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface WalkArea {
  readonly terrain: { heightAt(x: number, z: number): number };
  readonly collision: CollisionIndex;
  readonly radiusM: number;
  readonly spawn: { readonly x: number; readonly z: number; readonly headingRad: number };
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** First-person walking: mouse look via pointer lock, keys by `KeyboardEvent.code`. */
export class WalkControls {
  readonly pointer: PointerLockControls;
  private readonly keys = new Set<string>();
  private area: WalkArea | undefined;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private readonly onEdge: () => void,
  ) {
    this.pointer = new PointerLockControls(camera, domElement);
    document.addEventListener('keydown', (event) => {
      if (!isTyping(event.target)) {
        this.keys.add(event.code);
      }
    });
    document.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.pointer.addEventListener('unlock', () => this.keys.clear());
  }

  get isLocked(): boolean {
    return this.pointer.isLocked;
  }

  lock(): void {
    this.pointer.lock();
  }

  /** Places the camera at the spawn point, facing the address (heading 0 = north). */
  reset(area: WalkArea): void {
    this.area = area;
    this.camera.position.set(area.spawn.x, area.terrain.heightAt(area.spawn.x, area.spawn.z) + EYE_HEIGHT_M, area.spawn.z);
    this.camera.rotation.set(0, -area.spawn.headingRad, 0, 'YXZ');
  }

  update(deltaSeconds: number): void {
    const area = this.area;
    if (area === undefined || !this.pointer.isLocked) {
      return;
    }
    const dt = Math.min(deltaSeconds, MAX_STEP_S);
    const turn = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
    if (turn !== 0) {
      this.camera.rotateOnWorldAxis(WORLD_UP, turn * TURN_SPEED_RAD_S * dt);
    }
    const ahead = axis(this.keys, FORWARD) - axis(this.keys, BACK);
    const side = axis(this.keys, RIGHT) - axis(this.keys, LEFT);
    if (ahead === 0 && side === 0) {
      return;
    }
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, WORLD_UP).normalize();
    const speed = [...FAST].some((code) => this.keys.has(code)) ? FAST_SPEED_M_S : WALK_SPEED_M_S;
    const length = Math.hypot(ahead, side);
    const step = (speed * dt) / length;
    const from = { x: this.camera.position.x, z: this.camera.position.z };
    const to = {
      x: from.x + (this.forward.x * ahead + this.right.x * side) * step,
      z: from.z + (this.forward.z * ahead + this.right.z * side) * step,
    };
    const moved = area.collision.move(from, to);
    const { point, clamped } = clampToRadius(moved, area.radiusM, EDGE_MARGIN_M);
    if (clamped) {
      this.onEdge();
    }
    this.camera.position.set(point.x, area.terrain.heightAt(point.x, point.z) + EYE_HEIGHT_M, point.z);
  }
}

function axis(keys: ReadonlySet<string>, codes: ReadonlySet<string>): number {
  for (const code of codes) {
    if (keys.has(code)) {
      return 1;
    }
  }
  return 0;
}

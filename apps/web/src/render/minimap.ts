import type { Scene } from '@geotoon/contracts';
import type { Point2 } from '../scene/collision.js';
import type { Vec2 } from '../scene/mesh-buffer.js';
import {
  MINIMAP_SCALE_M, MINIMAP_TEXTURE_SIZE, MINIMAP_VIEW_RADIUS_M,
  type MinimapData, type MinimapLayer, buildMinimap, minimapCrop, minimapHeading, minimapPoint,
} from '../scene/minimap.js';
import type { Projection } from '../scene/projection.js';

const COLOURS: Readonly<Record<MinimapLayer, string>> = {
  land: '#d4e6c2', green: '#43bd67', water: '#249ee8', road: '#fbfcff',
  path: '#ffc85f', rail: '#777cad', building: '#ec9968',
};
const UPDATE_MS = 50;

/** A single cached area image avoids a second WebGL scene or per-frame geometry work. */
export class Minimap {
  private readonly context: CanvasRenderingContext2D;
  private readonly map = document.createElement('canvas');
  private radiusM = 0;
  private address: Point2 = { x: 0, z: 0 };
  private lastDraw = Number.NEGATIVE_INFINITY;
  private lastPose: { x: number; z: number; heading: number; size: number; ratio: number } | undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')!;
  }

  setScene(scene: Scene, projection: Projection, radiusM: number, address?: Point2): void {
    this.radiusM = radiusM;
    this.address = address ?? { x: 0, z: 0 };
    this.map.width = MINIMAP_TEXTURE_SIZE;
    this.map.height = MINIMAP_TEXTURE_SIZE;
    paintMap(this.map.getContext('2d')!, buildMinimap(scene, projection, radiusM));
    this.lastPose = undefined;
    this.lastDraw = Number.NEGATIVE_INFINITY;
  }

  update(player: Point2, yawRad: number, timeMs: number): void {
    if (this.radiusM === 0 || timeMs - this.lastDraw < UPDATE_MS) {
      return;
    }
    const heading = minimapHeading(yawRad);
    const size = this.canvas.clientWidth;
    if (size === 0) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio, 2);
    const pose = { x: player.x, z: player.z, heading, size, ratio };
    const previous = this.lastPose;
    if (previous !== undefined && Math.hypot(player.x - previous.x, player.z - previous.z) < 0.05
      && Math.abs(heading - previous.heading) < 0.002 && size === previous.size && ratio === previous.ratio) {
      return;
    }
    this.lastPose = pose;
    this.lastDraw = timeMs;
    const pixels = Math.round(size * ratio);
    if (this.canvas.width !== pixels) {
      this.canvas.width = pixels;
      this.canvas.height = pixels;
    }
    const context = this.context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    context.save();
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = '#223b50';
    context.fillRect(0, 0, size, size);
    const crop = minimapCrop(player, this.radiusM);
    context.drawImage(this.map, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
    addressMarker(context, minimapPoint(this.address, player, size), size);
    playerMarker(context, size, heading);
    compassAndScale(context, size);
    context.restore();
  }
}

function paintMap(context: CanvasRenderingContext2D, data: MinimapData): void {
  const scale = MINIMAP_TEXTURE_SIZE / (data.radiusM * 2);
  context.setTransform(scale, 0, 0, scale, MINIMAP_TEXTURE_SIZE / 2, MINIMAP_TEXTURE_SIZE / 2);
  context.save();
  context.beginPath();
  context.arc(0, 0, data.radiusM, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = '#a5d98b';
  context.fillRect(-data.radiusM, -data.radiusM, data.radiusM * 2, data.radiusM * 2);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  for (const layer of ['land', 'green', 'water', 'road', 'path', 'rail', 'building'] as const) {
    for (const polygon of data.polygons.filter((polygon) => polygon.layer === layer)) {
      context.beginPath();
      polygon.rings.forEach((ring) => path(context, ring, true));
      context.fillStyle = COLOURS[layer];
      context.fill('evenodd');
      if (layer === 'building') {
        context.strokeStyle = '#b65f42';
        context.lineWidth = 1 / scale;
        context.stroke();
      }
    }
    for (const line of data.lines.filter((line) => line.layer === layer)) {
      context.beginPath();
      path(context, line.points, false);
      context.strokeStyle = '#8196a2';
      context.lineWidth = Math.max(line.widthM, 2) + 2;
      context.stroke();
      context.strokeStyle = COLOURS[layer];
      context.lineWidth = Math.max(line.widthM, 2);
      context.stroke();
    }
  }
  context.beginPath();
  context.arc(0, 0, data.radiusM - 2 / scale, 0, Math.PI * 2);
  context.setLineDash([8 / scale, 5 / scale]);
  context.strokeStyle = '#b7f3ff';
  context.lineWidth = 2 / scale;
  context.stroke();
  context.restore();
}

function path(context: CanvasRenderingContext2D, points: readonly Vec2[], closed: boolean): void {
  points.forEach(([x, z], index) => index === 0 ? context.moveTo(x, z) : context.lineTo(x, z));
  if (closed) {
    context.closePath();
  }
}

function playerMarker(context: CanvasRenderingContext2D, size: number, heading: number): void {
  context.save();
  context.translate(size / 2, size / 2);
  context.rotate(heading);
  const cone = context.createRadialGradient(0, 0, 0, 0, 0, size * 0.32);
  cone.addColorStop(0, 'rgb(255 235 116 / 36%)');
  cone.addColorStop(1, 'rgb(255 235 116 / 0%)');
  context.fillStyle = cone;
  context.beginPath();
  context.moveTo(0, 0);
  context.arc(0, 0, size * 0.32, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(0, -11);
  context.lineTo(7, 8);
  context.lineTo(0, 4);
  context.lineTo(-7, 8);
  context.closePath();
  context.lineJoin = 'round';
  context.strokeStyle = '#ffffff';
  context.lineWidth = 5;
  context.stroke();
  context.strokeStyle = '#163045';
  context.lineWidth = 2.5;
  context.stroke();
  context.fillStyle = '#ffe05d';
  context.fill();
  context.restore();
}

function addressMarker(context: CanvasRenderingContext2D, point: Point2, size: number): void {
  if (Math.hypot(point.x - size / 2, point.z - size / 2) > size * 0.43) {
    return;
  }
  context.beginPath();
  context.arc(point.x, point.z, 4, 0, Math.PI * 2);
  context.fillStyle = '#f23e8e';
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.fill();
  context.stroke();
}

function compassAndScale(context: CanvasRenderingContext2D, size: number): void {
  context.textAlign = 'center';
  context.font = 'bold 13px system-ui, sans-serif';
  context.lineWidth = 3;
  context.strokeStyle = '#193448';
  context.fillStyle = '#f4fbff';
  context.strokeText('N', size / 2, 18);
  context.fillText('N', size / 2, 18);
  const length = MINIMAP_SCALE_M / (MINIMAP_VIEW_RADIUS_M * 2) * size;
  context.fillStyle = 'rgb(20 43 62 / 82%)';
  context.fillRect(size / 2 - length / 2 - 6, size - 35, length + 12, 28);
  context.fillStyle = '#f4fbff';
  context.fillRect(size / 2 - length / 2, size - 16, length, 2);
  context.font = '11px system-ui, sans-serif';
  context.fillText(`${MINIMAP_SCALE_M} m`, size / 2, size - 21);
}

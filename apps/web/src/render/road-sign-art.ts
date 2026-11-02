import { ROAD_SIGN_KINDS, roadSignOutline, type RoadSignKind } from '../scene/road-signs.js';

export const ROAD_SIGN_CELL_PX = 192;
export const ROAD_SIGN_COLUMNS = 4;
export const ROAD_SIGN_ROWS = Math.ceil(ROAD_SIGN_KINDS.length / ROAD_SIGN_COLUMNS);

/** Original vector drawings based on the owner's Brazilian traffic-sign reference sheet. */
export function roadSignAtlas(brazil: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ROAD_SIGN_CELL_PX * ROAD_SIGN_COLUMNS;
  canvas.height = ROAD_SIGN_CELL_PX * ROAD_SIGN_ROWS;
  const context = canvas.getContext('2d')!;
  ROAD_SIGN_KINDS.forEach((kind, index) => {
    context.save();
    context.translate(index % ROAD_SIGN_COLUMNS * ROAD_SIGN_CELL_PX, Math.floor(index / ROAD_SIGN_COLUMNS) * ROAD_SIGN_CELL_PX);
    context.scale(ROAD_SIGN_CELL_PX / 128, ROAD_SIGN_CELL_PX / 128);
    drawFace(context, kind, brazil);
    context.restore();
  });
  return canvas;
}

function outline(context: CanvasRenderingContext2D, kind: RoadSignKind): void {
  context.beginPath();
  roadSignOutline(kind).forEach(([x, y], index) => {
    if (index === 0) context.moveTo(3 + x * 122, 3 + y * 122);
    else context.lineTo(3 + x * 122, 3 + y * 122);
  });
  context.closePath();
}

function drawFace(context: CanvasRenderingContext2D, kind: RoadSignKind, brazil: boolean): void {
  outline(context, kind);
  context.fillStyle = kind === 'stop' || kind === 'yield' ? '#ec1728' : '#ffdf00';
  context.fill();
  context.strokeStyle = kind === 'stop' ? '#ffffff' : '#171b20';
  context.lineWidth = 2.5;
  context.stroke();
  if (kind === 'stop') {
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = 'bold 31px Arial, sans-serif';
    context.fillText(brazil ? 'PARE' : 'STOP', 64, 66);
  } else if (kind === 'yield') {
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(25, 23); context.lineTo(103, 23); context.lineTo(64, 99);
    context.closePath(); context.fill();
  } else if (kind === 'hospital') {
    hospital(context);
  } else {
    context.translate(64, 64);
    context.scale(0.8, 0.8);
    context.translate(-64, -64);
    warningSymbol(context, kind);
  }
}

const SYMBOLS: Partial<Record<RoadSignKind, string>> = {
  'curve-left': 'M76 102V68Q76 39 46 39V23L20 45L46 66V51Q63 51 63 70V102Z',
  crossroads: 'M57 26H71V57H102V71H71V102H57V71H26V57H57Z',
  't-junction': 'M27 33H101V48H72V101H56V48H27Z',
  'junction-left': 'M57 25H71V102H57V72H27V58H57Z',
  'y-junction': 'M56 103V70L29 43L40 32L64 56L88 32L99 43L72 70V103Z',
};

function warningSymbol(context: CanvasRenderingContext2D, kind: RoadSignKind): void {
  context.fillStyle = '#11151a';
  context.strokeStyle = '#11151a';
  if (kind === 'curve-right' || kind === 'junction-right') {
    context.translate(128, 0); context.scale(-1, 1);
    context.fill(new Path2D(SYMBOLS[kind === 'curve-right' ? 'curve-left' : 'junction-left']));
  } else if (SYMBOLS[kind] !== undefined) {
    context.fill(new Path2D(SYMBOLS[kind]));
  } else if (kind === 'signals-ahead') {
    context.fillRect(51, 25, 26, 78);
    for (const [i, colour] of ['#ef233c', '#ffdd26', '#24bf64'].entries()) {
      context.fillStyle = colour;
      context.beginPath(); context.arc(64, 39 + i * 25, 8, 0, Math.PI * 2); context.fill();
    }
  } else {
    person(context, kind === 'school' ? 53 : 64, 33, 1);
    if (kind === 'school') person(context, 79, 48, 0.68);
    else {
      context.fillRect(33, 91, 20, 5); context.fillRect(59, 91, 20, 5); context.fillRect(85, 91, 10, 5);
    }
  }
}

function person(context: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  context.save();
  context.translate(x, y); context.scale(scale, scale);
  context.beginPath(); context.arc(0, 0, 7, 0, Math.PI * 2); context.fill();
  context.lineWidth = 7; context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(-1, 13); context.lineTo(-7, 32); context.lineTo(-20, 49);
  context.moveTo(-7, 32); context.lineTo(12, 39); context.lineTo(19, 51);
  context.moveTo(-1, 13); context.lineTo(9, 24); context.lineTo(21, 25);
  context.moveTo(-1, 13); context.lineTo(-13, 22); context.lineTo(-23, 23);
  context.stroke(); context.restore();
}

function hospital(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#2c4caa';
  context.fillRect(15, 3, 98, 122);
  context.strokeStyle = '#ffffff'; context.lineWidth = 2;
  context.strokeRect(19, 7, 90, 114);
  context.fillStyle = '#ffffff'; context.fillRect(29, 18, 70, 69);
  context.fillStyle = '#e62632';
  context.fillRect(55, 27, 18, 50); context.fillRect(39, 43, 50, 18);
}

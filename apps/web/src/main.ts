import './styles.css';
import { ApiClient } from './api/client.js';
import { WalkControls } from './render/controls.js';
import { SceneRenderer } from './render/renderer.js';
import { buildScene, type BuiltScene } from './scene/scene-builder.js';
import { Overlays, areaErrorMessage } from './ui/overlays.js';
import { SearchBox, type PickedPlace } from './ui/search-box.js';
import { areaSearchParams, readUrlState } from './ui/search-logic.js';
import { initialPlace } from './ui/initial-place.js';

interface DebugState {
  requestId: string;
  tiles: string;
  sourceCalls: number;
  built?: BuiltScene;
  frameMs: number;
}

const overlays = new Overlays();
const api = new ApiClient();
const urlState = readUrlState(window.location.search);
const debug: DebugState = { requestId: '-', tiles: '-', sourceCalls: 0, frameMs: 0 };
let view: { renderer: SceneRenderer; controls: WalkControls } | undefined;
let loadController: AbortController | undefined;
let lastPlace: PickedPlace | undefined;

function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function isTouchOnly(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function ensureView(): { renderer: SceneRenderer; controls: WalkControls } {
  if (view) {
    return view;
  }
  const renderer = new SceneRenderer(overlays.canvasHost, () => {
    overlays.showError('The graphics context was lost.', 'Reload the page to continue.');
  });
  const controls = new WalkControls(renderer.camera, renderer.domElement, () => overlays.showEdgeNotice());
  controls.pointer.addEventListener('lock', () => overlays.show('walking'));
  controls.pointer.addEventListener('unlock', () => {
    if (overlays.root.dataset['screen'] === 'walking') {
      overlays.show('paused');
    }
  });
  let last = performance.now();
  let lastDebug = 0;
  renderer.setAnimationLoop((time) => {
    const dt = (time - last) / 1000;
    last = time;
    debug.frameMs = debug.frameMs * 0.9 + dt * 1000 * 0.1;
    controls.update(dt);
    renderer.render();
    if (urlState.debug && time - lastDebug > 500) {
      lastDebug = time;
      updateDebug(renderer);
    }
  });
  view = { renderer, controls };
  return view;
}

function updateDebug(renderer: SceneRenderer): void {
  const built = debug.built;
  const camera = renderer.camera.position;
  const [lon, lat] = built ? built.projection.toGeo(camera.x, camera.z) : [0, 0];
  overlays.setDebug({
    requestId: debug.requestId,
    tiles: debug.tiles,
    sourceCalls: debug.sourceCalls,
    buildings: built?.stats.buildings ?? 0,
    lines: built?.stats.lines ?? 0,
    areas: built?.stats.areas ?? 0,
    trees: built?.stats.trees ?? 0,
    sceneTriangles: built?.stats.triangles ?? 0,
    drawnTriangles: renderer.triangleCount(),
    buildMs: built?.stats.buildMs ?? 0,
    frameMs: debug.frameMs.toFixed(1),
    camera: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
  });
  // Debug-only hooks so smoke checks can inspect and aim the camera without pointer lock.
  (window as unknown as { geotoon?: unknown }).geotoon = {
    stats: built?.stats,
    requestId: debug.requestId,
    sourceCalls: debug.sourceCalls,
    frameMs: debug.frameMs,
    look: (headingDeg: number, pitchDeg = 0) =>
      renderer.camera.rotation.set((pitchDeg * Math.PI) / 180, (-headingDeg * Math.PI) / 180, 0, 'YXZ'),
    moveTo: (x: number, y: number, z: number) => renderer.camera.position.set(x, y, z),
    renderer,
    terrain: built?.terrain,
  };
}

async function openArea(place: PickedPlace): Promise<void> {
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  lastPlace = place;
  overlays.setPlace(place.label);
  const params = areaSearchParams(place, urlState.debug);
  window.history.replaceState(null, '', `?${params.toString()}`);
  overlays.showLoading(undefined, place.label);
  try {
    const ready = await api.loadArea(
      place.lat,
      place.lon,
      (progress) => {
        debug.requestId = progress.requestId;
        debug.tiles = `${progress.completeTiles}/${progress.totalTiles}`;
        overlays.showLoading(progress, place.label);
      },
      controller.signal,
    );
    if (controller.signal.aborted) {
      return;
    }
    debug.requestId = ready.requestId;
    debug.sourceCalls = ready.sourceCalls;
    debug.tiles = `${ready.tiles.filter((t) => t.state === 'complete').length}/${ready.tiles.length}`;
    overlays.showBuilding();
    await nextFrame();
    const built = buildScene(ready.scene, { ...ready.area, ...(place.locality ? { locality: place.locality } : {}) });
    debug.built = built;
    if (built.stats.buildings === 0 && built.stats.lines === 0) {
      overlays.showError('No map data found around this point.', 'Try an address in a built-up area.');
      return;
    }
    const { renderer, controls } = ensureView();
    renderer.setScene(built);
    controls.reset(built);
    overlays.setAttribution(ready.scene.attribution);
    overlays.show('ready');
    document.body.dataset['sceneReady'] = 'true';
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    const { message, detail } = areaErrorMessage(error);
    overlays.showError(message, detail);
  }
}

function start(): void {
  overlays.debugPanel.hidden = !urlState.debug;
  if (!hasWebGL2()) {
    overlays.showError('This browser cannot show 3D graphics (WebGL2 is unavailable).', 'Try a current desktop browser.');
    return;
  }
  if (isTouchOnly()) {
    overlays.showError('GeoToon needs a keyboard and a mouse.', 'Open it on a desktop or laptop computer.');
    return;
  }
  const search = new SearchBox({
    input: overlays.searchInput,
    list: overlays.searchList,
    status: overlays.searchStatus,
    suggest: (query, signal) => api.suggest(query, signal),
    onPick: (place) => void openArea(place),
  });
  const backToSearch = (): void => {
    loadController?.abort();
    overlays.show('search');
    search.focus();
  };
  overlays.onClick('walk-button', () => view?.controls.lock());
  overlays.onClick('resume-button', () => view?.controls.lock());
  overlays.onClick('new-address-button', backToSearch);
  overlays.onClick('ready-new-address-button', backToSearch);
  overlays.onClick('error-back-button', backToSearch);
  overlays.onClick('loading-cancel-button', backToSearch);
  overlays.onClick('retry-button', () => {
    if (lastPlace) {
      void openArea(lastPlace);
    }
  });
  void openArea(initialPlace(urlState.point));
}

start();

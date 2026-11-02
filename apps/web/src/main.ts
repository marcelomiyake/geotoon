import './styles.css';
import { ApiClient, ApiProblem } from './api/client.js';
import { WalkControls } from './render/controls.js';
import { SceneRenderer } from './render/renderer.js';
import { Minimap } from './render/minimap.js';
import type { BuiltScene } from './scene/scene-builder.js';
import { buildSceneInWorker } from './render/scene-loader.js';
import {
  STREAM_RETRY_MS, areaAhead, canEnterArea, sampleMovement, shouldRetarget, type AreaTarget, type MovementSample,
} from './scene/area-streaming.js';
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
const minimap = new Minimap(document.getElementById('minimap-canvas') as HTMLCanvasElement);
const api = new ApiClient();
const urlState = readUrlState(window.location.search);
const debug: DebugState = { requestId: '-', tiles: '-', sourceCalls: 0, frameMs: 0 };
let view: { renderer: SceneRenderer; controls: WalkControls } | undefined;
let loadController: AbortController | undefined;
let lastPlace: PickedPlace | undefined;
let stream: { controller: AbortController; target: AreaTarget; started: number } | undefined;
let streamRetryAt = 0;
let walkMovement: MovementSample | undefined;

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
  const controls = new WalkControls(renderer.camera, renderer.domElement, () => {
    if (stream !== undefined || performance.now() < streamRetryAt) overlays.setStreamStatus('Waiting for nearby streets to finish loading…');
    else overlays.showEdgeNotice();
  });
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
    const screen = overlays.root.dataset['screen'];
    if (screen === 'ready' || screen === 'walking' || screen === 'paused') {
      minimap.update(renderer.camera.position, renderer.camera.rotation.y, time);
    }
    if (screen === 'walking') maybeStream(renderer, time);
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
    roadSigns: built?.stats.roadSigns ?? 0,
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
    controls: view?.controls,
    minimap,
    terrain: built?.terrain,
    projection: built?.projection,
  };
}

async function openArea(place: PickedPlace): Promise<void> {
  stream?.controller.abort();
  stream = undefined;
  streamRetryAt = 0;
  walkMovement = undefined;
  overlays.setStreamStatus();
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
    const built = await buildSceneInWorker(ready.scene, { ...ready.area,
      ...(place.locality ? { locality: place.locality } : {}), address: place }, controller.signal);
    controller.signal.throwIfAborted();
    debug.built = built;
    if (built.stats.buildings === 0 && built.stats.lines === 0) {
      overlays.showError('No map data found around this point.', 'Try an address in a built-up area.');
      return;
    }
    const { renderer, controls } = ensureView();
    renderer.setScene(built);
    controls.reset(built);
    minimap.setScene(ready.scene, built.projection, built.radiusM, built.address);
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

function maybeStream(renderer: SceneRenderer, time: number): void {
  const built = debug.built;
  if (built === undefined || lastPlace === undefined) return;
  const position = { x: renderer.camera.position.x, z: renderer.camera.position.z };
  walkMovement = sampleMovement(position, walkMovement);
  const target = areaAhead(position, walkMovement.movement, built.radiusM, built.projection);
  if (target === undefined || time < streamRetryAt) return;
  if (stream !== undefined) {
    if (time - stream.started < 10_000 || !shouldRetarget(stream.target, target, built.projection, built.radiusM)) return;
    stream.controller.abort();
  }
  const controller = new AbortController();
  stream = { controller, target, started: time };
  void loadAhead(target, controller, lastPlace);
}

async function loadAhead(target: AreaTarget, controller: AbortController, place: PickedPlace): Promise<void> {
  overlays.setStreamStatus('Loading streets ahead…');
  try {
    const ready = await api.loadArea(target.lat, target.lon, (progress) => {
      if (!controller.signal.aborted) overlays.setStreamStatus(`Loading streets ahead… ${progress.completeTiles}/${progress.totalTiles} tiles`);
    }, controller.signal);
    controller.signal.throwIfAborted();
    overlays.setStreamStatus('Preparing streets ahead…');
    const built = await buildSceneInWorker(ready.scene, { ...ready.area, address: place,
      ...(place.locality ? { locality: place.locality } : {}) }, controller.signal);
    controller.signal.throwIfAborted();
    const current = debug.built;
    if (view === undefined || current === undefined) return;
    const [lon, lat] = current.projection.toGeo(view.renderer.camera.position.x, view.renderer.camera.position.z);
    if (!canEnterArea({ lat, lon }, built.projection, built.radiusM)) return;
    const [x, z] = built.projection.toLocal(lon, lat);
    view.renderer.setScene(built);
    view.controls.replaceArea(built, { x, z });
    minimap.setScene(ready.scene, built.projection, built.radiusM, built.address);
    overlays.setAttribution(ready.scene.attribution);
    debug.built = built;
    debug.requestId = ready.requestId;
    debug.sourceCalls = ready.sourceCalls;
    debug.tiles = `${ready.tiles.length}/${ready.tiles.length}`;
    walkMovement = undefined;
    overlays.setStreamStatus();
  } catch (error) {
    if (!controller.signal.aborted) {
      const retryMs = error instanceof ApiProblem ? (error.retryAfterSeconds ?? 0) * 1000 : 0;
      streamRetryAt = performance.now() + Math.max(STREAM_RETRY_MS, retryMs);
      overlays.setStreamStatus('Could not load streets ahead. Retrying shortly…');
    }
  } finally {
    if (stream?.controller === controller) {
      stream = undefined;
      if (performance.now() >= streamRetryAt) overlays.setStreamStatus();
    }
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
    stream?.controller.abort();
    stream = undefined;
    overlays.setStreamStatus();
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

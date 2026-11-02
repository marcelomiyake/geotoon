import type { Scene } from '@geotoon/contracts';
import type { BuiltScene, SceneArea } from '../scene/scene-builder.js';
import { unpackScene } from '../scene/scene-transfer.js';
import type { SceneBuildReply, SceneBuildRequest } from './scene-worker.js';

/** Cancelled searches terminate their worker; scene construction never stalls walking. */
export function buildSceneInWorker(scene: Scene, area: SceneArea, signal: AbortSignal): Promise<BuiltScene> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./scene-worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = (): void => { cleanup(); reject(signal.reason as Error); };
    signal.addEventListener('abort', abort, { once: true });
    worker.addEventListener('error', (event) => { cleanup(); reject(new Error(event.message)); });
    worker.addEventListener('message', (event: MessageEvent<SceneBuildReply>) => {
      cleanup();
      if ('error' in event.data) reject(new Error(event.data.error));
      else resolve(unpackScene(event.data.built));
    });
    worker.postMessage({ scene, area } satisfies SceneBuildRequest);
  });
}

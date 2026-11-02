import type { Scene } from '@geotoon/contracts';
import { buildScene, type SceneArea } from '../scene/scene-builder.js';
import { packScene, sceneBuffers, type SceneTransfer } from '../scene/scene-transfer.js';

export interface SceneBuildRequest { readonly scene: Scene; readonly area: SceneArea }
export type SceneBuildReply = { readonly built: SceneTransfer } | { readonly error: string };

self.addEventListener('message', (event: MessageEvent<SceneBuildRequest>) => {
  // Dedicated-worker messages normally have an empty origin; accept only our parent origin otherwise.
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  try {
    const built = packScene(buildScene(event.data.scene, event.data.area));
    self.postMessage({ built } satisfies SceneBuildReply, { transfer: sceneBuffers(built) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies SceneBuildReply);
  }
});

import type { Attribution } from '@geotoon/contracts';
import { ApiProblem, type AreaProgress } from '../api/client.js';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} in index.html`);
  }
  return element as T;
}

export type Screen = 'search' | 'loading' | 'ready' | 'walking' | 'paused' | 'error';

/** All DOM overlays; one screen is visible at a time, plus the corner widgets. */
export class Overlays {
  readonly root = byId<HTMLElement>('app');
  readonly searchInput = byId<HTMLInputElement>('search-input');
  readonly searchList = byId<HTMLUListElement>('search-list');
  readonly searchStatus = byId<HTMLElement>('search-status');
  readonly canvasHost = byId<HTMLElement>('canvas-host');
  private readonly loadingText = byId<HTMLElement>('loading-text');
  private readonly loadingDetail = byId<HTMLElement>('loading-detail');
  private readonly loadingBar = byId<HTMLProgressElement>('loading-bar');
  private readonly errorText = byId<HTMLElement>('error-text');
  private readonly errorDetail = byId<HTMLElement>('error-detail');
  private readonly edgeNotice = byId<HTMLElement>('edge-notice');
  private readonly cornerAttribution = byId<HTMLElement>('corner-attribution');
  private readonly attributionLists = document.querySelectorAll<HTMLElement>('.attribution-list');
  private readonly placeLabel = byId<HTMLElement>('place-label');
  readonly debugPanel = byId<HTMLElement>('debug-panel');
  private edgeTimer: ReturnType<typeof setTimeout> | undefined;

  show(screen: Screen): void {
    this.root.dataset['screen'] = screen;
  }

  onClick(id: string, handler: () => void): void {
    byId(id).addEventListener('click', handler);
  }

  setPlace(label: string): void {
    this.placeLabel.textContent = label;
  }

  showLoading(progress: AreaProgress | undefined, label: string): void {
    this.show('loading');
    if (progress === undefined) {
      this.loadingText.textContent = `Loading ${label}…`;
      this.loadingDetail.textContent = 'Checking stored map data.';
      this.loadingBar.removeAttribute('value');
      return;
    }
    const seconds = Math.round(progress.elapsedMs / 1000);
    this.loadingText.textContent = `Fetching open map data for ${label}…`;
    this.loadingDetail.textContent =
      `${progress.completeTiles} of ${progress.totalTiles} tiles stored · ${seconds} s. ` +
      'The first visit to an area downloads Overture Maps data; later visits load from storage.';
    this.loadingBar.max = progress.totalTiles;
    this.loadingBar.value = progress.completeTiles;
  }

  showBuilding(): void {
    this.loadingText.textContent = 'Building the 3D scene…';
    this.loadingDetail.textContent = '';
  }

  showError(message: string, detail = ''): void {
    this.errorText.textContent = message;
    this.errorDetail.textContent = detail;
    this.show('error');
  }

  showEdgeNotice(): void {
    this.edgeNotice.hidden = false;
    clearTimeout(this.edgeTimer);
    this.edgeTimer = setTimeout(() => {
      this.edgeNotice.hidden = true;
    }, 2500);
  }

  setAttribution(credits: readonly Attribution[]): void {
    this.cornerAttribution.textContent = credits.map((c) => c.text).join(' · ');
    for (const list of this.attributionLists) {
      list.replaceChildren(
        ...credits.map((credit) => {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = credit.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = credit.text;
          item.append(link);
          return item;
        }),
      );
    }
  }

  setDebug(lines: Readonly<Record<string, string | number>>): void {
    this.debugPanel.textContent = Object.entries(lines)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }
}

/** User-facing text for an area failure, with the request ID when there is one. */
export function areaErrorMessage(error: unknown): { message: string; detail: string } {
  if (error instanceof ApiProblem) {
    const reference = error.requestId ? `Request ID ${error.requestId}.` : '';
    const retry = error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds} s.` : '';
    switch (error.code) {
      case 'AREA_FETCH_FAILED':
      case 'OVERTURE_UNAVAILABLE':
        return { message: 'The open map data could not be downloaded.', detail: `${reference}${retry}` };
      case 'OVERTURE_RELEASE_NOT_FOUND':
        return { message: 'The configured map data release is no longer available.', detail: reference };
      case 'RATE_LIMITED':
        return { message: 'Too many area requests.', detail: `${reference}${retry}` };
      case 'INVALID_COORDINATES':
        return { message: 'Those coordinates are not valid.', detail: reference };
      case 'NETWORK':
        return { message: 'The GeoToon server could not be reached.', detail: 'Check that the app is running.' };
      default:
        return { message: error.message, detail: reference };
    }
  }
  return { message: 'Something went wrong while loading the area.', detail: String(error) };
}

import type { Suggestion } from '@geotoon/contracts';
import { ApiProblem } from '../api/client.js';
import { DEBOUNCE_MS, debounce, nextIndex, parseLatLon, shouldSearch } from './search-logic.js';

export interface PickedPlace {
  readonly lat: number;
  readonly lon: number;
  readonly label: string;
}

export interface SearchBoxOptions {
  readonly input: HTMLInputElement;
  readonly list: HTMLUListElement;
  readonly status: HTMLElement;
  readonly suggest: (query: string, signal: AbortSignal) => Promise<Suggestion[]>;
  readonly onPick: (place: PickedPlace) => void;
}

/** ARIA combobox: debounced lookups, one request in flight, arrow keys, Enter and Esc. */
export class SearchBox {
  private suggestions: Suggestion[] = [];
  private active = -1;
  private controller: AbortController | undefined;
  private readonly lookup = debounce((query: string) => {
    void this.fetchSuggestions(query);
  }, DEBOUNCE_MS);

  constructor(private readonly options: SearchBoxOptions) {
    const { input, list } = options;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    list.setAttribute('role', 'listbox');
    input.addEventListener('input', () => this.onInput());
    input.addEventListener('keydown', (event) => this.onKey(event));
    list.addEventListener('mousedown', (event) => event.preventDefault());
  }

  focus(): void {
    this.options.input.focus();
    this.options.input.select();
  }

  private onInput(): void {
    const query = this.options.input.value;
    this.controller?.abort();
    if (parseLatLon(query)) {
      this.render([]);
      this.setStatus('Press Enter to open these coordinates.');
      return;
    }
    if (!shouldSearch(query)) {
      this.lookup.cancel();
      this.render([]);
      this.setStatus('');
      return;
    }
    this.lookup(query);
  }

  private async fetchSuggestions(query: string): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus('Searching…');
    try {
      const suggestions = await this.options.suggest(query, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      this.render(suggestions);
      this.setStatus(suggestionStatus(suggestions.length));
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      this.render([]);
      this.setStatus(searchErrorMessage(error));
    }
  }

  private onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.setActive(nextIndex(this.active, this.suggestions.length, event.key));
        break;
      case 'Enter':
        event.preventDefault();
        this.pickCurrent();
        break;
      case 'Escape':
        this.render([]);
        break;
      default:
        break;
    }
  }

  private pickCurrent(): void {
    const coordinates = parseLatLon(this.options.input.value);
    if (coordinates) {
      this.options.onPick({ ...coordinates, label: `${coordinates.lat}, ${coordinates.lon}` });
      return;
    }
    const chosen = this.suggestions[this.active >= 0 ? this.active : 0];
    if (chosen) {
      this.pick(chosen);
    }
  }

  private pick(suggestion: Suggestion): void {
    this.options.input.value = suggestion.label;
    this.render([]);
    this.options.onPick({ lat: suggestion.lat, lon: suggestion.lon, label: suggestion.label });
  }

  private setActive(index: number): void {
    this.active = index;
    const items = this.options.list.querySelectorAll('li');
    items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    const activeItem = items[index];
    if (activeItem) {
      this.options.input.setAttribute('aria-activedescendant', activeItem.id);
    } else {
      this.options.input.removeAttribute('aria-activedescendant');
    }
  }

  private render(suggestions: Suggestion[]): void {
    this.suggestions = suggestions;
    this.active = -1;
    const { list, input } = this.options;
    list.replaceChildren(
      ...suggestions.map((suggestion, index) => {
        const item = document.createElement('li');
        item.id = `${list.id}-option-${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.textContent = suggestion.label;
        item.addEventListener('click', () => this.pick(suggestion));
        return item;
      }),
    );
    input.setAttribute('aria-expanded', String(suggestions.length > 0));
    input.removeAttribute('aria-activedescendant');
  }

  private setStatus(text: string): void {
    this.options.status.textContent = text;
  }
}

function suggestionStatus(count: number): string {
  if (count === 0) {
    return 'No address found. Add the city, or paste coordinates as "lat, lon".';
  }
  return count === 1 ? '1 suggestion.' : `${count} suggestions.`;
}

export function searchErrorMessage(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'GEOCODER_RATE_LIMITED':
      case 'RATE_LIMITED':
        return 'Too many searches. Wait a few seconds and type again.';
      case 'GEOCODER_UNAVAILABLE':
        return 'Address search is unavailable. You can paste coordinates as "lat, lon".';
      default:
        return `Search failed: ${error.message}`;
    }
  }
  return 'Search failed. Check the connection and try again.';
}

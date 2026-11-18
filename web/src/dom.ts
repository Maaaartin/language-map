interface PageElements {
  search: HTMLInputElement;
  'start-search': HTMLInputElement;
  threshold: HTMLInputElement;
  levels: HTMLInputElement;
  grouping: HTMLSelectElement;
  'group-languages': HTMLInputElement;
  'map-search': HTMLInputElement;
  'map-level': HTMLSelectElement;
  'geography-link': HTMLAnchorElement;
  'graph-link': HTMLAnchorElement;
  'fit-locations': HTMLButtonElement;
}

export function byId<K extends keyof PageElements>(id: K): PageElements[K];
export function byId(id: string): HTMLElement;
export function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing page element: ${id}`);
  return element;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string | number, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

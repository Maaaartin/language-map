import type * as D3 from 'd3';
import type * as Leaflet from 'leaflet';

declare global {
  interface Window {
    d3: typeof D3;
    L: typeof Leaflet;
  }
}

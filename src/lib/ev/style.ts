/**
 * Map colours for the EV page. MapLibre paint can't read CSS variables, so these mirror the
 * tokens: the distance field is one warm hue (--color-series-2) getting stronger with distance,
 * chargers are the accent (fast) and tertiary text grey (ac only).
 */

const warm = (a: number) => `rgba(204, 117, 80, ${a})`;

/** Gradient: every land cell, in 10 km bins up to 40 km+. Near a charger shows the map. */
export const GRADIENT = [warm(0), warm(0.12), warm(0.34), warm(0.62), warm(0.9)];
export const GRADIENT_STEP = 10;

/** Blackspots: only land beyond the threshold, by how far beyond it (3.5 km bins). */
export const BLACKSPOT = [warm(0.5), warm(0.66), warm(0.82), warm(0.95)];
export const BLACKSPOT_STEP = 3.5;

export const FAST = '#36b6e9';
export const AC_ONLY = '#7a7a84';
/** Ring on 24h sites; the map ink ring separates the rest from each other. */
export const RING_24H = '#e6e6ea';
export const RING = '#0a0a0d';

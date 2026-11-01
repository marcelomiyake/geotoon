export interface Attribution {
  readonly text: string;
  readonly url: string;
}

// Wording from https://docs.overturemaps.org/attribution/ (checked 2026-11-01).
const OSM: Attribution = {
  text: '© OpenStreetMap contributors. Available under the Open Database License.',
  url: 'https://www.openstreetmap.org/copyright',
};
const OVERTURE: Attribution = {
  text: 'Overture Maps Foundation',
  url: 'https://overturemaps.org',
};
const DATASET_CREDITS: Readonly<Record<string, Attribution>> = {
  'Google Open Buildings': {
    text: 'Google Open Buildings (CC BY 4.0)',
    url: 'https://sites.research.google/gr/open-buildings/',
  },
  'Microsoft ML Buildings': {
    text: 'Licensed by Microsoft under the Open Database License.',
    url: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
  },
  'Esri Community Maps': {
    text: 'Esri Community Maps contributors (CC BY 4.0)',
    url: 'https://communitymaps.arcgis.com',
  },
};

/** OSM and Overture are always credited; other building sources only when present. */
export function attributionFor(datasets: Iterable<string>): Attribution[] {
  const credits: Attribution[] = [OSM, OVERTURE];
  for (const dataset of new Set(datasets)) {
    const credit = DATASET_CREDITS[dataset];
    if (credit) {
      credits.push(credit);
    }
  }
  return credits;
}

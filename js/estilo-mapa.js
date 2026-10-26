// Descarga el estilo Liberty de OpenFreeMap y lo recolorea con la paleta de Halloween.
// Se hace en tiempo de ejecución para no copiar el estilo al repo.

const COLOR = {
  fondo: '#1E1838',
  agua: '#15112E',
  superficie: '#221B45',
  edificio: '#3A3170',
  edificioBorde: '#5E5498',
  caminoZona: '#A397D8',
  avenida: '#5E5498',
  secundario: '#3B3366',
  etiqueta: '#D9D1F5',
  halo: '#1E1838',
  iglesia: '#FFDDA6',
};

// Capas que no aportan al mapa: fondo satelital, fronteras, países/ciudades, aeropuertos, etc.
const OCULTAS = new RegExp(
  [
    '^natural_earth$',
    '^boundary_',
    '^label_(country|state|city|town)',
    '^aeroway_',
    '_hatching$',
    '^road_one_way_arrow',
    '^building-3d$',
    '^highway-shield-us-interstate$',
    '^highway-shield-non-us$',
    '^road_shield_us$',
    '^airport$',
    '^poi_transit$',
    '^water_name_point_label$',
  ].join('|'),
);

// Clases de POI que sí se muestran (iglesias, para la Parroquia de referencia).
const CLASES_IGLESIA = ['religious', 'place_of_worship'];

const AVENIDA = /(motorway|trunk|primary|secondary|tertiary)/;

function esLinea(capa) {
  return capa.type === 'line';
}

function recolorarCapa(capa) {
  const id = capa.id;
  capa.paint = capa.paint ?? {};
  capa.layout = capa.layout ?? {};

  if (id === 'background') {
    capa.paint['background-color'] = COLOR.fondo;
    return capa;
  }

  if (capa.type === 'fill') {
    if (id === 'building') {
      capa.paint['fill-color'] = COLOR.edificio;
      capa.paint['fill-outline-color'] = COLOR.edificioBorde;
    } else if (id === 'water' || capa['source-layer'] === 'water') {
      capa.paint['fill-color'] = COLOR.agua;
    } else {
      capa.paint['fill-color'] = COLOR.superficie;
      delete capa.paint['fill-pattern'];
    }
    return capa;
  }

  if (esLinea(capa)) {
    if (id.endsWith('_casing')) {
      capa.paint['line-color'] = COLOR.halo;
    } else if (capa['source-layer'] === 'waterway') {
      capa.paint['line-color'] = COLOR.agua;
    } else if (capa['source-layer'] === 'transportation') {
      capa.paint['line-color'] = AVENIDA.test(id) ? COLOR.avenida : COLOR.caminoZona;
    } else {
      capa.paint['line-color'] = COLOR.secundario;
    }
    return capa;
  }

  if (capa.type === 'symbol' && capa.layout['text-field']) {
    capa.paint['text-color'] = COLOR.etiqueta;
    capa.paint['text-halo-color'] = COLOR.halo;
    capa.paint['text-halo-width'] = 1.5;
    delete capa.paint['icon-color'];
  }

  return capa;
}

function filtrarPOI(capa) {
  if (capa['source-layer'] !== 'poi') return capa;
  const soloIglesias = ['match', ['get', 'class'], CLASES_IGLESIA, true, false];
  capa.filter = capa.filter ? ['all', capa.filter, soloIglesias] : soloIglesias;
  capa.paint['text-color'] = COLOR.iglesia;
  return capa;
}

export function recolorarEstilo(estilo) {
  estilo.layers = estilo.layers
    .filter((capa) => !OCULTAS.test(capa.id))
    .map((capa) => recolorarCapa(filtrarPOI(capa)));
  return estilo;
}

export async function cargarEstilo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar el estilo (${res.status})`);
  return recolorarEstilo(await res.json());
}

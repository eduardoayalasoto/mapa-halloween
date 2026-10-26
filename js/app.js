import { cargarEstilo } from './estilo-mapa.js';

const MAPLIBRE_URL = 'https://unpkg.com/maplibre-gl@6.13.0/dist/maplibre-gl.mjs';
const ESTILO_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MARGEN = 0.004; // grados de margen alrededor de la zona para maxBounds

const $ = (selector) => document.querySelector(selector);

let mapa = null;
let maplibre = null;

async function cargarJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// Aplana cualquier geometría en una lista de posiciones [lng, lat].
const aPosiciones = (a) => (typeof a[0] === 'number' ? [a] : a.flatMap(aPosiciones));

function cajaDe(geometria) {
  const pts = aPosiciones(geometria.coordinates);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function contornosDe(geometria) {
  return geometria.type === 'Polygon'
    ? [geometria.coordinates[0]]
    : geometria.coordinates.map((poligono) => poligono[0]);
}

// Máscara: todo el mundo oscurecido, con la zona como hueco.
function mascaraDe(zona) {
  const mundo = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [mundo, ...contornosDe(zona.features[0].geometry)] },
  };
}

// Solo las casas con ubicación confirmada van al mapa.
function geojsonDeCasas(casas) {
  return {
    type: 'FeatureCollection',
    features: casas.filter(tieneUbicacion).map((casa) => ({
      type: 'Feature',
      properties: { calle: casa.calle, numero: casa.numero, referencia: casa.referencia ?? '' },
      geometry: { type: 'Point', coordinates: [casa.lng, casa.lat] },
    })),
  };
}

const tieneUbicacion = (casa) => casa.lat !== null && casa.lng !== null;

// Orden de la lista: ignora "P.º", "Pl.", "de la", "de" y "del" al ordenar.
const PREFIJOS = /^(p\.º|pl\.)\s*|^(de la|de|del)\s+/i;
function claveCalle(nombre) {
  let clave = nombre.trim();
  let anterior;
  do {
    anterior = clave;
    clave = clave.replace(PREFIJOS, '');
  } while (clave !== anterior);
  return clave;
}

function agruparPorCalle(casas) {
  const grupos = new Map();
  for (const casa of casas) {
    if (!grupos.has(casa.calle)) grupos.set(casa.calle, []);
    grupos.get(casa.calle).push(casa);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => claveCalle(a).localeCompare(claveCalle(b), 'es', { sensitivity: 'base' }))
    .map(([calle, lista]) => [
      calle,
      lista.sort((x, y) => x.numero.localeCompare(y.numero, 'es', { numeric: true })),
    ]);
}

// En la página se muestra "Paseo" en vez de "P.º".
const nombreVisible = (calle) => calle.replace(/^P\.º\s*/, "Paseo ");

function textoContador(total) {
  return total === 1 ? '🎃 1 casa da dulces' : `🎃 ${total} casas dan dulces`;
}

function renderLista(casas) {
  $('#contador').textContent = textoContador(casas.length);
  const lista = $('#lista');
  lista.replaceChildren(
    ...agruparPorCalle(casas).map(([calle, casasDeCalle]) => {
      const seccion = document.createElement('section');
      seccion.className = 'calle';

      const titulo = document.createElement('h3');
      titulo.textContent = nombreVisible(calle);

      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(...casasDeCalle.map(crearChip));

      seccion.append(titulo, chips);
      return seccion;
    }),
  );
}

function crearChip(casa) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.append(casa.numero);

  if (!tieneUbicacion(casa)) {
    chip.disabled = true;
    chip.classList.add('chip--pendiente');
    const marca = document.createElement('small');
    marca.textContent = 'por ubicar';
    chip.append(marca);
    chip.setAttribute('aria-label', `${nombreVisible(casa.calle)} ${casa.numero}, por ubicar`);
  } else {
    chip.setAttribute('aria-label', `Ver ${nombreVisible(casa.calle)} ${casa.numero} en el mapa`);
    chip.addEventListener('click', () => irACasa(casa));
  }
  return chip;
}

function contenidoPopup(casa) {
  const div = document.createElement('div');
  const direccion = document.createElement('div');
  direccion.className = 'popup-direccion';
  direccion.textContent = `${nombreVisible(casa.calle)} ${casa.numero}`;
  div.append(direccion);
  if (casa.referencia) {
    const ref = document.createElement('div');
    ref.className = 'popup-ref';
    ref.textContent = casa.referencia;
    div.append(ref);
  }
  return div;
}

function abrirPopup(casa) {
  new maplibre.Popup({ offset: 16, maxWidth: '260px' })
    .setLngLat([casa.lng, casa.lat])
    .setDOMContent(contenidoPopup(casa))
    .addTo(mapa);
}

function irACasa(casa) {
  if (!mapa) return;
  mapa.flyTo({ center: [casa.lng, casa.lat], zoom: Math.max(mapa.getZoom(), 18), essential: true });
  mapa.once('moveend', () => abrirPopup(casa));
}

// Encuadra todas las casas ubicadas y sube al mapa (en celular, el mapa queda arriba de la lista).
function verTodas(casas) {
  const ubicadas = casas.filter(tieneUbicacion);
  if (!mapa || ubicadas.length === 0) return;
  const lngs = ubicadas.map((c) => c.lng);
  const lats = ubicadas.map((c) => c.lat);
  mapa.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 50, maxZoom: 18, duration: 800 },
  );
  $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mostrarErrorMapa() {
  const aviso = document.createElement('div');
  aviso.className = 'mapa-error';
  aviso.textContent = 'No pudimos cargar el mapa. Revisa tu conexión y recarga la página.';
  $('#mapa').replaceChildren(aviso);
}

function cargarCalabaza() {
  return new Promise((resolver, rechazar) => {
    const img = new Image(96, 96);
    img.onload = () => {
      mapa.addImage('calabaza', img);
      resolver();
    };
    img.onerror = () => rechazar(new Error('No se pudo cargar img/calabaza.svg'));
    img.src = 'img/calabaza.svg';
  });
}

function agregarCapas(zona, casas, primeraEtiqueta) {
  mapa.addSource('zona', { type: 'geojson', data: zona });
  mapa.addSource('mascara', { type: 'geojson', data: mascaraDe(zona) });
  mapa.addLayer(
    { id: 'mascara', type: 'fill', source: 'mascara', paint: { 'fill-color': '#1E1838', 'fill-opacity': 0.7 } },
    primeraEtiqueta,
  );
  mapa.addLayer(
    {
      id: 'zona-borde',
      type: 'line',
      source: 'zona',
      paint: { 'line-color': '#F7A21B', 'line-width': 2, 'line-dasharray': [2, 2] },
    },
    primeraEtiqueta,
  );

  mapa.addSource('casas', {
    type: 'geojson',
    data: geojsonDeCasas(casas),
    cluster: true,
    clusterMaxZoom: 16,
    clusterRadius: 20,
  });
  mapa.addLayer({
    id: 'casas-cluster',
    type: 'circle',
    source: 'casas',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#F7A21B',
      'circle-radius': ['step', ['get', 'point_count'], 18, 5, 22, 10, 26],
      'circle-stroke-color': '#1E1838',
      'circle-stroke-width': 2,
    },
  });
  mapa.addLayer({
    id: 'casas-cluster-n',
    type: 'symbol',
    source: 'casas',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 14,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#1E1838' },
  });
  mapa.addLayer({
    id: 'casas-halo',
    type: 'circle',
    source: 'casas',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#F7A21B',
      'circle-opacity': 0.35,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 12, 19, 20],
    },
  });
  mapa.addLayer({
    id: 'casas-calabaza',
    type: 'symbol',
    source: 'casas',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': 'calabaza',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.2, 19, 0.34],
      'icon-allow-overlap': true,
    },
  });
}

function conectarInteraccion() {
  mapa.on('click', 'casas-cluster', async (e) => {
    const [cluster] = mapa.queryRenderedFeatures(e.point, { layers: ['casas-cluster'] });
    const zoom = await mapa.getSource('casas').getClusterExpansionZoom(cluster.properties.cluster_id);
    mapa.easeTo({ center: cluster.geometry.coordinates, zoom });
  });

  mapa.on('click', 'casas-calabaza', (e) => {
    const [feature] = e.features;
    const [lng, lat] = feature.geometry.coordinates;
    new maplibre.Popup({ offset: 16, maxWidth: '260px' })
      .setLngLat([lng, lat])
      .setDOMContent(contenidoPopup(feature.properties))
      .addTo(mapa);
  });

  for (const capa of ['casas-cluster', 'casas-calabaza']) {
    mapa.on('mouseenter', capa, () => (mapa.getCanvas().style.cursor = 'pointer'));
    mapa.on('mouseleave', capa, () => (mapa.getCanvas().style.cursor = ''));
  }
}

function crearMapa(estilo, zona) {
  const [oeste, sur, este, norte] = cajaDe(zona.features[0].geometry);
  mapa = new maplibre.Map({
    container: 'mapa',
    style: estilo,
    bounds: [[oeste, sur], [este, norte]],
    fitBoundsOptions: { padding: 16 },
    pitch: 0,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxZoom: 19,
    maxBounds: [[oeste - MARGEN, sur - MARGEN], [este + MARGEN, norte + MARGEN]],
    attributionControl: { compact: true },
  });
  mapa.touchZoomRotate.disableRotation();
  mapa.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

  // Zoom mínimo: que la zona completa quepa en la pantalla.
  const ajuste = mapa.cameraForBounds([[oeste, sur], [este, norte]], { padding: 16 });
  if (ajuste) mapa.setMinZoom(ajuste.zoom);

  mapa.getCanvas().setAttribute('role', 'img');
  mapa.getCanvas().setAttribute('aria-label', 'Mapa de La Alteña. Las casas también están en la lista de abajo.');
  return mapa;
}

async function iniciarMapa(zona, casas) {
  maplibre = await import(MAPLIBRE_URL);
  const estilo = await cargarEstilo(ESTILO_URL);
  crearMapa(estilo, zona);
  mapa.once('load', async () => {
    try {
      await cargarCalabaza();
      const primeraEtiqueta = estilo.layers.find((capa) => capa.type === 'symbol')?.id;
      agregarCapas(zona, casas, primeraEtiqueta);
      conectarInteraccion();
    } catch (error) {
      console.error(error);
      mostrarErrorMapa();
    }
  });
}

async function iniciar() {
  let zona;
  let datos;
  try {
    [zona, datos] = await Promise.all([cargarJSON('data/zona.geojson'), cargarJSON('data/casas.json')]);
  } catch (error) {
    console.error(error);
    $('#contador').textContent = 'No pudimos cargar la lista de casas.';
    return;
  }

  renderLista(datos.casas);
  $('#ver-todas').addEventListener('click', () => verTodas(datos.casas));

  try {
    await iniciarMapa(zona, datos.casas);
  } catch (error) {
    console.error(error);
    mostrarErrorMapa();
  }
}

iniciar();

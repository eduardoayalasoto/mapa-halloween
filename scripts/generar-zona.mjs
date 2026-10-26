// Genera data/zona.geojson: la franja de La Alteña alrededor de las calles de la zona.
// Solo se corre en tu compu (no en la página). Requiere Node 20+ y `npm install`.
//
// Uso:
//   npm run zona
//   npm run zona -- --overpass-json ruta/al/archivo.json   (si Overpass no responde)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import buffer from '@turf/buffer';
import union from '@turf/union';
import simplify from '@turf/simplify';
import { lineIntersect } from '@turf/line-intersect';
import { featureCollection, lineString } from '@turf/helpers';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'data', 'zona.geojson');
const RADIO_METROS = 35;
const MARGEN_GRADOS = 0.003; // ~330 m alrededor de La Alteña para no cortar calles

// Grupos de calles tal como aparecen en Google Maps. Cada regex se prueba contra
// el nombre de la vía en OSM (sin importar mayúsculas). Si OSM usa otro nombre,
// el script lo marca como "sin coincidencias" y puedes ajustar la regex aquí.
const CALLES = {
  'P.º de la Alteña': /alte[nñ]a/i,
  'P.º San Agustín': /(san|s\.)\s*agust[ií]n/i,
  'De Loreto': /loreto/i,
  'Pl. del Carmen': /carmen/i,
  'P.º de la Paz': /\bpaz\b/i,
  'P.º San Jacinto': /(san|s\.)\s*jacinto/i,
};

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const cabeceras = { 'User-Agent': 'mapa-halloween-la-alteña/1.0 (generador de zona local)' };

function leerArgumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : null;
}

async function buscarArea() {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', 'La Alteña, Naucalpan de Juárez');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const res = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
  const [lugar] = await res.json();
  if (!lugar) throw new Error('Nominatim no encontró "La Alteña, Naucalpan de Juárez"');
  // boundingbox viene como [sur, norte, oeste, este]
  const [sur, norte, oeste, este] = lugar.boundingbox.map(Number);
  console.log(`Área: ${lugar.display_name}`);
  return {
    sur: sur - MARGEN_GRADOS,
    norte: norte + MARGEN_GRADOS,
    oeste: oeste - MARGEN_GRADOS,
    este: este + MARGEN_GRADOS,
  };
}

async function consultarOverpass(area) {
  const { sur, oeste, norte, este } = area;
  // Patrón simple para Overpass; el filtro fino por calle lo hace agruparVias().
  const consulta = `
[out:json][timeout:90];
way["name"~"alte[nñ]a|san agust|loreto|carmen|paz|san jacinto",i]["highway"](${sur},${oeste},${norte},${este});
out geom;`;

  // Se guarda para poder pegarla en overpass-turbo.eu si ningún servidor responde.
  await writeFile(path.join(RAIZ, 'scripts', 'consulta-overpass.txt'), consulta.trim() + '\n');

  for (const url of OVERPASS_URLS) {
    try {
      console.log(`Overpass: ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...cabeceras, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: consulta }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn(`  falló: ${error.message}`);
    }
  }
  throw new Error(
    'Ningún servidor de Overpass respondió. Pega scripts/consulta-overpass.txt en overpass-turbo.eu, ' +
      'exporta el resultado como JSON y corre: npm run zona -- --overpass-json archivo.json',
  );
}

// Acepta el JSON crudo de Overpass (elements) o el GeoJSON que exporta overpass-turbo (features).
function viasDesdeRespuesta(respuesta) {
  if (respuesta.features) {
    return respuesta.features
      .filter((f) => f.geometry?.type === 'LineString' && f.properties?.name)
      .map((f) => ({ id: f.id, nombreOSM: f.properties.name, coords: f.geometry.coordinates }));
  }
  return (respuesta.elements ?? [])
    .filter((v) => v.type === 'way' && v.geometry && v.tags?.name)
    .map((v) => ({
      id: v.id,
      nombreOSM: v.tags.name,
      coords: v.geometry.map((p) => [p.lon, p.lat]),
    }));
}

function agruparVias(respuesta) {
  const grupos = Object.fromEntries(Object.keys(CALLES).map((nombre) => [nombre, []]));
  for (const vía of viasDesdeRespuesta(respuesta)) {
    for (const [nombre, regex] of Object.entries(CALLES)) {
      if (regex.test(vía.nombreOSM)) {
        grupos[nombre].push(vía);
        break;
      }
    }
  }
  return grupos;
}

function construirZona(grupos) {
  const poligonos = [];
  for (const [nombre, vías] of Object.entries(grupos)) {
    if (vías.length === 0) {
      console.warn(`⚠ Sin coincidencias para "${nombre}". Revisa su regex en CALLES.`);
      continue;
    }
    console.log(`✔ ${nombre}: ${vías.length} vía(s) (${[...new Set(vías.map((v) => v.nombreOSM))].join(', ')})`);
    for (const vía of vías) {
      if (vía.coords.length < 2) continue;
      const linea = lineString(vía.coords);
      poligonos.push(buffer(linea, RADIO_METROS, { units: 'meters', steps: 16 }));
    }
  }
  if (poligonos.length === 0) throw new Error('No se encontró ninguna vía. Revisa el área y los nombres.');

  const unidos = union(featureCollection(poligonos));
  // Simplificar un poco para que el archivo pese poco en celular; la forma se conserva.
  const suavizado = simplify(unidos, { tolerance: 0.000003, highQuality: true });
  suavizado.properties = { nombre: 'Zona La Alteña' };
  return featureCollection([suavizado]);
}

function imprimirInterseccionAlteña59(grupos) {
  const alteña = grupos['P.º de la Alteña'].map((v) => lineString(v.coords));
  const loreto = grupos['De Loreto'].map((v) => lineString(v.coords));
  if (!alteña.length || !loreto.length) {
    console.warn('⚠ No hay Alteña o De Loreto para calcular la esquina del número 59.');
    return;
  }
  const puntos = [];
  for (const a of alteña) {
    for (const l of loreto) {
      puntos.push(...lineIntersect(a, l).features);
    }
  }
  if (puntos.length === 0) {
    console.warn('⚠ Alteña y De Loreto no se cruzan en los datos de OSM.');
    return;
  }
  console.log('\nIntersección Alteña × De Loreto (candidatos para Alteña 59):');
  for (const p of puntos) {
    const [lng, lat] = p.geometry.coordinates;
    console.log(`  lat: ${lat.toFixed(7)}  lng: ${lng.toFixed(7)}`);
  }
  console.log('Si hay varios, usa el más cercano a la esquina en el mapa. Pega el valor en data/casas.json.');
}

async function main() {
  const archivoLocal = leerArgumento('--overpass-json');
  const area = archivoLocal ? null : await buscarArea();
  const respuesta = archivoLocal
    ? JSON.parse(await readFile(archivoLocal, 'utf8'))
    : await consultarOverpass(area);

  const grupos = agruparVias(respuesta);
  const zona = construirZona(grupos);
  await mkdir(path.dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(zona, null, 2) + '\n');
  console.log(`\nListo: ${path.relative(RAIZ, SALIDA)}`);
  imprimirInterseccionAlteña59(grupos);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});

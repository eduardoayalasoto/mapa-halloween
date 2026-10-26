// Revisa data/casas.json antes de publicar. Sin dependencias: solo Node 20+.
//
// Uso:
//   npm run validar
//
// Revisa: campos permitidos (sin nombres ni teléfonos), ids únicos, calles conocidas,
// números, coordenadas dentro de la zona y casas repetidas.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Calles de la zona, como se muestran en el sitio.
const CALLES = [
  "P.º de la Alteña",
  'P.º de la Paz',
  'P.º San Agustín',
  'P.º San Jacinto',
  'De Loreto',
  'Pl. del Carmen',
];

const CAMPOS = ['id', 'calle', 'numero', 'lat', 'lng', 'referencia'];

// Ray casting: ¿el punto cae dentro del contorno exterior del polígono?
function dentroDelPoligono([lng, lat], geometria) {
  const contornos =
    geometria.type === 'Polygon'
      ? [geometria.coordinates[0]]
      : geometria.coordinates.map((poligono) => poligono[0]);
  return contornos.some((anillo) => {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      const cruza = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (cruza) dentro = !dentro;
    }
    return dentro;
  });
}

async function leerJSON(ruta) {
  return JSON.parse(await readFile(path.join(RAIZ, ruta), 'utf8'));
}

async function main() {
  const errores = [];
  const avisos = [];

  const datos = await leerJSON('data/casas.json');
  const zona = (await leerJSON('data/zona.geojson')).features[0].geometry;

  if (!Array.isArray(datos.casas)) {
    console.error('✖ casas.json: falta el arreglo "casas".');
    process.exit(1);
  }

  const ids = new Set();
  const llaves = new Set();

  datos.casas.forEach((casa, indice) => {
    const etiqueta = `casa #${indice + 1} (${casa.id ?? 'sin id'})`;

    for (const clave of Object.keys(casa)) {
      if (!CAMPOS.includes(clave)) {
        errores.push(`${etiqueta}: campo no permitido "${clave}". Solo se guarda calle y número.`);
      }
    }

    if (!casa.id) errores.push(`${etiqueta}: falta "id".`);
    else if (ids.has(casa.id)) errores.push(`${etiqueta}: id repetido.`);
    ids.add(casa.id);

    if (!CALLES.includes(casa.calle)) {
      errores.push(`${etiqueta}: calle "${casa.calle}" no está en la lista de calles de la zona.`);
    }

    if (typeof casa.numero !== 'string' || !/^\d+[A-Za-z]?$/.test(casa.numero)) {
      errores.push(`${etiqueta}: "numero" debe ser texto con dígitos, por ejemplo "59" o "12B".`);
    }

    const llave = `${casa.calle}|${casa.numero}`;
    if (llaves.has(llave)) errores.push(`${etiqueta}: ${casa.calle} ${casa.numero} está repetida.`);
    llaves.add(llave);

    const tieneLat = casa.lat !== null;
    const tieneLng = casa.lng !== null;
    if (tieneLat !== tieneLng) {
      errores.push(`${etiqueta}: "lat" y "lng" deben estar los dos en null o los dos con número.`);
    } else if (!tieneLat) {
      avisos.push(`${etiqueta}: por ubicar.`);
    } else {
      if (typeof casa.lat !== 'number' || typeof casa.lng !== 'number') {
        errores.push(`${etiqueta}: "lat" y "lng" deben ser números.`);
      } else if (!dentroDelPoligono([casa.lng, casa.lat], zona)) {
        errores.push(`${etiqueta}: la ubicación está fuera de la zona. Revisa lat/lng.`);
      }
    }

    if (typeof casa.referencia !== 'string') {
      errores.push(`${etiqueta}: "referencia" debe ser texto (puede ser "").`);
    }
  });

  const ubicadas = datos.casas.filter((c) => c.lat !== null).length;
  console.log(`Casas: ${datos.casas.length} (${ubicadas} ubicadas, ${datos.casas.length - ubicadas} por ubicar)`);
  for (const aviso of avisos) console.log(`• ${aviso}`);

  if (errores.length > 0) {
    console.error(`\n✖ ${errores.length} error(es):`);
    for (const error of errores) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('✔ casas.json está bien.');
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

/** La validación de la subida de un style pack (PR 7 de #241): el criterio que
 *  comparten el título y `ai_server/routers/styles.py`, con los casos que hasta
 *  hoy solo existían escritos en Python (y sin un solo test).
 *
 *  Cada caso escribe el MOTIVO además del veredicto: el motivo es lo que lee el
 *  jugador y lo que devuelve el 422, así que un mutante que cambie una plantilla
 *  rompe el «mismo texto por los dos caminos», que es la mitad del sentido de
 *  este módulo. Y los límites van al filo (min-1 / min / max / max+1) porque un
 *  `<=` por `<` solo se ve ahí. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CARPETA_LAMINA,
  MOTIVOS_DE_SUBIDA,
  REGLAS_DE_SUBIDA,
  refDeImagen,
  SubidaDeEstiloSchema,
  validarSubidaDeEstilo,
  type SubidaCruda,
} from "../src/contracts/style-upload.js";
import { STYLE_REF_FOLDERS } from "../src/games/style-refs.js";

const B64 = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const cara = (description = "una fachada de piedra"): SubidaCruda["images"][number] => ({
  folder: "faces",
  description,
  image_b64: B64,
});
const lamina = (): SubidaCruda["images"][number] => ({
  folder: CARPETA_LAMINA,
  description: "",
  image_b64: B64,
});
const subida = (parche: Partial<SubidaCruda> = {}): SubidaCruda => ({
  name: "Tinta y pergamino",
  tags: ["medieval"],
  images: [cara()],
  ...parche,
});
const largo = (n: number): string => "a".repeat(n);

describe("validarSubidaDeEstilo · lo que pasa", () => {
  it("el caso mínimo: nombre, una etiqueta y una imagen con descripción", () => {
    const res = validarSubidaDeEstilo(subida());
    assert.equal(res.ok, true);
  });

  it("la lámina de materiales es la ÚNICA que puede ir sin descripción", () => {
    assert.equal(validarSubidaDeEstilo(subida({ images: [lamina()] })).ok, true);
    assert.equal(validarSubidaDeEstilo(subida({ images: [cara("")] })).ok, false);
  });

  it("normaliza lo que sale: recorta el nombre y las descripciones y tira las etiquetas vacías", () => {
    const res = validarSubidaDeEstilo(
      subida({
        name: "  Tinta y pergamino  ",
        tags: ["  medieval  ", "", "   ", "oscuro"],
        images: [{ folder: "faces", description: "  una fachada  ", image_b64: B64 }],
      }),
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.subida.name, "Tinta y pergamino");
    assert.deepEqual(res.subida.tags, ["medieval", "oscuro"]);
    assert.equal(res.subida.images[0].description, "una fachada");
    // La carpeta sale ESTRECHADA: lo que entra es el `value` de un <select>.
    assert.equal(res.subida.images[0].folder, "faces");
  });

  // Lo que devuelve la puerta NO es un detalle interno: es literalmente el
  // cuerpo que el título sube (`body: JSON.stringify(comprobado.subida)`), y lo
  // que Python guarda en el manifest. Hasta la vuelta de QA de la PR 7 de #241
  // (hallazgo H7) ninguna de estas cuatro ramas del `.transform` tenía un solo
  // aserto: un mutante que tirara el `id` o el `style_token` del camino de ÉXITO
  // sobrevivía al suite entero, y el pack se escribía sin ellos.
  it("lo que VIAJA al servidor conserva la descripción del pack, el style_token y el id de cada imagen", () => {
    const res = validarSubidaDeEstilo(
      subida({
        description: "  Ilustración a tinta sobre pergamino envejecido.  ",
        style_token: "  tinta y pergamino, trazo grueso  ",
        images: [
          { folder: "faces", description: "  un portón claveteado  ", image_b64: B64, id: "porton_norte" },
        ],
      }),
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    // Los dos del pack salen RECORTADOS (es lo que se escribe en style.json).
    assert.equal(res.subida.description, "Ilustración a tinta sobre pergamino envejecido.");
    assert.equal(res.subida.style_token, "tinta y pergamino, trazo grueso");
    // El id NO se toca: es el que entra en la clave de caché de la imagen, así
    // que recortarlo o normalizarlo aquí sería cambiarlo a espaldas de quien lo
    // eligió (y ya lo valida `SAFE_ID`, que no admite espacios).
    assert.equal(res.subida.images[0].id, "porton_norte");
    assert.equal(res.subida.images[0].description, "un portón claveteado");
    assert.equal(res.subida.images[0].image_b64, B64);
  });

  it("lo que no se mandó no se inventa: la lámina sin `description` ni `id` sale con la cadena vacía y sin id", () => {
    const res = validarSubidaDeEstilo(
      subida({ images: [{ folder: CARPETA_LAMINA, image_b64: B64 }] }),
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    // `description` ausente y `description: ""` tienen que dar lo MISMO: Python
    // recibe siempre la clave (su modelo la tiene con default "") y el manifest
    // no puede acabar con un `undefined` serializado a nada.
    assert.equal(res.subida.images[0].description, "");
    assert.equal("id" in res.subida.images[0], false);
    assert.equal("description" in res.subida, false);
    assert.equal("style_token" in res.subida, false);
  });

  it("las tres carpetas del pack valen, y solo esas", () => {
    for (const folder of STYLE_REF_FOLDERS) {
      const img = { folder, description: "algo", image_b64: B64 };
      assert.equal(validarSubidaDeEstilo(subida({ images: [img] })).ok, true, folder);
    }
    const raro = validarSubidaDeEstilo(
      subida({ images: [{ folder: "stage_wide", description: "algo", image_b64: B64 }] }),
    );
    assert.equal(raro.ok, false);
    assert.equal(raro.ok === false && raro.error, MOTIVOS_DE_SUBIDA.carpeta.replace("{ref}", "la imagen 1"));
  });
});

describe("validarSubidaDeEstilo · lo que NO pasa, con su motivo", () => {
  const casos: Array<[string, SubidaCruda, string, number | null]> = [
    [
      "sin nombre",
      subida({ name: "" }),
      MOTIVOS_DE_SUBIDA.nombre_corto,
      null,
    ],
    [
      "nombre de 1 carácter (el mínimo es 2)",
      subida({ name: "a" }),
      MOTIVOS_DE_SUBIDA.nombre_corto,
      null,
    ],
    [
      "nombre de solo espacios (el recorte es parte de la regla)",
      subida({ name: "        " }),
      MOTIVOS_DE_SUBIDA.nombre_corto,
      null,
    ],
    [
      "nombre de 61 caracteres (el máximo, con SU frase y no la del mínimo — #536)",
      subida({ name: largo(REGLAS_DE_SUBIDA.nombre.max + 1) }),
      MOTIVOS_DE_SUBIDA.nombre_largo,
      null,
    ],
    [
      "descripción del pack de 501",
      subida({ description: largo(REGLAS_DE_SUBIDA.descripcion_del_pack_max + 1) }),
      MOTIVOS_DE_SUBIDA.descripcion_del_pack,
      null,
    ],
    [
      "style_token de 301",
      subida({ style_token: largo(REGLAS_DE_SUBIDA.style_token_max + 1) }),
      MOTIVOS_DE_SUBIDA.style_token,
      null,
    ],
    ["sin etiquetas", subida({ tags: [] }), MOTIVOS_DE_SUBIDA.sin_etiquetas, null],
    [
      "etiquetas que son solo espacios",
      subida({ tags: ["  ", ""] }),
      MOTIVOS_DE_SUBIDA.sin_etiquetas,
      null,
    ],
    [
      "nueve etiquetas (el máximo es 8): NO se le dice «elige al menos una» — #536",
      subida({ tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }),
      MOTIVOS_DE_SUBIDA.demasiadas_etiquetas,
      null,
    ],
    ["sin imágenes", subida({ images: [] }), MOTIVOS_DE_SUBIDA.sin_imagenes, null],
    [
      "trece imágenes (el máximo es 12): el caso literal de #536",
      subida({ images: Array.from({ length: 13 }, () => cara()) }),
      MOTIVOS_DE_SUBIDA.demasiadas_imagenes,
      null,
    ],
    [
      "dos láminas de materiales",
      subida({ images: [lamina(), lamina()] }),
      MOTIVOS_DE_SUBIDA.mas_de_una_lamina,
      null,
    ],
    [
      "una cara sin descripción",
      subida({ images: [lamina(), cara("")] }),
      MOTIVOS_DE_SUBIDA.sin_descripcion.replace("{ref}", "la imagen 2"),
      1,
    ],
    [
      "una imagen vacía",
      subida({ images: [{ folder: "faces", description: "algo", image_b64: "" }] }),
      MOTIVOS_DE_SUBIDA.imagen_vacia.replace("{ref}", "la imagen 1"),
      0,
    ],
    [
      "descripción de imagen de 301",
      subida({ images: [cara(largo(REGLAS_DE_SUBIDA.descripcion_de_imagen_max + 1))] }),
      MOTIVOS_DE_SUBIDA.descripcion_de_imagen.replace("{ref}", "la imagen 1"),
      0,
    ],
    [
      "id con caracteres que no valen de nombre de archivo",
      subida({ images: [{ ...cara(), id: "con/barra" }] }),
      MOTIVOS_DE_SUBIDA.id_invalido.replace("{ref}", "con/barra"),
      0,
    ],
    [
      "id de 61 caracteres",
      subida({ images: [{ ...cara(), id: largo(REGLAS_DE_SUBIDA.ref_id_max + 1) }] }),
      MOTIVOS_DE_SUBIDA.id_invalido.replace("{ref}", largo(REGLAS_DE_SUBIDA.ref_id_max + 1)),
      0,
    ],
    [
      "dos imágenes con el mismo id",
      subida({ images: [{ ...cara(), id: "fachada" }, { ...cara(), id: "fachada" }] }),
      MOTIVOS_DE_SUBIDA.id_duplicado.replace("{ref}", "fachada"),
      1,
    ],
  ];
  for (const [nombre, cuerpo, motivo, imagen] of casos) {
    it(`${nombre} ⇒ «${motivo}»`, () => {
      const res = validarSubidaDeEstilo(cuerpo);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error, motivo);
      assert.equal(res.imagen, imagen, "el índice de la imagen culpable (o null)");
    });
  }

  it("los límites JUSTOS pasan: 2 y 60 de nombre, 1 y 8 etiquetas, 1 y 12 imágenes", () => {
    assert.equal(validarSubidaDeEstilo(subida({ name: "ab" })).ok, true);
    assert.equal(
      validarSubidaDeEstilo(subida({ name: largo(REGLAS_DE_SUBIDA.nombre.max) })).ok,
      true,
    );
    assert.equal(
      validarSubidaDeEstilo(subida({ tags: ["a", "b", "c", "d", "e", "f", "g", "h"] })).ok,
      true,
    );
    assert.equal(
      validarSubidaDeEstilo(subida({ images: Array.from({ length: 12 }, () => cara()) })).ok,
      true,
    );
    assert.equal(
      validarSubidaDeEstilo(
        subida({ description: largo(REGLAS_DE_SUBIDA.descripcion_del_pack_max) }),
      ).ok,
      true,
    );
    assert.equal(
      validarSubidaDeEstilo(
        subida({ images: [cara(largo(REGLAS_DE_SUBIDA.descripcion_de_imagen_max))] }),
      ).ok,
      true,
    );
  });

  it("el motivo que sale es el PRIMERO en el orden de Python (nombre antes que etiquetas)", () => {
    // Importa porque es lo que hace que un cuerpo con un solo fallo dé el mismo
    // texto en los dos procesos, y un cuerpo con dos dé uno de ellos y no un
    // tercero inventado.
    const res = validarSubidaDeEstilo(subida({ name: "", tags: [], images: [] }));
    assert.equal(res.ok === false && res.error, MOTIVOS_DE_SUBIDA.nombre_corto);
  });
});

/** LOS MOTIVOS COMO TEXTO DE PRODUCTO (#536), recorridos uno a uno.
 *
 *  Los casos de arriba comprueban QUÉ motivo sale para cada cuerpo malo; esto
 *  comprueba cómo está ESCRITO cada uno, que es lo que lee el jugador y lo que
 *  Python devuelve como `detail` del 422. Recorre el objeto entero a propósito:
 *  un motivo nuevo entra bajo estas reglas sin que nadie tenga que acordarse de
 *  añadirlo aquí, que es lo contrario de la tabla de arriba.
 *
 *  Probado en NEGATIVO al escribirlo, cada sonda revertida (2026-09-10):
 *  devolver `demasiadas_imagenes` a «Sube al menos una imagen (máximo 12).»
 *  pone rojo el del límite doble; quitarle el punto final a `id_invalido` pone
 *  rojo el de la frase completa; devolver `imagen_vacia` a «{ref} no trae
 *  ninguna imagen.» pone rojo el del hueco — y NO el de la mayúscula, que es
 *  justo por lo que son DOS asertos y no uno: `"{".toLocaleUpperCase()` es `"{"`,
 *  así que una frase que abre con el hueco pasa la prueba de la mayúscula
 *  mientras el jugador lee una minúscula. Medido, no supuesto. */
describe("MOTIVOS_DE_SUBIDA · lo que lee el jugador", () => {
  const motivos = Object.entries(MOTIVOS_DE_SUBIDA) as Array<[string, string]>;

  it("hay motivos que recorrer (si no, los tres asertos de abajo no miran nada)", () => {
    assert.ok(motivos.length >= 10, `solo ${motivos.length} motivos`);
  });

  for (const [clave, texto] of motivos) {
    it(`«${clave}» es una frase completa, en mayúscula y con un solo límite`, () => {
      // 1 · MAYÚSCULA INICIAL. El caso que lo motiva no es un descuido de
      // estilo: dos motivos empezaban por `{ref}`, que se sustituye por un id
      // («torre») o por «la imagen 3», así que la frase que leía el jugador
      // arrancaba SIEMPRE en minúscula y no había forma de arreglarla desde el
      // emisor. Se mira la plantilla, que es donde vive la decisión.
      const primera = texto[0];
      assert.equal(
        primera,
        primera.toLocaleUpperCase("es-ES"),
        `«${texto}» empieza en minúscula (¿arranca con {ref}?)`,
      );
      // 2 · FRASE COMPLETA: termina en punto. Barato, y es lo que separa un
      // motivo de una etiqueta de log.
      assert.ok(texto.endsWith("."), `«${texto}» no termina en punto`);
      // 3 · UN LÍMITE, UNA FRASE. Con trece imágenes se leía «Sube al menos una
      // imagen (máximo 12)»: la orden ya cumplida y el número que la
      // contradice, juntos. Un motivo que dice «al menos» no puede decir además
      // «máximo» ni «como mucho».
      const pideMinimo = /\bal menos\b/i.test(texto);
      const declaraMaximo = /\bm[áa]ximo\b|\bcomo mucho\b|no puede pasar de/i.test(texto);
      assert.ok(
        !(pideMinimo && declaraMaximo),
        `«${texto}» mezcla el mínimo y el máximo en la misma frase (#536)`,
      );
    });
  }

  it("el hueco {ref} nunca abre la frase: cae dentro, donde la minúscula es correcta", () => {
    for (const [clave, texto] of motivos) {
      assert.ok(!texto.startsWith("{ref}"), `«${clave}» abre con {ref}: ${texto}`);
    }
  });
});

describe("refDeImagen", () => {
  it("nombra la imagen por su id si lo declararon y, si no, por su posición", () => {
    assert.equal(refDeImagen(0, "fachada"), "fachada");
    assert.equal(refDeImagen(0), "la imagen 1");
    assert.equal(refDeImagen(11, ""), "la imagen 12");
  });
});

describe("SubidaDeEstiloSchema", () => {
  it("rechaza un cuerpo que no es del tipo del wire (y no revienta)", () => {
    for (const basura of [null, undefined, 42, "una subida", [], { name: 3 }]) {
      assert.equal(SubidaDeEstiloSchema.safeParse(basura).success, false, JSON.stringify(basura));
    }
  });

  it("los campos opcionales del wire pueden faltar", () => {
    const res = SubidaDeEstiloSchema.safeParse({
      name: "Tinta",
      tags: ["medieval"],
      images: [{ folder: "faces", description: "una fachada", image_b64: B64 }],
    });
    assert.equal(res.success, true);
    assert.equal(res.success && res.data.description, undefined);
  });
});

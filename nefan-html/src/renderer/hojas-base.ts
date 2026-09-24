/** Las hojas base de y_bot: el set sin el que ningún personaje tiene cuerpo.
 *  Obligatorio antes del primer frame cuando `character_sprites=true`; LANZA
 *  si falta cualquier hoja (fail-loud). Vivía en `CharacterSpriteManager`,
 *  pero no toca nada suyo —ni skins ni cadena—: solo el renderer de hojas.
 *
 *  `allSettled` y no `all`: las diez hojas se piden igual en los dos casos
 *  —`all` no cancela nada—, pero `all` rechaza con la PRIMERA, así que el
 *  resumen «qué hacer» (main.ts) se registraba ANTES que los nueve fallos
 *  restantes y quedaba sepultado debajo en el panel, que va del más nuevo al
 *  más viejo. En un clon limpio fallan las diez (#255) y esa línea es la
 *  única accionable: se registra la última para que sea la primera que se
 *  lee. Sigue lanzando si falta cualquiera — el fail-loud no se toca. */
import { HOJAS_BASE_ANIMS } from "@nefan-core/src/contracts/sprite-census.js";
import { FALLO_HOJAS_BASE } from "@nefan-core/src/protocol/status-motivo.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

export async function precargarHojasBase(
  sprites: Pick<SpriteRenderer, "loadAnimation">,
  angle: string,
  modelo: string,
): Promise<void> {
  const cargas = await Promise.allSettled(HOJAS_BASE_ANIMS.map((anim) => sprites.loadAnimation(modelo, anim, angle)));
  const fallidas = HOJAS_BASE_ANIMS.filter((_, i) => cargas[i]?.status === "rejected");
  const primera = cargas.find((c) => c.status === "rejected");
  if (primera?.status === "rejected") {
    // El motivo CONCRETO de la primera viaja en el mensaje: sin él, agrupar
    // los fallos cambiaría «HTTP 404 on /sprites/y_bot/idle/…» por un
    // recuento que no dice dónde mirar.
    //
    // Y el CÓDIGO va delante porque este rechazo no se queda aquí: sube por
    // `vestir` (`aspecto-del-jugador.ts`) hasta el catch del arranque, que lo traduce con
    // `motivoDeSesionParaElJugador`. Sin código, esa traducción no lo
    // reconocía y le decía al jugador que el servidor había fallado y que
    // reintentara (#255 p2, hallazgo H1 de QA).
    throw new Error(
      `${FALLO_HOJAS_BASE}: faltan ${fallidas.length} de ${HOJAS_BASE_ANIMS.length} hojas ` +
        `(${fallidas.join(", ")}) — ${String(primera.reason)}`,
    );
  }
}

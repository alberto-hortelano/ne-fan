/** El VEREDICTO de un preset del launcher, separado de cómo se sondea.
 *
 *  `qa/presets.mjs` arranca cada preset de `./start.sh` y mira qué puertos
 *  quedan escuchando. Hasta #296, cualquier puerto del catálogo ocupado a
 *  mitad de corrida salía como «✘ levantó lo que NO dice» del preset que
 *  estuviera pasando por ahí — y en la PR #294 eso dio 6/7 con
 *  `playtest-motor` en rojo por un puerto que era de otro agente de la
 *  máquina. La ironía es completa: el guion que valida el arranque del stack
 *  daba por hecho que en la máquina hay un solo agente, que es justo lo que la
 *  tanda #274/#271/#275 acababa de eliminar.
 *
 *  La clasificación vive aquí, PURA y con el sondeo inyectado, por una razón
 *  concreta: probar «un ocupante ajeno no se le imputa al preset» arrancando
 *  ocho presets y ocupando puertos de verdad cuesta tres minutos, exige el
 *  catálogo entero libre y no se puede correr con otro agente en la máquina —
 *  o sea, exactamente en la situación que este arreglo viene a cubrir. Con el
 *  sondeo como dato de entrada, el caso se escribe en tres líneas.
 *
 *  El veredicto AJENO no es un rojo con otro icono: es «no se midió», el mismo
 *  que `⊘ SIN MEDIR` en `qa/run.mjs`. Un preset con un ocupante ajeno en un
 *  puerto que necesita ni siquiera llegó a arrancar (`start.sh` se NIEGA a
 *  arrancar sobre un puerto ocupado desde 2026-08-27, y su `trap EXIT` baja lo
 *  que ya había levantado): no hay nada que juzgar de él, ni bueno ni malo.
 */

/** Los tres veredictos de un preset. */
export const OK = "ok";
export const ROJO = "rojo";
export const AJENO = "ajeno";

export const ICONO = { [OK]: "✔", [ROJO]: "✘", [AJENO]: "⊘" };

/** ¿Qué salió de arrancar UN preset?
 *
 *  @param {object} caso
 *  @param {string} caso.slug            el preset
 *  @param {number[]} caso.esperados     puertos que su máscara dice levantar
 *  @param {number[]} caso.prohibidos    los demás del catálogo
 *  @param {Map<number, {arriba: boolean, ajeno: boolean, duenyo: string|null}>} caso.ocupacion
 *         el sondeo, ya hecho, de CADA puerto del catálogo. `ajeno` lo decide
 *         quien sondea (ver `esAjeno` en qa/presets.mjs): aquí no se adivina.
 */
export function clasificarPreset({ slug, esperados, prohibidos, ocupacion }) {
  const de = (p) => ocupacion.get(p) ?? { arriba: false, ajeno: false, duenyo: null };
  const rolDe = (p) => (esperados.includes(p) ? "esperado" : "prohibido");

  const ajenos = [...esperados, ...prohibidos]
    .filter((p) => de(p).arriba && de(p).ajeno)
    .map((p) => ({ puerto: p, duenyo: de(p).duenyo, rol: rolDe(p) }));
  const ocupadoPorAjeno = new Set(ajenos.map((a) => a.puerto));

  // Un puerto en manos ajenas no cuenta ni a favor ni en contra: ni «lo
  // levantó» (no fue él) ni «no lo levantó» (no le dejaron).
  const faltan = esperados.filter((p) => !ocupadoPorAjeno.has(p) && !de(p).arriba);
  const colados = prohibidos.filter((p) => !ocupadoPorAjeno.has(p) && de(p).arriba);

  // Si el ajeno está en un puerto que ESTE preset necesita, `start.sh` se negó
  // y bajó lo que llevara: de este preset no se midió nada. Si está en uno que
  // no necesita, el preset corrió entero y su veredicto sí vale — lo que no
  // vale es la corrida, que ya no es una foto limpia del catálogo.
  const enEsperado = ajenos.some((a) => a.rol === "esperado");
  const estado = enEsperado ? AJENO : faltan.length || colados.length ? ROJO : OK;

  return { slug, estado, faltan, colados, ajenos };
}

/** El veredicto de la CORRIDA, que no es la suma de los de los presets.
 *
 *  Misma escala de códigos de salida que `qa/run.mjs`, y por la misma razón:
 *    0  todos los presets arrancan exactamente su máscara
 *    1  hay presets en rojo, y todos se midieron: es el launcher
 *    2  algo no llegó a medirse (un ocupante ajeno en el catálogo): esta
 *       corrida NO dice si los presets están bien
 *  El 2 gana al 1: con un ajeno dentro, ni siquiera los rojos son de fiar. */
export function veredictoDeLaCorrida(resultados) {
  const cuenta = (e) => resultados.filter((r) => r.estado === e).length;
  const ok = cuenta(OK);
  const rojos = cuenta(ROJO);
  const noMedidos = cuenta(AJENO);
  /** Todos los ocupantes ajenos vistos, sean de un preset medido o no. */
  const ajenos = resultados.flatMap((r) => r.ajenos.map((a) => ({ ...a, slug: r.slug })));
  return {
    ok,
    rojos,
    noMedidos,
    ajenos,
    concluyente: ajenos.length === 0,
    exit: ajenos.length > 0 ? 2 : rojos > 0 ? 1 : 0,
  };
}

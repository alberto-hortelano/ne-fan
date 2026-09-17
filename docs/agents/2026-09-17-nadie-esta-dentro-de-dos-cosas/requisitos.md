# Requisitos — Tanda I «Nadie está dentro de dos cosas a la vez»

## La petición

Cita literal del usuario, la misma que abrió la tanda H y sigue vigente:

> «La mutacion se esta ejecutando, continua resloviendo issues»

La corrida que la motivaba (`35217880491`) **ya volvió y ya se repartió** (PR #647): COMPLETA, 0
supervivientes nuevos, y es justamente de ahí de donde sale la mitad de esta tanda.

## Por qué estos dos juntos

**Los dos viven en el mismo fichero**, `nefan-core/src/simulation/salida-del-solido.ts` (266 líneas,
nacido el 2026-09-16 con la tanda G), y **los dos son sobre la misma función o su vecina**. Separarlos
costaría dos PR sobre el mismo módulo con rebase garantizado; juntos son probablemente **una sola PR**.

Y hay una razón de fondo: **#648 dice que `sitioParaAparecer` no está medida y #643 dice que le falta un
caso**. Arreglar lo segundo sin lo primero es escribir código nuevo en la función menos vigilada del
módulo.

| Issue | Una frase |
|---|---|
| **#643** | Dentro de DOS geometrías a la vez el rumbo que da una lo frena la otra en hasta **912 de 1.106** puntos (2 de 36 libres) — pero **de ahí SE SALE**: 357/357 NPCs, 1.070/1.070 arranques de jugador. El defecto es que **el rumbo de salida miente**, no que encierre |
| **#648** | **8 de los 17 supervivientes** viven en `sitioParaAparecer` (L256 ×1, L261 ×4, L262 ×3), y uno **invierte el paso de salida** con la **suite ENTERA** en verde (2966/0, re-verificado por la crítica aplicando el mutante) |

## Estado medido hoy (`main` = `e5cdebb5`)

- `salida-del-solido.ts`: **266 líneas**, 12 símbolos de nivel superior, 4 exportados
  (`penetracionEnSolido`, `salidaDelSolido`, `solidoBloquea`, `sitioParaAparecer`) + `TOPE_MARCHA_M`.
- Suelo de mutación **81** (`break`), puesto a la medida en #647: **17 vivos de 90**, score 81,11 %.
  El módulo **cabe de sobra en el tope local** (90 < 120), así que el ingeniero puede medirlo él.
- Su `porque` en `mutation-targets.json` ya lleva escrito el diagnóstico completo de los 17, con línea
  a línea. **No hace falta re-descubrirlo; hace falta verificarlo.**

## DECISIÓN DEL USUARIO (tras la crítica, 2026-09-17)

Servidas las tres opciones de alcance para #643, la respuesta fue **«Candado, sin tocar geometría»** — la
que recomendaba la crítica. O sea:

- **#643 NO se arregla y NO se cierra.** La tanda entrega **el candado** que deja rojo el rumbo que miente
  (hoy **912 de 1.106** puntos), **sin tocar producción**. El issue se queda abierto con su medida escrita,
  incluida la parte que lo reencuadra: **de ahí se sale** (357/357 NPCs, 1.070/1.070 arranques de jugador,
  0 escapes usados, peor caso 6,27 s); lo que falla es que **el rumbo de salida miente**.
- **#648 entero**, que es la mitad barata y sin decisiones pendientes.

**El candado no puede afirmar «nadie se queda encerrado dentro de las dos»: eso NACE VERDE** (medido por la
crítica) y sería el cuarto candado sin sujeto vivo en tres tandas. Tiene que afirmar **que el rumbo que
devuelve `porDondeSalirDeAqui` no lo frena ninguna fuente**.

## Lo que el crítico tiene que decidir

1. **¿#643 es lo que dice ser?** RESUELTO POR LA CRÍTICA. El fichero **NO ha cambiado**: `salida-del-solido.ts`
   tiene UN commit (`6ca8dc1d`, PR #641) y el blob que midió la corrida `35217880491` es `00980f42`, **el de
   HEAD** — así que los 17 supervivientes valen sin re-medir y mi frase «el fichero ha cambiado desde
   entonces» era falsa. Lo que había que re-verificar no era la medida de mutación sino **la CONSECUENCIA que
   el issue implica**, y ahí es donde se cae: de dentro de las dos geometrías **se sale**.
2. **¿La unión de fuentes es la forma correcta?** El issue propone «penetración sobre la UNIÓN, no sobre
   cada fuente». Ojo a lo ya tumbado con medida en la tanda E: «celda a celda» literal **encierra** (0 de
   8 rumbos salen de una caja de 12×12 m), y la «puerta del destino combinado» **clava** al jugador en la
   esquina. Si la unión tiene el mismo problema, mejor saberlo antes de escribir.
3. **¿Los 8 de `sitioParaAparecer` se matan o se quita el código que los hospeda?** RESUELTO: **se matan**,
   y la crítica trae el instrumento — un `SueloSolido` **analítico de tres líneas** con un macizo
   **ASIMÉTRICO** (`x ∈ [0,400]`, `z ∈ [0,800]`, cuerpo en (245, 400)) da `{x: 400.5, z: 400}` con el
   original y `null` con el mutante. El macizo **simétrico** de `test/salida-del-solido.test.ts:296` da
   `null` con los dos, y por eso sobreviven hoy. El precedente de la
   casa es claro y va en la segunda dirección cuando el código es inobservable (`arch-cierre` el
   2026-09-06, `render-mode` el 09-09). Aquí NO parece el caso —la función es observable y la conducta
   está sujeta por `qa/el-viaje-no-mete-a-nadie-dentro.mjs`—, pero eso hay que **medirlo**, no suponerlo.
4. **¿Los otros 9 son equivalentes?** El issue pide declararlos «con la medida que lo demuestre, no de
   palabra». De los dos cortes en seco de `solidoBloquea`: **L227 SÍ** es equivalente en veredicto y solo se
   distingue por coste; **L229 NO** — su mutante deja `solidoBloquea` **sin frenar nada desde dentro**, que es
   conducta, se ve andando y se mata con un aserto. No se declaran en el mismo renglón.
5. **¿Hay conflicto con #646?** («al NPC se le sigue mandando al centro del `anchor.rect`»). Toca el mismo
   territorio conceptual pero no el mismo fichero. Decidir si entra, y si no, decir por qué.

## Lo que la tanda NO debe hacer

- **No bajar el suelo.** Si algo crece, se mide; el suelo solo sube.
- **No añadir una segunda geometría.** Es el error que la tanda E cerró con `cajas-de-runtime` usando
  `cajaBloquea` en vez de la suya: dos geometrías que se parecen son este mismo defecto en espejo.
- **No declarar equivalente un mutante de palabra.**
- **No unir la fuente SOLO en `porDondeSalirDeAqui`.** Medido por la crítica: deja los **mismos 183** puntos
  frenados en un caso y sube de **0 a 21** en otro, y esos 21 los frena el **TILE**, que es justo el
  impedimento que **no** abre el escape de #583. O se une también la regla de paso —con la atribución de
  `Impedimento` reconstruida— o no se toca la geometría y la tanda entrega el candado y #648.

## Restricciones de la casa (vigentes)

- **Cero créditos** en toda verificación: motor falso, `e2e-sin-creditos`, `html-fixtures`.
- **No se para ni se arranca nada ajeno.** Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --preset <slug>` desde
  el propio worktree, y `--parar` con el mismo offset desde el mismo árbol. **Nunca `--parar-todo`.**
- Una retirada incluye **la prosa, los comentarios y los docs**: `grep` a cero.
- El ingeniero commitea; **no** empuja ni abre PR. Eso lo hace el coordinador.
- Solo se commitean `requisitos.md`, `critica.md` y `qa*.md`.
- **El disco de la máquina está al 99 %** (5,5 G libres). No es excusa para un rojo, pero sí para elegir
  la verificación más barata que demuestre lo que toca, y para no dejar artefactos.

## Criterio de cierre (borrador, lo afina la crítica)

- **#643**: el candado afirma que **el rumbo de `porDondeSalirDeAqui` NO lo frena ninguna fuente** (hoy rojo
  en **912 de 1.106** puntos). **Un candado que afirme «nadie se queda encerrado dentro de las dos» NACE
  VERDE** —medido— y sería el cuarto sin sujeto vivo en tres tandas: no vale. Si va como barrido en `qa/`,
  con `probePoint` y no `probeCollide`, o nace con **#651** puesto.
- **#648**: los **8 de `sitioParaAparecer` muertos** (L256 ×1, L261 ×4, L262 ×3), verificado con
  `npm run mutacion -- local salida-del-solido`, y el suelo **subido** a lo que dé. Los **9** restantes,
  clasificados uno a uno con su medida — y **L229 no va en el renglón de L227**: es conducta, se mata.
- `npm run verify` verde, batería sin rojos nuevos, ningún umbral bajado.
- **Si hay que sacrificar algo, se sacrifica #643** (recomendación de la crítica).

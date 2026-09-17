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
| **#643** | Dentro de DOS geometrías a la vez (tile **y** caja de runtime) el rumbo que da una lo frena la otra: **2 de 36 rumbos libres** |
| **#648** | **7 de los 17 supervivientes** del módulo viven en `sitioParaAparecer`, y uno de ellos **invierte el paso de salida** con `npm run verify` 2933/0 en verde |

## Estado medido hoy (`main` = `e5cdebb5`)

- `salida-del-solido.ts`: **266 líneas**, 12 símbolos de nivel superior, 4 exportados
  (`penetracionEnSolido`, `salidaDelSolido`, `solidoBloquea`, `sitioParaAparecer`) + `TOPE_MARCHA_M`.
- Suelo de mutación **81** (`break`), puesto a la medida en #647: **17 vivos de 90**, score 81,11 %.
  El módulo **cabe de sobra en el tope local** (90 < 120), así que el ingeniero puede medirlo él.
- Su `porque` en `mutation-targets.json` ya lleva escrito el diagnóstico completo de los 17, con línea
  a línea. **No hace falta re-descubrirlo; hace falta verificarlo.**

## Lo que el crítico tiene que decidir

1. **¿#643 es lo que dice ser?** Su hecho está medido («2 de 36 rumbos libres»), pero la medida es de la
   tanda G y **el fichero ha cambiado desde entonces**. Hay que re-verificar que el caso sigue vivo,
   contra el código de hoy y no contra el issue.
2. **¿La unión de fuentes es la forma correcta?** El issue propone «penetración sobre la UNIÓN, no sobre
   cada fuente». Ojo a lo ya tumbado con medida en la tanda E: «celda a celda» literal **encierra** (0 de
   8 rumbos salen de una caja de 12×12 m), y la «puerta del destino combinado» **clava** al jugador en la
   esquina. Si la unión tiene el mismo problema, mejor saberlo antes de escribir.
3. **¿Los 7 de `sitioParaAparecer` se matan o se quita el código que los hospeda?** El precedente de la
   casa es claro y va en la segunda dirección cuando el código es inobservable (`arch-cierre` el
   2026-09-06, `render-mode` el 09-09). Aquí NO parece el caso —la función es observable y la conducta
   está sujeta por `qa/el-viaje-no-mete-a-nadie-dentro.mjs`—, pero eso hay que **medirlo**, no suponerlo.
4. **¿Los otros 10 son equivalentes?** El issue pide declararlos «con la medida que lo demuestre, no de
   palabra». Dos de ellos (los cortes en seco de `solidoBloquea`, L227 y L229) son optimizaciones:
   matarlos puede exigir medir el COSTE, no el veredicto — y eso es un candado distinto.
5. **¿Hay conflicto con #646?** («al NPC se le sigue mandando al centro del `anchor.rect`»). Toca el mismo
   territorio conceptual pero no el mismo fichero. Decidir si entra, y si no, decir por qué.

## Lo que la tanda NO debe hacer

- **No bajar el suelo.** Si algo crece, se mide; el suelo solo sube.
- **No añadir una segunda geometría.** Es el error que la tanda E cerró con `cajas-de-runtime` usando
  `cajaBloquea` en vez de la suya: dos geometrías que se parecen son este mismo defecto en espejo.
- **No declarar equivalente un mutante de palabra.**

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

- **#643**: los 36 rumbos del caso «dentro de las dos» medidos, y el número que salga escrito. Candado
  ejecutable que se ponga rojo con el código de hoy.
- **#648**: los **7 de `sitioParaAparecer` muertos**, verificado con `npm run mutacion -- local
  salida-del-solido`, y el suelo **subido** a lo que dé. Los 10 restantes, clasificados uno a uno con su
  medida.
- `npm run verify` verde, batería sin rojos nuevos, ningún umbral bajado.

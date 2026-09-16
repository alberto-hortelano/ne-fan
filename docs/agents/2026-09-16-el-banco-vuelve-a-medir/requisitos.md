# Tanda F — «El banco vuelve a medir»

## La petición, literal

El usuario pidió primero:

> **«Revisa las ultimas PRs que han entrado»**

Se revisaron las trece que entraron el 2026-09-16 entre las 13:37 y las 15:10 (#620–#632), que no
son de esta sesión. Al presentarle el resultado —seis guiones de la batería en rojo, nuevos y
reproducibles— y preguntarle si abría tanda con eso en vez de con la tanda F que había preparada
sobre #616 y #618, contestó:

> **«adelante»**

Así que el sujeto de esta tanda son **los seis rojos y el registro de errores**, y NO #616/#618.

## Qué se midió antes de escribir esto

Todo lo de abajo está medido, no inferido. Quien lea esto no tiene que fiarse: están los comandos.

**El estado de partida es verde donde se mira hoy.** CI verde en los trece commits de `main`.
`npm run build && npm run verify` en el checkout principal: **exit 0, 2.911 tests**. Ningún umbral
bajado: `arch-rules.json` solo renombra una función dentro de una excepción existente
(`addTileRaw` → `normalizarFixture`, y la función existe), y `client-file-size.json` **baja**
1394 → 1378, que es el `wc -l` real de `nefan-html/src/main.ts` comprobado a mano.

**Lo que el CI no mira.** La batería de navegador no corre en ningún job — es la deuda estructural
conocida de la casa. Corrida entera sobre `main` = `ee788590`:

```
131 en verde · 8 en rojo · 2 SIN MEDIR de 141
```

Rojos: 27, 39, 53, 75, 82, 92, 129, 130.

**La base, para no cobrarle a esta tanda lo que ya estaba roto.** Worktree desprendido en
`0db4f50b` (el `main` de antes de las doce PR), montado con la receta entera de
`docs/agents/README.md` (npm ci en los cuatro paquetes, build, y las hojas de sprites copiadas), y
corridos ahí los ocho:

| Guion | En `0db4f50b` | En `ee788590` | Veredicto |
|---|---|---|---|
| 129 · el enemigo malo cae solo | ✔ | ✘ | **NUEVO** |
| 130 · un lote entero inválido avisa igual | ✔ | ✘ | **NUEVO** |
| 53 · el umbral de skins se mide en el rango | ⊘ | ✘ | **NUEVO** |
| 27 · el clon limpio quiere jugar | ✔ | ✘ | **NUEVO** |
| 82 · volver al título desviste al jugador | ✔ | ✘ | **NUEVO** |
| 92 · el estilo que ofrece el título lo pone el bridge | ✔ | ✘ | **NUEVO** |
| 75 · la huella del tile no lleva las salidas | ✔ | ✘/✔ | **intermitente**, es #467 |
| 39 · la lista de exenciones del guardarraíl no envejece | ✘ | ✘ | **ya estaba** |

**Los que caían por expiración se repitieron sobre `main`** (segunda corrida): 27 ✘, 82 ✘, 92 ✘
reproducibles; **75 salió VERDE**, así que es la intermitencia de #467 y no es de esta tanda.

## Las tres causas, separadas

Son tres, no seis, y cada una tiene mecanismo identificado.

### Causa A · #625 movió los ids y los motivos fuera del mensaje de juego → 129 y 130

`avisoDeCriba` (`src/combat/criba-de-hostiles.ts`) devolvía un `string` con los ids y sus motivos
dentro. Ahora devuelve `{ message, detalleTecnico }`: el `message` es la frase legible y los ids
con sus motivos viajan en `detalleTecnico`. **La decisión es correcta** — era #592, la línea de
juego escupía rutas del parser — y el jugador no pierde nada: el aserto vecino «el motivo llega al
REGISTRO del jugador» sigue VERDE en el 130.

Lo que quedó viejo son los asertos. Tres guiones miden ese mensaje; **el 90 se actualizó y el 129
y el 130 no**. Los dos leen el `message` crudo del cable:

```js
// qa/guiones/130, línea 272
const elAviso = avisos.find((a) => a.kind === "combatientes")?.message ?? "";
```

y el rojo es literal:

```
✘ …y nombra a los TRES con sus TRES motivos distintos: un motivo no vale por todos
  — Enemigos que no entraron al mundo (3 de 3): sus datos de combate no son válidos.
    Consulta el registro de errores.
```

El cuerpo de la PR #625 lo dice sin querer: «Validación: … **QA 90**». El 130 existe justamente
porque el 129 no distingue el lote que no entra entero (lo escribió QA en la validación de #529),
y ninguno de los dos se corrió.

### Causa B · #627 quitó del banco el fallo que dos guiones medían → 53 y 82

El motor falso servía 500 para las anims que el modelo `paladin` no tiene (solo trae `idle`), y el
comentario del fichero decía que eso era **a propósito**: «ejercitando la cancelación de la cola de
skins del cliente». #627 cerró #498 mapeando la anim ausente a `idle` (`animDelBanco`), con el
motivo escrito: el banco no debe disparar el fusible de producción por una limitación de sus
propios assets. **La decisión también parece correcta.**

Pero dos guiones vivían de ese fallo:

- **53**, bloque «banco SIN máscara»: apaga a propósito su propio sabotaje para medir lo que hace
  el banco por su cuenta. Hoy el banco no falla → `canceladas=0 fallidos=0` → el aserto «cada
  personaje caído deja SU entrada en el registro» se queda **sin sujeto**.
- **82**, que espera «la cola del skin de A se asienta (falló en `walk`, o no le queda nada
  encolado)». Hoy `walk` se sirve, nunca falla, y la espera **expira**.

Ojo a la asimetría: el **51** («un personaje caído no desviste a los demás») sigue VERDE porque
**inyecta su propio 500** con `ctx.page.route`. El 53 lo inyecta en tres de sus cuatro bloques y en
el cuarto no, que es justo el que cae.

### Causa C · el registro de errores se vacía y con él se van diagnósticos que el jugador necesita → 27 y 92

**Esta es la única que puede ser un defecto de verdad, y no un aserto viejo.**

#620/#626 estrenan la faceta `errores` en `session-facets.ts`, cableada en el cliente como
`errores: porValor(() => errors.clear())` (`main.ts:171`). Era lo que pedía **#497** («el registro
de errores no se vacía al cambiar de partida») y el candado se puso en el guion **82**, que ahora
comprueba que volver al título retira el error de la partida abandonada.

Lo que se mide después es que en dos sitios el registro está **vacío cuando debería tener algo**:

- **27 · el clon limpio quiere jugar** — un clon sin las hojas de sprites debe dejar escrito el
  remedio. La precondición del propio guion sale VERDE («el mundo ya estaba pintado cuando falló el
  vestido»), o sea que el fallo OCURRIÓ; pero el registro sale así:
  `{"display":"none","remedioEnElDom":false,"entradas":0}` — **cero entradas**.
- **92 · el estilo que ofrece el título es el que pone el bridge** — expira esperando que «el
  registro del jugador recoge el aviso del estilo de otro tema». Los cinco asertos anteriores del
  bloque están verdes; el aviso simplemente no llega nunca al registro.

**VERIFICADO por el crítico (2026-09-16)**: es un solo mecanismo en DOS momentos.

- **Al 92 lo borra el `enter`**: `errors.push("session", res.avisoDeEstilo)` vive DENTRO de
  `startSession` (`nefan-html/src/net/narrative-client.ts:288`), que se `await`ea en `main.ts:1255`;
  `session.enter(...)` llega después (`main.ts:1257`) y `porValor` dispara (`""` → id) → `clear()`.
- **Al 27 lo borra el `leave`**: el remedio lo escribe `renderer/aspecto-del-jugador.ts:85-88`, y el
  `catch` de `unIntentoDeArrancar` llama a `session.leave()` (`main.ts:1356`) → `porValor` (id → `""`)
  → `clear()`. Se lleva las dos entradas.

**El orden de `APLICADORES` NO interviene, y la pista que daba este documento era un callejón**: en
los dos casos el `push` ocurre FUERA de la transición, antes de que `apply` recorra el record.
Reordenar la faceta no arregla ninguno de los dos, y quien se vaya por ahí gasta un plan entero.

**Y un tercer hecho que no estaba medido**: el candado de #497 vive en `qa/guiones/82-…:204-209` y
**hoy ni se ejecuta**, porque la espera del `walk` (línea 175, causa B) revienta antes de llegar.

La pregunta de diseño que hay debajo, y que #497 no contestó: **¿qué distingue un error que
pertenece a la partida que se va de uno que pertenece a la MÁQUINA y sigue siendo cierto después?**
«Faltan las hojas de sprites» no deja de ser verdad porque empieces otra partida.

## Lo que se pide

1. **Los seis rojos en verde**, cada uno por su causa y no bajando el aserto. **PARTIDO en dos, por
   la crítica**: A y B son edición de guiones sin decisión y pueden ir YA; **C necesita decisión del
   usuario antes del plan** (§2 de `critica.md`), porque tal como estaba escrito —«se arregla el
   defecto y el guion se queda como está»— **no es ejecutable**: el candado de #497 en el guion 82
   exige que el error de la partida abandonada DESAPAREZCA al volver al título, y el 27 exige que el
   remedio SIGA ESCRITO. Dos guiones vivos que se contradicen.
   En A y B, el aserto se reescribe para medir la conducta NUEVA. Matiz de A: el aserto del 130 lo
   escribió QA contra un mutante concreto (colapsar los motivos en uno), así que se **re-apunta a
   `detalleTecnico`**, que es el único sitio donde los tres sobreviven; re-apuntarlo al aserto vecino
   que ya está verde le quita el poder sin que se note.
2. **La cobertura del banco que quitó #627 no se pierde en silencio.** **ENCOGIDO por la crítica**:
   la cobertura NO se pierde. `qa/guiones/51-…:143-146` **ya afirma `canceladas === fallidos.length`**
   con su propio 500 inyectado —exactamente lo del bloque D del 53— y los bloques A/B/C del 53
   inyectan los suyos, así que el rango entero del fusible #236 sigue medido. Lo único exclusivo del
   bloque D era un RETRATO del banco, y #627 cambió el banco a propósito dejando candado de la
   conducta nueva (guion 139). **Se resuelve con una frase escrita, no con un guion nuevo.**
   Lo que sí hay que corregir: la cabecera del 53 y la espera del 82 justifican su máscara con «el
   motor falso solo tiene `idle` y contesta 500 a `walk`», y eso **hoy es FALSO** — `animDelBanco`
   mapea a `idle` todo `HOJAS_BASE_ANIMS`, y `walk` y `run` están dentro
   (`nefan-core/src/contracts/sprite-census.ts:31-34`).
3. **Las ocho filas que faltan en `qa/README.md`.** Los guiones 135-142 nacieron sin fila, y siete
   de los ocho no declaran en ninguna parte —ni en su cabecera ni en el README— haber sido probados
   en negativo. No se afirma que no lo estén: se afirma que no está escrito.
4. **La tecla `P` en la tabla de controles de CLAUDE.md.** El panel de sistemas la ata con
   `alPulsarTecla`, o sea es tecla de JUEGO y no de desarrollo, y la tabla que va entera en cada
   sesión no la nombra.

## Lo que NO entra

- **#39**, que ya estaba rojo antes de esta tanda. **No tiene issue: ninguno** (el crítico revisó la
  cola abierta entera). Su rojo de hoy señala al guion **116-lo-elegido-vuelve-del-editor**, que
  declara `sinMotor` y pulsa `#ts-start`. **Se abre issue con eso.**
- **#75. PREMISA FALSA de este documento, corregida por el crítico**: «es la intermitencia ya medida
  en #467» es falso por dos lados. **#467 está cerrado desde el 2026-09-10** (a mano, como
  `not_planned`); el issue que nombra al guion 75 por su número es **#496**, **cerrado hoy a las
  14:47**; y el propio guion cita #410, cerrado el 09-05. O sea: el rojo que esta tanda deja fuera
  «porque ya tiene dueño» **no tiene ningún dueño abierto**. Hay que reabrir #496 o abrir uno.
- **#616 y #618**, que eran la tanda F preparada y esperan.
- **Revocar ninguna de las tres decisiones de A, B y C.** Las tres parecen correctas; lo que falló
  fue no correr la batería detrás.

## Avisos para el crítico (medidos hoy, caducan)

- **`main` se mueve bajo los pies.** Durante esta sesión `main` pasó de `0db4f50b` a `ee788590` sin
  que esta sesión hiciera nada: hay otro agente trabajando en este mismo checkout. Trabajar en
  worktree propio y rebasar antes de dar nada por medido.
- **Las doce PR no traen un solo documento de equipo.** No hay `requisitos.md`, `critica.md` ni
  `qa.md` en `docs/agents/` para ninguna de ellas, así que no hay dónde leer qué se decidió ni qué
  se validó: solo los cuerpos de las PR, que son honestos pero cortos.
- **Tres issues con etiqueta `futuro` se cerraron** en esa tanda: #264, #317 y #360. #317 cumple su
  propio criterio escrito («…o dice con precisión cuál falta y por qué») y la PR lo declara sin
  adornos. **#360 es infraestructura de plugins**, que la decisión del usuario del 2026-09-02
  aparcó. No es sujeto de esta tanda; queda anotado.
- **#626 metió un recorte de viewport dentro de `projectToScreen`**, primitiva compartida, y truncó
  el telegraph; lo cazó el guion 23 y **#631 lo revirtió nueve minutos después**. Lo que dejó #631
  es un `width:100%` en la fixture DOM del 136, no un candado que impida que vuelva.
- **Deuda de mutación sin pedir**: `blueprint-suelo` (lo declara #632) se suma a `cajas-de-runtime`
  de la tanda E.

## Restricciones de la casa que aplican aquí

- **Cero créditos** en toda la verificación: motor falso, `html-fixtures`, `e2e-sin-creditos`.
- **No se para el stack de nadie.** Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --preset <slug>` desde el
  árbol propio, y solo `--parar` desde ese mismo árbol. **Nunca `--parar-todo`.**
- **Ningún umbral se baja**, ni se sube para acomodar lo que acaba de crecer.
- Los ingenieros commitean; no empujan ni abren PR. Eso lo hace el coordinador.
- El log de una corrida larga lleva el nombre del worktree (`bateria-f1.log`), porque el
  scratchpad es COMPARTIDO entre los agentes de la tanda.

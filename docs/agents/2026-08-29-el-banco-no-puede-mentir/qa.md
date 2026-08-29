# QA — El banco no puede mentir (#308 #296 #295 #280 #309)

Rama `feature/el-banco-no-puede-mentir`, 8 commits sobre `18a285e`, sin empujar.
Validado contra la **petición literal del usuario**, no contra el plan:

> «El motor falso pasa a TypeScript e IMPORTA los contratos en vez de copiarlos […] y el runner
> obliga a preguntar por el guardarraíl de créditos. Arregla el aparato con el que verifico todo lo
> demás. **La más cara de las tres, y la única que impide que el fallo vuelva.**»

O sea: el listón no es «los cinco issues en verde», es **que la clase de fallo deje de ser
expresable**. La tabla contesta los nueve criterios; la §2 contesta el listón, issue por issue.

Todo lo de abajo lo he medido yo. **Nada reproducido de fiar del informe**: las cuatro pruebas en
negativo, la paridad de #280 y los cuatro desenlaces del guardarraíl están vueltos a ejercer con
instrumentos míos, y dos de ellas con un contrafactual que el informe no traía.

---

## 1 · Los nueve criterios

| # | Criterio | | Evidencia |
|---|---|---|---|
| 1 | El typecheck cubre `labs/` y una divergencia de contrato rompe la compilación | ✅ | `npm run typecheck:labs` verde en el árbol limpio. Devolviendo el campo del issue (`surface_model`→`scene_model`): `../labs/narrative/fake-ai-server.ts(656,9): error TS2353 … 'scene_model' does not exist` · EXIT=2. Quitando un campo obligatorio: `(649,7) TS2741 Property 'sprite_skin_model' is missing`. **Y el rojo es SOLO de labs**, que es lo que pedía la redacción nueva: con el fake roto, `nefan-core npx tsc --noEmit` → EXIT=0 y `nefan-html npx tsc --noEmit` → EXIT=0. El paso está en `verify` y en el job `nefan-core` de CI (`.github/workflows/ci.yml:43`) |
| 2 | Las líneas copiadas de `http-server.ts` desaparecen, incluidas las dos que midió QA | ✅ | **Medido por curl contra los DOS servidores a la vez** (asset-store real :8767 y motor falso), comparando status + `Content-Type` + `Content-Length` + `Cache-Control` + sha256 del cuerpo: **12 de 12 rutas idénticas**, incluidos los cuatro casos de la tabla de #280 (`cover%2Ejpg` 400/400 · barra final 200/200 con la misma imagen · `Content-Length` presente e igual (291456) en los dos · fichero-punto `.jpg` 400/400). Tabla completa en §4. El fake importa `readStyleFile` + `http-wire.js` y **nada** de `http-server.ts`: `node:sqlite` no entra en su cadena |
| 3 | La batería da el MISMO veredicto que la línea base | ✅ | Línea base del coordinador sobre `abaa3d9`: 37/37 EXIT=0. Mi corrida sobre la rama: `37 en verde · 0 en rojo de 37 · EXIT=0`, con `⛨ guardarraíl` ×24 y `⛨ sin motor` ×13. Segunda corrida ya con mi guion nuevo dentro: `38 en verde · 0 en rojo de 38 · EXIT=0` |
| 4 | Ningún guion corre sin guardarraíl, y **olvidarse es el caso seguro** | ✅ (con un matiz de redacción, H2) | Los cuatro desenlaces reproducidos con un **proxy espía** delante del motor (§3): guion nuevo sin declarar + backend que dice `fake:false` → `⊘` y **el cuerpo no se ejecuta**: cero peticiones suyas en el log del backend (`grep QA_MARCA_99A` → 0). El MISMO fichero contra el fake sano → `✔` y sus peticiones sí salen. `sinMotor` que miente y toca ruta de pago → `⊘ … disparó generación: {"/skin_sprite_sheet":1}`. `sinMotor = true` → `⊘ PRECONDICIÓN NO GARANTIZADA` con el motivo escrito |
| 5 | Las CUATRO copias del prólogo desaparecen y la obligación vive en el runner | ✅ | `git diff` de 07/15/21/32: se van los cuatro bloques `stackSinCreditos` + `ctx.expect` + `if (!…) return`. `grep -rn stackSinCreditos qa/` → 0 · `grep -rn "^export const gasta" qa/` → 0. Ningún guion declara que gasta; quedan 13 exenciones con su motivo (14 con el mío) |
| 6 | Un ocupante ajeno a mitad de corrida no se le imputa a ningún preset | ✅ | Señuelo mío (`node senuelo-qa.mjs`, cwd `/tmp/…`) inyectado en `:8767` DURANTE `node qa/presets.mjs e2e html`: lo NOMBRA (`⊘ :8767 (prohibido suyo) lo ocupa OTRO — pid 71099 · … · cwd /tmp/…`), `html-fixtures` NO se pone rojo, y la corrida sale `✖ había ocupantes AJENOS … esta corrida NO dice si los presets arrancan lo suyo` con **EXIT=2**. **Contrafactual medido**, que el informe no traía: el mismo señuelo con la misma cadencia contra `qa/presets.mjs` de `18a285e` → `✘ levantó lo que NO dice: 8767`, `✘ html-fixtures`, **EXIT=1** y el ocupante sin nombre |
| 7a | El renderer deja de publicar lo que no sabe, y el tipo lo hace inexpresable | ✅ | `debugState()` es unión discriminada por `ready`; con `gl === null` los campos de cámara no existen. `nefan-html`: `tsc --noEmit` y `lint` verdes. Prueba viva incidental: con un cliente roto a propósito (§5, H4) `mirarA` **espera y se queja** (`timeout esperando: la mirada llega a -30° (último valor: null)`) en vez de leer el cero inventado y seguir |
| 7b | El guion 22 sigue 6 de 6 en verde | ✅ | Seis corridas en solitario sobre la rama: 6/6 `✔`, EXIT=0 las seis, y las seis con el MISMO valor (`pitch -30.00°`, borde lejano `{"x":640,"y":397}`, lienzo 1280×745). El `y:413` que midió el coordinador y el `y:397` de aquí los separa la barra de dev, que crece 30 px al dejar de decir `undefined` — **verificado aislando la variable** (§5) |
| 8 | Los dos candados siguen mirando el fake después del renombre | ✅ | Con un puerto literal y un `pkill` inyectados en el fake `.ts`: `✖ [error] nadie-inventa-un-puerto → labs/narrative/fake-ai-server.ts:119` y `✖ [deuda] solo-se-mata-el-puerto-propio → …:120`. **Contrafactual**: con el mismo código inyectado y los globs anteriores (`labs/**/*.mjs` a secas) las dos reglas salen **✔** — o sea, la ampliación del glob es exactamente lo que trabaja. Barrido completo: las TRES reglas con ámbito `labs/` (`campos-retirados-no-vuelven` ya lo tenía) incluyen `.ts`; ninguna se quedó atrás |
| 9 | Nada de esto gasta créditos ni al arreglarlo ni al verificarlo | ✅ | Todo contra procesos locales: motor falso, bridge, vite, asset-store (sirve ficheros commiteados) y servidores de pega míos. Cero llamadas a remote-gen, ai_server real o sprite-forge. El único POST a una ruta de pago fue contra el fake, y lo contó él |

Verificación del repo, repetida por mí: `nefan-core npm test` → **1616 tests, 0 fail** · `npm run typecheck:labs` verde · `nefan-core`/`nefan-html` `tsc --noEmit` verdes · `test/architecture.test.ts` **46 pass, 0 fail** con mi guion nuevo dentro · `node qa/guardarrail-sin-creditos.mjs` → **«el guardarraíl decide bien en los 14 desenlaces (12 malos, 2 buenos)»**.

---

## 2 · El listón: ¿deja de ser expresable el fallo, o solo está arreglado?

| Issue | Mecanismo, no síntoma | Lo que el candado NO alcanza |
|---|---|---|
| **#309** | ✅ El entregable es `typecheck:labs` en `verify` **y en CI**, no el renombre ni la extensión. Probado en los dos sentidos y comprobado que el rojo es de `labs/` | Ata el fake al contrato **TypeScript**. El servicio real es Python (`ai_server/remote_gen_main.py`) y no vi candado que lo ate al mismo zod: si Python deriva y el contrato TS no le sigue, el fake seguirá compilando y el banco volverá a mentir — la misma clase un piso más arriba (H5). Y cubre FORMAS, no rutas ni semántica (H6) |
| **#280** | ✅ El desvío deja de ser posible: la ruta, el MIME, el 404, la barra final y el `Content-Length` son **el mismo código** en los dos procesos. Medido idéntico byte a byte, no leído | Lo que el fake sigue poniendo de su cosecha es el CORS y el orden de rutas (`/styles/{id}/missing` va delante). Es suyo de verdad, y está escrito |
| **#295** | ✅ La inversión es el punto: el descuido cae en `⊘`, no en factura, y **no depende de ningún contador**. Reproducidos los cuatro desenlaces con tráfico observado, no con el veredicto impreso | La EXCEPCIÓN sigue siendo una lista escrita. Medido lo que cuesta (H3): un exento que miente, contra un backend que declara `fake:false` y no publica `/dev/counters`, **corre, sirve un `POST /skin_sprite_sheet` y sale VERDE**. Cierro la mitad estática con el guion 39 |
| **#296** | ✅ El veredicto de la corrida deja de ser la suma de los veredictos de los presets, y el ajeno se nombra. Contrafactual medido contra el script anterior | Lo acotan `ss` y `/proc`: si no se deja ver ningún pid, solo queda la señal «ya estaba». Es deliberado y está escrito (§7.3 del informe) |
| **#308** | ✅ No es «poner el valor bueno»: con `ready:false` los campos **no existen** y el tipo lo impide. Los consumidores exigen presencia | El origen de la intermitencia histórica del 22 sigue sin medir, y la medida que proponía el plan **no puede contestarlo tal como está escrita** (H4). La honestidad del alcance está bien puesta: lo dice el commit `d2ebb92`, el comentario de `fps-renderer.ts` y el informe; no hay ni una línea en el árbol que insinúe lo contrario (`grep -rn "intermiten\|estabiliz"` revisado entero) |

---

## 3 · Cómo medí el criterio 4 (el que toca dinero)

No me fié del veredicto impreso: monté el stack a mano con un **proxy espía** entre el cliente/bridge
y el motor falso, que (a) registra TODA petición que le llega y (b) con `FINGE_CARO=1` contesta
`/health` con `{"status":"ready","fake":false}` — o sea, se declara backend real. El resto lo
reenvía al fake de verdad, así el cliente arranca igual. Runner con `--adoptar`.

**Desenlace (a) — sin declarar nada, backend que dice `fake:false`.** Tráfico ENTERO del backend
durante la corrida (guion `99a`, que lleva dentro un `POST /skin_sprite_sheet`):

```
15:45:15.571 GET /dev/counters      ← el runner, al arrancar (¿hay red de contador?)
15:45:16.080 GET /dev/counters      ← gastoAntes del 99a
15:45:16.233 GET /dev/status        ← la PÁGINA, al cargar (barra de dev)
15:45:16.336 GET /health            ← el guardarraíl, vía cliente
15:45:16.352 GET /health            ← el guardarraíl, vía bridge
15:45:16.359 GET /dev/counters      ← gastoDespués del 99a
…
⊘ el guardarraíl de gasto se niega: cliente: declara fake:false (backend real) · bridge: ídem
```

**Del cuerpo del guion no salió nada**: ni el `POST /skin_sprite_sheet`, ni el `GET` marcado
(`grep QA_MARCA_99A` → 0 líneas). Ninguna de las cinco peticiones que sí hubo es de pago.

**(b) el MISMO fichero contra el fake sano** → `✔` y sus dos peticiones marcadas aparecen en el log:
el gate no es un «niégate siempre». **(c)** `sinMotor` que miente + ruta de pago → `⊘ declara
sinMotor (…) y disparó generación: {"/skin_sprite_sheet":1}`. **(d)** `sinMotor = true` → `⊘
PRECONDICIÓN NO GARANTIZADA`, con el motivo escrito y sin abrir el guion.

---

## 4 · Paridad de #280, medida contra los dos servidores

`curl` a los dos a la vez; se compara status + `Content-Type` + `Content-Length` + `Cache-Control` +
sha256 del cuerpo.

| ruta | asset-store REAL | motor FALSO | ¿idéntico? |
|---|---|---|---|
| `/styles/medievo_crudo/cover.jpg` | 200 · image/jpeg · 291456 · max-age=300 · `8b2557f2` | igual | **sí** |
| `…/cover%2Ejpg` | 400 · application/json · 81 · `63f3072e` | igual | **sí** |
| `…/cover.jpg/` (barra final) | 200 · image/jpeg · 291456 · `8b2557f2` | igual | **sí** |
| `…/.style.json` | 404 · 70 · `b461320a` | igual | **sí** |
| `…/faces/fachada.jpg` (subcarpeta de rol) | 200 · 594826 · `8a9b95d9` | igual | **sí** |
| `…/faces/fachada.jpg/` | 200 · 594826 · `8a9b95d9` | igual | **sí** |
| `…/no-existe.jpg` | 404 · 72 · `6d82b232` | igual | **sí** |
| `…/.jpg` (fichero-punto) | 400 · 81 · `63f3072e` | igual | **sí** |
| `…/.jpg/` | 400 · 81 · `63f3072e` | igual | **sí** |
| `…/cover.JPG` (extensión en mayúsculas) | 404 · 68 · `0ab7fa37` | igual | **sí** |
| `…/cover.jpg%2F` | 400 · 81 · `63f3072e` | igual | **sí** |
| `/styles/no_existe/cover.jpg` | 404 · 64 · `871c6fed` | igual | **sí** |

---

## 5 · Crítica visual

**Lo que el jugador (aquí, quien usa el banco) ve distinto**: la barra de dev deja de decir
`superficies undefined` y dice `superficies fake-surface-model`. Es el síntoma de #309 y es visible
en el título, en partida y en las fixtures.

*Antes* (capturas de `qa/capturas/2026-08-27T13-27-46-486Z-232010/01-…-titulo.png`, de la tanda
anterior): `superficies undefined · skins fake-skin-model`, barra de UNA fila con «Imágenes…»
apretado contra el borde derecho.
*Ahora* (`…/2026-08-29T15-40-33-388Z-66345/01-…-titulo.png`): el modelo real, barra de DOS filas y
«Imágenes…» en su propia fila, que respira mejor.

**Aislé la variable en vez de deducirla**, porque entre esas dos capturas hay dos días y otras dos
PR de por medio: corrí el guion 01 con el fake devolviendo otra vez `scene_model` y todo lo demás
igual. Resultado: barra de una fila con `undefined` y **el botón «× cerrar» en el mismo sitio** que
con el arreglo. O sea:

- el crecimiento de la barra (25 → 55 px, −30 px de lienzo) **sí** es de esta tanda, y es el coste
  aceptable de decir la verdad. Explica el desplazamiento del borde del telegraph (`y:413` → `y:397`)
  sin necesidad de inventarle una causa al renderer;
- el que «× cerrar» ya no viva debajo de la barra **no** es de esta tanda (venía de #310/#311). No se
  lo apunto.

Juicio: la barra a dos filas no estorba —es una herramienta de desarrollo y la segunda fila está
menos apretada que la fila única anterior—, y la escena de juego sigue componiendo igual (`22-…-03-telegraph-borde-quick.png`:
la rampa roja del alcance se lee entera sobre la calzada, el punto dulce verde se distingue, y el
tronco del embarcadero no la entierra). No hay regresión visual atribuible a la tanda.

---

## 6 · Hallazgos

### H1 · menor — dos comentarios describen el mecanismo que se retiró (`export const gasta`)

`grep` del término a cero, que es lo que pide CLAUDE.md al sustituir una vía, **no da cero**:

- `qa/run.mjs:507-509` — «*Es la segunda vía del guardarraíl, y **la que cubre el olvido**: el
  `gasta` de un guion protege al que se acuerda de declararlo, y esto caza al que no*». Es la
  descripción del diseño ANTERIOR, nombra una marca que ya no existe y **contradice al comentario
  del mismo fichero 375 líneas más abajo** (`:882` — «*caza al que DECLARA `sinMotor` y sí gasta —
  o sea, al que se equivoca al declarar, no al que se olvida*»).
- `labs/narrative/fake-ai-server.ts:127-128` y `:136` — «*si el contador SUBE y el guion no declaró
  `export const gasta = true`…*» y «*Contarlo obligaría a declarar `gasta` a guiones…*».

**Reproducción**: `grep -rn "gasta" qa/run.mjs labs/narrative/fake-ai-server.ts`.
**Qué esperaba**: que el fichero que sujeta el guardarraíl no explique el guardarraíl al revés. Un
lector que llegue a `gastoDelFake()` por primera vez se lleva que el contador cubre el olvido —
justo lo que la inversión decidió que NO puede cubrir, porque contra el backend caro no existe.
Es documentación falsa recién horneada, y la tanda va de eso. **No cambia ningún comportamiento.**

### H2 · menor — «sin haber mandado ni una petición» es literalmente falso

`qa/README.md:73`, la cabecera de `qa/run.mjs:27` (y su comentario de `:837`) dicen que el guion
gateado sale ⊘ «sin haber mandado ni una petición» / «cero peticiones». Medido (§3): antes del gate,
**la página manda `GET /dev/status`** al backend (la barra de dev, al cargar), y el propio gate
manda dos `/health`. Ninguna es de pago y el CUERPO del guion no manda nada —la protección está
entera—, pero la frase promete más de lo que hace, y es la clase de frase que alguien cita después
como garantía.

Lo que lo convierte en hallazgo y no en quisquillosidad: **la redacción precisa ya existía y se
perdió por el camino**. `critica.md:64` la había corregido — «*y hace cero peticiones **desde el
guion**. El guardarraíl sí sale a la red: dos `/health`*» — y el criterio 4 de `requisitos.md` la
volvió a escribir en corto («hace **cero** peticiones a ese backend»), que es la versión que acabó
copiada en el README y en el runner. Y ni la crítica contaba con la tercera: la de la propia página.
**Redacción medida**: «sin que el guion mande una sola petición» (las del gate y la barra de dev sí
van, y ninguna cuesta dinero).
**Reproducción**: cualquier backend con un log delante; el mío está en §3.

### H3 · menor — el residuo de la exención, medido en euros y no en prosa

El informe lo declara (§7.1 y §7.6). Lo que faltaba era el número: con un guion exento que MIENTE,
contra un backend que declara `fake:false` y **no publica `/dev/counters`** (que es lo que pasa
contra el motor real), el runner:

```
· OJO: el motor de esta corrida no publica /dev/counters — la red que caza a un
       `sinMotor` que sí gasta no está puesta. El guardarraíl de los demás sigue entero.
▶ 99b-sinmotor-que-miente
    ⛨ sin motor: juro que solo miro fixtures (mentira, de QA)
    POST /skin_sprite_sheet → HTTP 200        ← servido de verdad
    ✔ el guion hace lo suyo y se declara feliz
1 en verde · 0 en rojo de 1
```

O sea: **VERDE, con una ruta de pago servida**, y el único aviso es una línea al arrancar que no
nombra al guion ni cambia el código de salida. Es el precio acordado de tener excepción, y es mucho
más pequeño que el anterior (13 puertas en vez de 37), pero conviene que esté medido y no supuesto.
Mitigación que dejo hecha: **`qa/guiones/39-la-lista-de-exenciones-del-guardarrail-no-envejece.mjs`**
cierra la mitad que no necesita backend (ver §8).

### H4 · menor — la medida opcional del plan (§8) no puede contestar su pregunta

El plan propone `git checkout cc3cd54 -- nefan-html/src/main.ts`, reiniciar el cliente y correr el
22 seis veces para saber si `55ad470` mató la intermitencia. La hice: **6 de 6 en rojo, y no por
intermitencia** — ese `main.ts` no es compatible con el resto del árbol de hoy:

```
✘ ERROR: timeout esperando: la mirada llega a -30° (último valor: null)
✘ 1 excepción(es) en la página
  TypeError: narrativeClient.onNarrativeStatus is not a function
```

Un fichero de hace tres commits sobre el árbol de hoy no es el cliente de `cc3cd54`, es un cliente
roto. La pregunta sigue abierta y para contestarla hace falta un worktree completo en `cc3cd54`
(coste: `npm ci` de dos paquetes). **No bloquea nada**; lo escribo para que quien cierre #308 no
repita el experimento creyendo que mide algo. Árbol restaurado (`git checkout HEAD -- …`).

*De propina, y esto sí a favor de #308*: con ese cliente roto el guion **espera y se queja
nombrando el valor que falta** en vez de leerse un `pitchDeg: 0` inventado y seguir adelante. Es el
fail-loud del criterio 7a funcionando en un caso real.

### H5 · observación — el candado de #309 ata el fake al contrato TS, no al servicio Python

`satisfies DevStatus` compara el fake con `nefan-core/src/contracts/remote-gen.ts`. El servicio que
sirve eso en producción es `ai_server/remote_gen_main.py`, y no encontré candado que lo ate al mismo
contrato (`grep DevStatus` → solo TS + un test de spend en Python). La dirección que produjo #309
(contrato y Python renombran, el fake se queda) queda cerrada; la contraria (Python deriva y el
contrato TS no le sigue) deja al banco compilando feliz contra un contrato que ya no es el del
servicio. **Candidato a issue**, fuera del alcance de esta tanda.

### H6 · observación — el typecheck cubre FORMAS, no rutas

Medido de rebote: `POST /skin_sprite_sheet?x=1` da **404 en el motor falso** (compara
`req.url === "/skin_sprite_sheet"`) y lo serviría un FastAPI, que ignora la query al enrutar. Nada
del producto manda query en esa ruta, así que hoy no molesta a nadie; lo apunto porque es la misma
familia de desvío que #280 y el candado nuevo no la ve. No pido cambio.

### H7 · observación — `--url` sigue leyendo el contador del bloque base

`MOTOR_FALSO` sale de `URLS.fake_ai` (bloque base) y no de la URL que se pasa: en una corrida
`--url` contra un stack de otro bloque, `gastoDelFake()` preguntaría a OTRO motor falso — el del
vecino — o a nadie. No es nuevo de esta tanda (la constante ya se usaba para `?ai=`), y solo afecta
a la red pequeña, no al gate. Lo dejo dicho porque #295 le añadió un consumidor nuevo.

---

## 7 · Workarounds usados durante la prueba (y por qué no afectan al usuario)

| Workaround | Veredicto |
|---|---|
| **Proxy espía** delante del motor + stack montado a mano (fake en un puerto lateral, bridge con `NEFAN_AI_SERVER` al proxy, vite) y runner con `--adoptar` | **Instrumento de medida, no apaño.** Era la única forma de ver TODO el tráfico y de tener un backend que se declare `fake:false` sin tocar el producto. El jugador no tiene nada de esto delante; el camino que se midió es el del runner de verdad |
| Cinco guiones temporales (`99a/99b/99c`, `98a/98b`) | Borrados. `git status` limpio |
| Ediciones temporales en `labs/narrative/fake-ai-server.ts` (campo del contrato, puerto literal, `pkill`) y en `arch-rules.json` (globs viejos) | Pruebas en negativo obligatorias por el método. Restauradas con `git checkout --`; verificado limpio después de cada una |
| Señuelo en `:8767` desde `/tmp` para #296 | Proceso mío, parado por su PID. **No se tocó nada ajeno** en toda la sesión: ni `pkill`, ni matar por puerto lo que no arranqué |
| `git checkout cc3cd54 -- nefan-html/src/main.ts` (medida opcional del plan) | Restaurado. Y el resultado es H4 |

Ningún workaround fue necesario para **observar la feature**: los cinco arreglos se ven por el
camino normal (`node qa/run.mjs`, `node qa/presets.mjs`, `npm run typecheck:labs`).

---

## 8 · Guion nuevo

**`qa/guiones/39-la-lista-de-exenciones-del-guardarrail-no-envejece.mjs`** — cierra la mitad de H3
que no necesita backend. Lee los ficheros de `qa/guiones/` (todos, no los de la corrida) y afirma:

1. cada `sinMotor` es una FRASE, no un `true` ni una cadena vacía — también en los guiones que esa
   corrida no ejecuta, que el runner no mira;
2. ningún guion exento importa `comenzar` / `regenerarMundo`;
3. …ni pulsa a mano `#ts-start`/`#ts-continue`, salvo que se traiga SU propio motor
   (`NEFAN_AI_SERVER`), que es el caso del guion 20 y se marca para revisión humana;
4. no vuelve `export const gasta`, la marca directa que murió al invertir el guardarraíl.

Salida real: `✔` los cuatro, `14 guiones declaran sinMotor`, con la lista de motivos.
**Probado en negativo** con dos guiones de pega — los cuatro asertos se ponen rojos nombrando al
culpable:

```
✘ cada `sinMotor` es el MOTIVO escrito… — 98a-temporal-qa-declaracion-rota: true
✘ ningún guion exento importa los helpers… — 98b-temporal-qa-exento-que-gasta usa comenzar+regenerarMundo
✘ …y el exento que pulsa «Comenzar»… se trae SU propio motor — 98b-temporal-qa-exento-que-gasta
✘ ningún guion declara `export const gasta`… — 98b-temporal-qa-exento-que-gasta
```

Lo que NO caza está escrito en su cabecera: un exento que gaste por otro camino (un `fetch` a pelo).
Para eso está el contador del fake, que es la otra mitad. Batería completa con él dentro: **38/38,
EXIT=0**.

No escribo un test de paridad para #280: el propio issue lo descarta con razón, y la paridad de §4
ya no la sujeta un vigilante sino el hecho de que es el mismo código.

---

## 9 · No probado

- **El CI real**: la rama no está empujada. Verifiqué el paso nuevo en local (`typecheck:labs`, en
  `verify` y en el YAML) y que `labs/**/*.ts` solo importa `node:*` además de rutas relativas, así
  que el verde local debería predecir el del runner — pero **no es lo mismo que verlo verde**.
- **`npm run coverage` / `crap --check` / `deuda` / mutación**: no los repetí (los reporta el
  ingeniero). Sí repetí `npm test` (1616, 0 fail) y los tres typechecks.
- **`qa/presets.mjs` completo** (los ocho presets): solo `e2e-sin-creditos` y `html-fixtures`, como
  el ingeniero. Los otros seis arrancan ai_server, remote-gen y sprite-forge y exigen el catálogo
  entero durante minutos.
- **La batería ENTERA contra un backend `fake:false`**: probé el gate guion a guion (§3), no los 24
  a la vez.
- **Gasto real de créditos**: no probado a propósito. Ninguna prueba mía podía gastar; lo declaro en
  vez de aprobarlo por parecido.
- **El origen de la intermitencia histórica del guion 22**: sigue sin medir, y la receta propuesta no
  sirve (H4).

---

## 10 · Veredicto

**Apto.**

Los nueve criterios se cumplen y los cinco issues se cierran por el mecanismo, no por el síntoma:
el typecheck de `labs/` (probado en los dos sentidos y acotado a `labs/`), el cable compartido de la
ruta de estilos (12/12 respuestas idénticas byte a byte), el gate invertido (los cuatro desenlaces
reproducidos mirando el tráfico, no el veredicto), el ajeno que ya no se imputa (con contrafactual
contra el script anterior) y la unión discriminada que hace inexpresable el cero inventado. La
batería da el mismo veredicto que la línea base (37/37 → 38/38 con mi guion), y la honestidad sobre
#308 se sostiene en todos los sitios donde miré.

Los siete hallazgos son menores y ninguno toca comportamiento: dos son documentación que se quedó
describiendo el mecanismo anterior (H1, H2) —cheap de arreglar y justo la clase de deriva que esta
tanda persigue—, uno es el residuo declarado ahora medido (H3), otro es una receta del plan que no
mide lo que dice (H4) y tres son observaciones de alcance para el backlog (H5, H6, H7).

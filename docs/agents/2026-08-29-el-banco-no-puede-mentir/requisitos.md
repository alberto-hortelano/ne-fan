# El banco no puede mentir sobre el juego

**Tanda**: 2026-08-29 · rama `feature/el-banco-no-puede-mentir`
**Issues**: #309, #280, #295, #296

---

## 1 · La petición del usuario, literal

> «Vamos a seguir priorizando reducir el numero de issues»

Y, elegida la tanda entre tres alternativas medidas:

> «El banco no puede mentir (Recomendado)» — #309 #280 #295 #296

El usuario NO describió el problema técnico: eligió entre opciones que le presenté ya
medidas. Lo que compró está en la descripción de la opción, y es el criterio de éxito:

> «El motor falso pasa a TypeScript e IMPORTA los contratos en vez de copiarlos (tsx ya
> está en el preset), y el runner obliga a preguntar por el guardarraíl de créditos.
> Arregla el aparato con el que verifico todo lo demás. La más cara de las tres, y la
> única que impide que el fallo vuelva.»

**«La única que impide que el fallo vuelva» es la frase que manda.** Esta tanda no se
cierra corrigiendo los cuatro síntomas: se cierra cuando la clase de fallo deja de ser
expresable. Un arreglo que deje los cuatro issues verdes y el mecanismo intacto NO cumple
lo que se compró — y los cuerpos de #309 y #280 lo dicen ellos mismos («lo barato mientras
tanto: corregir `scene_model` → `surface_model`. Pero eso deja la siguiente divergencia
esperando»; «el arreglo no toca el mecanismo»).

---

## 2 · El enunciado común

Los cuatro issues son el mismo defecto en cuatro sitios: **el banco de pruebas puede
desviarse del juego sin que nadie se entere.** Y el banco es el aparato con el que se
verifica todo lo demás, así que su deriva no produce un fallo — produce un verde falso o
un rojo ajeno.

Que el mismo fallo haya ocurrido **dos veces en dos ficheros distintos** (#309 y #280) es
la firma de un candado que falta, no de dos descuidos.

---

## 3 · Los cuatro, con su medida

### #309 — el fake sirve un campo que el contrato no tiene

`labs/narrative/fake-ai-server.mjs:596` sirve **`scene_model`**. El contrato
(`nefan-core/src/contracts/remote-gen.ts:222`) y el servicio real
(`ai_server/remote_gen_main.py:70`) sirven **`surface_model`** desde `192037b`
(2026-08-22). El cliente lo lee en `nefan-html/src/ui/dev-status-panel.ts:159`:

```ts
`superficies ${st.config.surface_model} · `
```

No lo encuentra y pinta la palabra `undefined` en la barra de dev. **Seis días.** No es un
error: es una cadena en pantalla, y por eso nada avisó.

### #280 — el fake copia a mano el contrato del asset-store

`GET /styles/{id}/{file}` reimplementa `readStyleFile`. Lo escribió alguien que **sabía
que estaba copiando** y que **había medido la paridad**; QA la volvió a medir **el mismo
día** y encontró cuatro desvíos (`cover%2Ejpg` 400 vs 200-con-imagen, barra final,
`Content-Length`, fichero-punto). Los cuatro están arreglados en la PR #277 copiando aún
más literalmente — el mecanismo sigue igual.

El comentario del fichero (`fake-ai-server.mjs:530-533`) explica por qué se copia:

> «Se COPIA el contrato de `readStyleFile` […] no se importa: **el fake es .mjs y el único
> JS de nefan-core es `dist/`**, que el preset e2e-sin-creditos no construye.»

**Ese motivo está muerto, y es el desbloqueo de esta tanda** — pero NO por lo que escribí
primero. Corregido por el crítico:

- **Era falso** que el preset arranque el asset-store con `npx tsx` (línea 384).
  `PRESET_PROFILES` fila 3 (`start.sh:687`) es `1 0 0 1 0 0 0 1 0`: `e2e-sin-creditos`
  **no arranca el asset-store**. El único servicio del preset que corre con `tsx` es el
  bridge (352).
- **Y hay un matiz que decide el diseño**: `start_bridge` corre con cwd `nefan-core`, donde
  `tsx` es devDependency (4.21.0). `start_fake_ai` corre desde la **raíz del repo**, que no
  tiene `package.json` ni `node_modules`. Medido: `npx --no-install tsx --version` desde la
  raíz devuelve **4.23.12** — un artefacto global de la máquina (`~/.npm/_npx`), no una
  dependencia del repo. Arrancar el fake con `npx tsx` desde ahí le regala al banco una
  dependencia de la caché de npx y una segunda versión de tsx.

Lo que SÍ aguanta, y es lo que desbloquea la tanda: **importar de nefan-core es viable**.
`readStyleFile` (`blob-store.ts:114`) solo arrastra `node:fs`, `node:path` y `SAFE_ID` de
`src/games/loader.ts`; ese módulo trae zod, `style-refs` y `ui-theme`, y **no hace I/O al
importar** (solo construye schemas). Cero red, cero créditos. Y el fake **ya importa fuera
de su carpeta**: `fake-ai-server.mjs:23` → `../../qa/lib/stack.mjs`.

### El agujero que la conversión NO tapa (hallazgo del crítico, de primer orden)

**`tsx` borra los tipos sin mirarlos.** Y `labs/` no entra en ningún proyecto TS:
`nefan-core/tsconfig.json` incluye `src|bridge|services`, `tsconfig.scripts.json` incluye
`scripts/**`, `nefan-html/tsconfig.json` solo `src/**`, y el único paso de CI que nombra
`labs` es `python -m compileall -q ai_server labs`.

Un fake `.ts` **seguiría sirviendo `scene_model` en silencio**. El entregable de #309 no es
el renombre del campo ni el del fichero: es **el typecheck de `labs/` cableado a CI**.

Corolario que hay que vigilar: renombrar el fichero a `.ts` **le quita dos candados**.
`nadie-inventa-un-puerto` y `solo-se-mata-el-puerto-propio` acotan a `labs/**/*.mjs`
(`arch-rules.json:492` y `:507`), no a `.ts`. Seguirían verdes sin mirar el fichero.

El cuerpo de #280 dejó la pregunta abierta que decidía su tamaño — «hay que ver si el fake
puede importar de nefan-core sin arrastrarle dependencias que lo dejen de hacer útil como
servidor sin créditos» — y **la medida de arriba la contesta que sí**.

### #295 — nadie está obligado a preguntar por el guardarraíl de créditos

La obligación de llamar a `stackSinCreditos()` es un prólogo copiado a mano. QA midió el
hueco en vez de razonarlo: un guion **sin** ese prólogo, contra un backend que declaraba
`fake:false`, mandó **7 peticiones reales, una de ellas `POST /skin_sprite_sheet`**
(generación de una hoja de sprites), y `qa/run.mjs` lo dio por **verde**.

`grep gasta qa/run.mjs` → **0**.

**Corrección medida hoy al cuerpo del issue**: dice «los guiones 07, 15 y 21». Hoy son
**cuatro** — también el `32-nadie-nace-donde-no-cabe-su-cuerpo.mjs`. La cifra del cuerpo
caducó; el problema no.

### #296 — un preset sale rojo por un puerto que no es suyo

`qa/presets.mjs` comprueba el catálogo de puertos **antes de empezar** y no entre presets.
Durante la PR #294 eso produjo **6/7 con `playtest-motor` en rojo** por un puerto ajeno; la
corrida limpia dio 7/7. Se detectó porque quien lo causó sabía lo que había hecho — el caso
afortunado.

La ironía es el motivo: **el guion que valida el arranque del stack asume que hay un solo
agente en la máquina**, que es justo lo que la tanda #274/#271/#275 acaba de eliminar.

---

### #308 — el renderer inventa un cero que el banco se cree

**Entra en la tanda tras la crítica**, y no por conveniencia: es el mismo defecto.

`nefan-html/src/renderer/fps-renderer.ts:255-264`:

```ts
debugState(): Record<string, unknown> {
  return {
    ready: this.gl !== null,
    surfaces: [...this.surfaces.keys()],
    telegraph: null,
    veil: null,
    pitchDeg: 0,                      // ← inventado
    ...(this.gl?.debugState() ?? {}),
  };
}
```

Con `this.gl === null` el spread no aporta nada y `pitchDeg` se queda en el literal `0`.
`mirarA` (`qa/guiones/22-telegraph-ensena-el-borde.mjs:70`) lee **exactamente ese campo** y
concluye que la cámara mira al horizonte. El real lo calcula en `fps-gl.ts:1552`.

Resultado: el guion 22 es intermitente, **4 rojas de 6** sobre el árbol limpio.

Es una violación de la regla de fail-loud del propio `CLAUDE.md` («nunca `return null`
silencioso, nunca `return []` cuando hubo un error») y es la tesis de esta tanda dicha en
otro fichero: **el aparato reporta un número que no conoce**. Sin él, el criterio 3 es
inalcanzable y su primer fallo se le imputaría a esta tanda.

---

## 4 · Criterios de aceptación

Reescritos tras la crítica. Los dos primeros **nacían verdes** y así lo dice cada uno.

1. **El typecheck cubre `labs/`, y una divergencia de contrato en el motor falso rompe la
   compilación.** Verificable: introducir a mano en el fake un campo que el contrato no
   tenga (o quitarle uno que sí) y comprobar que **el typecheck falla**, en local y en CI.
   *Redacción anterior, descartada por el crítico: «renombrar `surface_model` y comprobar
   que el banco falla» — **nacía verde por la puerta de atrás**, porque ese renombre rompe
   hoy `nefan-html` (`dev-status-panel.ts:8` importa el tipo) sin que el fake se entere.*

2. **Las líneas que el fake copia de `http-server.ts` desaparecen, incluidas las dos que
   midió QA.** No basta con importar `readStyleFile`: eso cierra 2 de los 4 desvíos de
   #280, y deja copiados justo los otros dos — la **barra final** (`http-server.ts:82-85`)
   y el **`Content-Length`** (`:237-241`). Verificable: los cuatro casos de la tabla de
   #280 (`cover%2Ejpg`, barra final, `Content-Length`, fichero-punto) los resuelve **código
   compartido**, no una segunda copia. El crítico midió que esas 11 líneas no tocan sqlite:
   son extraíbles.

3. **La batería da el MISMO veredicto que la línea base, medida ANTES de tocar nada.**
   No «37 en verde»: con #308 dentro la meta es 37/37, pero la línea base se mide primero y
   se escribe, porque este es el criterio que impide que el arreglo rompa el aparato que
   arregla.

4. **Un guion que puede disparar generación no corre sin que el runner haya comprobado el
   guardarraíl, y olvidarse de declararlo no acaba en verde.** Verificable reproduciendo la
   medida de QA: un guion sin declaración, contra un backend que dice `fake:false`, sale
   `⊘ SIN MEDIR` y hace **cero** peticiones a ese backend.
   *Hoy: sale verde tras mandar 7 peticiones, una de generación.*

5. **Las CUATRO copias del prólogo desaparecen** (guiones 07, 15, 21 y 32 — el cuerpo de
   #295 dice tres, y la cuarta llegó *después* de abrirse el issue) y la obligación vive en
   el runner.

6. **Un ocupante ajeno en un puerto del catálogo a mitad de corrida no se le imputa a
   ningún preset**: `qa/presets.mjs` lo nombra, dice de quién es si puede (`port_owner` ya
   existe en `start.sh`) y marca la corrida como no concluyente.
   *Hoy: sale rojo el preset que no lo hizo — reproducido en la PR #294.*

7. **El renderer deja de publicar lo que no sabe** — y esto se separa de la intermitencia,
   porque lo segundo cambió bajo los pies mientras se escribía la tanda.

   (a) `debugState()` no publica un valor que no conoce, y **el tipo lo hace inexpresable**
   (unión discriminada por `ready`), no solo prohibido.
   (b) El guion 22 sigue **6 de 6 en verde**, que es donde ya está.

   *Medido por mí sobre `abaa3d9` antes de tocar nada: batería **37/37 EXIT=0**, y guion 22
   en solitario **6 de 6 en verde**, las seis con el discriminador de #308 en su fila buena
   (`−30.00°`, borde `y:413`). #308 dice «4 rojas de 6», pero se reprodujo sobre `cc3cd54`,
   **antes de que mergeara `55ad470`**.*

   **El cero inventado NO es la causa de la intermitencia**, y hay que decirlo en vez de
   apuntarse el mérito: el arquitecto midió que por el camino del guion 22 `cargarTile` ya
   exige `f.ready`, así que `mirarA` nunca llega a leer ese cero. Se arregla porque es un
   fail-loud roto y es la tesis de la tanda, no porque estabilice nada.

   Queda una pregunta abierta y **no se cierra inventándole una respuesta**: si la
   intermitencia la mató `55ad470` o si la reproducción original no era en solitario. La
   medida barata la propone el plan (`git checkout cc3cd54 -- nefan-html/src/main.ts`,
   reiniciar el cliente, seis corridas). La hace QA, es opcional y no bloquea; si nadie la
   paga, #308 se cierra **con las dos hipótesis escritas en el issue**.

8. **Los dos candados acotados a `labs/**/*.mjs` siguen mirando el fichero después del
   renombre** (`nadie-inventa-un-puerto`, `solo-se-mata-el-puerto-propio`;
   `arch-rules.json:492` y `:507`). Verificable en negativo: meter un puerto literal en el
   fake convertido y comprobar que el checker se pone rojo.

9. **Nada de esto gasta créditos ni al arreglarlo ni al verificarlo.**

---

## 5 · Orden de trabajo (impuesto por la crítica)

Son **dos trabajos**, no cuatro, y el orden no es opcional:

| Grupo | Issues | Por qué juntos |
|---|---|---|
| **B** | #295, #296, #308 | El runner y sus precondiciones. `⊘ SIN MEDIR` es el veredicto compartido; #308 devuelve la batería a un veredicto estable. |
| **A** | #309, #280 | Un solo trabajo: conversión + arranque + typecheck de `labs/`. Separarlos paga el cableado dos veces. |

**B primero, A al final.** A cambia *cómo arranca el stack* del que depende la batería: si se
hace antes, se pierde la referencia para saber si algo se rompió. Y la línea base se mide
antes de tocar nada.

---

## 6 · Restricciones

- **No matar procesos ajenos.** Hay otras instancias de Claude trabajando en esta máquina.
  Nada de `pkill node`/`vite`/`python`, ni matar por puerto lo que no se arrancó. Si un
  puerto está ocupado, se dice de quién es y se sale.
- **Pre-producción: cero compatibilidad hacia atrás.** Si el fake pasa a `.ts`, el `.mjs`
  se borra el mismo día, entero, y `start.sh` deja de nombrarlo. No queda una vía vieja.
- **No regalarle al banco una dependencia de la caché global de npx** (ver §3): si el fake
  pasa a `.ts`, su arranque tiene que resolver `tsx` desde una dependencia declarada.
- **Verificación barata**: el comando más barato que demuestre lo que toca. Mutación
  acotada al módulo, nunca la corrida entera por rutina.
- El veredicto `⊘ SIN MEDIR` **ya existe** en `qa/run.mjs` (mecanismo `aisla`/`aislar()`,
  líneas 504-540) y los dos issues que lo necesitan piden explícitamente reutilizarlo. No
  se inventa un veredicto nuevo.

---

## 7 · Lo que NO es esta tanda

- No es corregir `scene_model` → `surface_model` y cerrar #309. Eso es el síntoma, y su
  propio cuerpo lo descarta como cierre.
- No es escribir un test de paridad que vigile la copia de #280. Su cuerpo lo descarta con
  razón: «es más código persiguiendo el mismo problema, y solo cubre los casos que a
  alguien se le ocurran — exactamente los cuatro que no se le ocurrieron».
- No se toca `game-emulator.mjs` ni `replay-server.mjs` salvo que el cambio los rompa.
- No se abre el melón de #271/#274 (puertos por instancia). El crítico verificó que §7 es
  sostenible: `presets.mjs` arranca los ocho presets, y `start.sh:1044-1056` **se niega** a
  arrancar ai_server/remote-gen/narrative-mcp/sprite-forge con offset ≠ 0, así que
  `presets.mjs` vivirá siempre en el bloque base pase lo que pase con el catálogo. Nombrar
  al ocupante ajeno es la verdad residual, no un provisional que haya que rehacer.

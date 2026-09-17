# Crítica — Tanda K «El cliente se puede probar»

**#543 REENCUADRADA · #636 REENCUADRADA · #555 REENCUADRADA · #654 VIGENTE (y el candado, declarado imposible).**

Medido sobre `main` = `81735f13`, árbol `/home/al/code/ne-fan-k-cliente`. Cero créditos, cero servidores.

## El problema real, en una frase por issue

- **#543**: no es «nadie sabe por qué el guion 80 se pone rojo» — el mecanismo está escrito desde el 2026-09-10 en #496, con el mismo contador, y **sigue vivo en el código**.
- **#636**: no es «el cliente no se puede probar» —59 de 72 módulos ya se importan en Node hoy— sino **qué del cliente merece prueba unitaria**, que es una decisión que nadie ha escrito.
- **#555**: los doce ids siguen ahí, pero el motivo de urgencia («antes de que empiecen a moverlos») ya caducó: los movieron y no se rompió nada.
- **#654**: dos líneas de arreglo, y la pregunta del candado ya está contestada en el `why` de la propia regla.

## La premisa, afirmación por afirmación

### #543 — la premisa que se cae, y el número que la tumba

| Afirmación del issue | Verificación |
|---|---|
| «`atomos.ts` lanza al importarse en Node» | **CIERTA**. `atomos.ts:144` y `:148`; medido: los 11 módulos del título fallan con `location is not defined` |
| «lo importan las siete hojas» | **CIERTA y CORTA**: hoy son **nueve hojas + el enrutador**; `ui/titulo/` tiene 10 ficheros y `ui/title-screen.ts` cae con ellos |
| «no hay mecanismo que explique el rojo del guion 80» | **FALSA**. #496, comentario del **2026-09-10** (un día DESPUÉS de escribirse #543): «batería completa `4 → 5` ✘ · `run.mjs 79 80` `5 → 5` ✔ · `run.mjs 80` aislado `1 → 1` ✔». Es **el mismo contador exacto** que cita #543 (`errores 4 → 5`), sobre **código sin tocar**: el 79 le deja cuatro entradas heredadas a una página sin sesión y el aserto del bloque 3 mide en una ventana de dos frames |
| «la versión perezosa cambia el comportamiento» | **NO PUEDE cambiar el valor**: `resolveServiceUrl` es pura (`service-registry.ts:113-122`), `envFromQuery` solo lee `location.search`, y en todo `nefan-html/src` hay **0** `pushState`, `replaceState`, `location.href =` o `location.replace` — la URL no muta nunca en vida de la página. Perezoso y ansioso devuelven el mismo string siempre |
| «rojo 2 de 2 / verde 93/93» | **N = 2 contra N = 1** sobre un guion cuya tasa base de rojo en batería completa está medida (#496: 2 rojos y 3 verdes sobre el mismo código en el hermano 75). No distingue una regla de su contraria |

Y la causa raíz **sigue puesta**: `StateUpdateMessage` (`nefan-core/src/protocol/messages.ts:296-341`) **no lleva `sessionId`**, y el cliente no lo filtra (`net/game-client.ts:116`), mientras `narrative_event` y `narrative_status` sí se filtran desde #282 (`net/narrative-client.ts:98`). La entrada extra la emite `world/lo-que-manda-el-bridge.ts:53`. **#496 se cerró el 2026-09-16 sin arreglarlo**; el sitio vivo donde eso está anotado hoy es **#634**.

### #636 — la premisa está exagerada, y el número lo dice

Medido hoy importando en Node los 72 `.ts` de `nefan-html/src` con `tsx`:

```
IMPORTABLES EN NODE: 59/72
fallan: los 11 del título (location is not defined, todos vía atomos.ts)
        main.ts y world/fixtures-del-selector.ts  ::  import.meta.glob (solo Vite)
```

- «no se puede empezar» → **falso**: el banco puede aterrizar hoy sobre cualquiera de 59.
- De los cuatro candidatos que nombra el issue, **dos son alcanzables ya** (`ui/modos-de-graficos.ts`, `ui/hud-de-combate.ts`), **uno necesita #543** (`ui/titulo/*`) y **uno necesita un sustituto de `import.meta.glob`** (`world/fixtures-del-selector.ts`). Son tres trabajos distintos, no uno.
- «no declara script `test`» → **cierta**: `nefan-html/package.json` tiene `dev·build·lint·format`. Core corre `node --import tsx --test`, sin vitest ni jsdom: el banco barato es el mismo runner, no una dependencia nueva.
- **Restricción que el issue no ve y hay que respetar**: `el-cliente-no-alcanza-node-ni-a-traves-del-core` tiene `files: ["nefan-html/src/**/*.ts"]` **con `cierre`** (se deriva del grafo). Un `*.test.ts` bajo `src/` que importe `node:test` **viola el candado**. El banco no puede vivir en `src/`.
- El job `nefan-html` de `ci.yml:96-114` ya existe y ya instala las deps del core: meter el `npm test` ahí es una línea.

### #555 — recuento mecánico de hoy

Censo automático (quién escribe cada `id=`/`class=` contra quién lo lee, sin contar prosa): **12 parejas cruzadas, 12 de 12 vivas, ninguna nueva**. Una **cambió de dueño**: `#ts-gen-progress` ya no es del selector sino de `ui/titulo/panel-de-generacion.ts`, nacido el **2026-09-14** (`6892fd54`) — la fila del issue está obsoleta.

«6 sin red» hay que decirlo en dos lecturas, porque la del issue mezcla dos cosas:

- **Que algo se ponga rojo si se renombra**: hoy **2 de 12 no lo tienen** (`#ts-columns` y `#ts-actions`: cero guiones los nombran). Las otras diez las nombra algún guion (`#ts-worlds` → 122/100/108, `#ts-rendermode` y `#ts-charmode` → una docena, `#ts-create-world` → 94/39/92/96/99…). Eran seis; la mejora es real y es de las tandas del 10 al 16 de septiembre.
- **Que la COSTURA esté atada** (que el id que escribe `chasis.ts` sea el que pinta el selector): **1 de 12**, el prefijo «Bridge OK» del guion 101 — y ni siquiera es un id. Un guion que rompe porque pulsó `#ts-rendermode` fuerza a mirar, pero el ingeniero arregla el guion y el `<style>` de `chasis.ts:112-120` se queda rancio en silencio. Esa lectura NO ha mejorado.

Lo que sí se cayó es el **argumento de urgencia**: #513, #536, #425 y #537 —los cuatro aterrizajes que el issue quería adelantar— **están los cuatro cerrados** (14, 10, 10 y 10 de septiembre), el título se ha tocado en **11 commits** desde el 2026-09-09, un id cambió de módulo… y no se rompió nada. Lo que lo sostuvo fue prosa (`chasis.ts:41-51`, `panel-de-generacion.ts:28-29`), no suerte, pero prosa.

### #654 — la premisa es exacta

`main.ts:514` es `const size = 0.5; // TILE_MPC`; `renderer/fps-gl.ts:35` ya importa `TILE_MPC`; la regla tiene `nefan-html/src/**/*.ts` en `files` y aun así no lo caza porque busca los cuatro identificadores. Todo cierto. **Y el candado no sale honesto**: en TODO el repo hay **exactamente un** comentario delator con esa forma —éste—, así que una regla sobre el comentario **nace sin sujeto vivo** el mismo día en que se arregla la línea (lección 3, y N = 0). El suelo de falsos positivos está a la vista en `dev/nefan-hook.ts:214-217`, cuatro `0.5` que son media celda de sondeo y que un regex sobre `0.5` cazaría. El `why` de la regla ya lo dice: «cazar `0.5` cazaría media geometría del repo».

## El día después

- Con #543 hecho, **11 módulos más entran en Node** y el título deja de ser una isla; nada cambia para quien juega. Si el rojo del 80 vuelve a salir, el dueño es #634, no `atomos.ts`.
- Con el banco de #636, se hace **revisable** una regla que hoy se cumple por carencia. Lo que se cierra: deja de haber excusa para empujar a core presentación que es presentación (la causa C de la tanda F). Lo que nadie borrará: los guiones de navegador que un unitario deja redundantes — si nace un unitario para algo que ya mide el 33 o el 98, hay que decir cuál muere.
- #555, resuelto con constantes compartidas, **le devuelve exports a `atomos.ts`** y ése es justo el disparador 1 escrito en su cabecera («el export nuevo entra con UN SOLO dueño»). Quien lo haga tiene que recontar el censo de 9 de 17, no creérselo.
- Dentro de un mes, lo que parecerá arbitrario es un banco con dos tests: si nace, tiene que nacer con la frase escrita de qué se prueba en el cliente y qué no.

## Conflictos

- **#543 ↔ #634 (dependencia oculta, no bloqueo)**: el rojo que #543 usa como prueba es de la familia de #634. Medir #543 con la batería completa vuelve a mezclar las dos cosas. El protocolo correcto ya está escrito en #496: `run.mjs 79 80` y `run.mjs 80` aislado.
- **#636 ↔ `el-cliente-no-alcanza-node-ni-a-traves-del-core`**: contradicción si el banco vive en `src/`.
- **#555 ↔ #636 (solapamiento que paga dos veces)**: el candado que #555 pide —«la unión de ids escritos contra los leídos»— es **un test unitario en Node de dos módulos del título**, en milisegundos. Hacerlo antes que #543+#636 obliga a inventar una regla de arquitectura sobre cadenas o un guion de navegador; hacerlo después sale gratis y estrena el banco con un sujeto que no es de juguete.
- **#654 ↔ nada.** No solapa con ninguno de los 48.

## Coste contra valor

- **#543**: barato ya (el cambio está escrito y probado; lo que falta es re-medir con el protocolo bueno). Si no se hace nunca, el 15 % del cliente queda fuera del banco para siempre. **Se hace.**
- **#636**: el banco + un primer sujeto cabe en una tanda; **no es programa**. Lo caro no es la infraestructura, es la frase «qué se prueba en el cliente». Si sale «nada», también vale, pero se escribe y se canda.
- **#555**: no hacerlo hoy cuesta poco (dos ids sin red, y la prosa aguantó cuatro aterrizajes). Hacerlo hoy *sin* banco cuesta inventar un candado. **Entra como sujeto, no como issue propio.**
- **#654**: dos líneas contra un número copiado a mano en el fichero más mirado del cliente. **Se hace; el candado no.**

## Qué cambiarle a `requisitos.md`, frase a frase

1. Donde dice «**#636 es el techo y #543 es lo que lo sostiene**», poner: «#543 no bloquea el banco: **59 de 72 módulos del cliente ya se importan en Node hoy**. Lo que #543 bloquea son los **11 del título** (nueve hojas + `atomos.ts` + el enrutador), y `main.ts` y `world/fixtures-del-selector.ts` quedan fuera por `import.meta.glob`, que es otro problema.»
2. Donde dice «**y una de las razones por las que no se puede empezar está medida**», poner: «se puede empezar hoy; la razón medida es **por dónde NO** empezar.»
3. En la fila de #543 de la tabla, sustituir el estado por: «**VIVO, y su bloqueo tiene mecanismo desde el 2026-09-10**: #496 midió el mismo contador `4 → 5` sobre código sin tocar.»
4. Sustituir entero el bloque «**El bloqueo que ya está escrito y hay que respetar**» por: «El bloqueo **ya no es un misterio**. `serviceUrl` es puro y la URL de la página no muta nunca (0 `pushState`/`replaceState` en el cliente), así que perezoso y ansioso devuelven el mismo string. El rojo `errores 4 → 5` del guion 80 es la firma documentada de **#496** (causa raíz viva: `state_update` sin `sessionId`, `messages.ts:296-341`), cuyo dueño hoy es **#634**. Lo que esta tanda tiene que hacer es **re-medir con el protocolo de #496** —`node qa/run.mjs 80` aislado y `node qa/run.mjs 79 80`, tres corridas de cada— y meter el cambio si el rojo aparece igual **sin** el cambio. Sigue prohibido meterlo a ciegas: prohibido es sin medir, no sin explicar.»
5. En «Lo que el crítico tiene que decidir», punto 1, dejar escrito el veredicto: «**cabe en una tanda**: banco mínimo fuera de `src/` (el candado `el-cliente-no-alcanza-node-ni-a-traves-del-core` cubre `nefan-html/src/**` con cierre), `npm test` en el job `nefan-html` de `ci.yml:96`, y **un primer sujeto**. No es programa.»
6. Punto 3, sustituir por: «#555 **no entra como issue propio**: entra como **el primer sujeto del banco**, después de #543. Cifras corregidas: **12 de 12 parejas vivas**, `#ts-gen-progress` cambió de dueño al selector→`panel-de-generacion.ts` (2026-09-14), **2 sin ningún guion que las nombre** (`#ts-columns`, `#ts-actions`) y **1 de 12 con la costura atada** (guion 101). El argumento de urgencia del issue ha caducado: #513, #536, #425 y #537 están cerrados.»
7. Punto 4, sustituir la pregunta por la respuesta: «**No se amplía la regla.** Hay **un solo** comentario delator en todo el repo, así que un candado sobre él nace sin sujeto vivo, y `dev/nefan-hook.ts:214-217` enseña el suelo de falsos positivos de `0.5`. Se arregla `main.ts:514` importando `TILE_MPC` y se añade al `why` de `la-fisica-no-se-copia-a-mano` **esta instancia con su fecha**, diciendo que el cliente está en `files` y la regla aun así no la cazó.»
8. En «Lo que la tanda NO debe hacer», añadir: «**No medir #543 con la batería completa.** Mezcla su rojo con el de #634 y devuelve el mismo callejón del 2026-09-09.»

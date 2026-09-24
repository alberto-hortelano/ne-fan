# Requisitos — tanda AY: El lint del banco completo y el reloj muerto del 07 (#744 #745 #734)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye. Si un issue resulta obsoleto o ya resuelto, se dice con evidencia y se cierra: también cuenta.

## Los issues, verbatim

### #744

> eslint no mira labs/**/*.{js,mjs} (14 ficheros)
> 
> Desde #733, `npm run lint` revisa `qa/**/*.mjs` con `no-unused-vars`, y desde #718 ruff revisa `labs/**/*.py`. Los 14 ficheros `.js`/`.mjs` de `labs/` siguen sin ningún lint (medido el 2026-09-24). Los `.ts` ya tienen `typecheck:labs` (#309).
> 
> Propuesta: extender `eslint.qa.config.js`, o una config hermana, a `labs/**/*.{js,mjs}` con la misma regla. Antes de encenderla, medir cuántos hallazgos da y clasificarlos uno a uno, como en la tanda AU.
> 
> Sale de la tanda AU (#733 y #718).

### #745

> qa/: encender no-useless-assignment y preserve-caught-error (42 hallazgos hoy)
> 
> Tras #733, el banco solo pasa `no-unused-vars`. Medido con `recommended` el 2026-09-24:
> 
> - 38 `no-useless-assignment`
> - 3 `preserve-caught-error`
> - 1 `no-irregular-whitespace`
> 
> Por qué importan:
> - Una asignación que nadie lee en un guion puede ser el resultado de una espera que se descarta, que es la familia de #356.
> - Un `throw` dentro de un `catch` sin `cause` pierde la causa del rojo.
> 
> Propuesta: clasificar los 42 uno a uno, limpiarlos y añadir las reglas a `eslint.qa.config.js`, con una siembra por regla en el guion de lint del banco.
> 
> `no-undef` se queda fuera a propósito: da 3250 hallazgos, porque los cuerpos de `page.evaluate` usan globals del navegador.
> 
> Sale de la tanda AU (#733).

### #734

> El sello Date.now() del guion 07 no lo lee nadie: reloj muerto declarado en el padrón
> 
> **«El sello de pared del guion 07 no lo lee nadie»**. `peticiones.push({ t: Date.now(), … })` en `qa/guiones/07-npc-clave-del-skin.mjs:57,59`: ningún aserto usa `t`. Retirarlo baja el padrón de relojes en 2 y deja 07 fuera.
> 
> Sale de la tanda AO (#711).

## Correcciones del crítico (aceptadas por el coordinador)

> **#745 — corrección del crítico.** Hoy son **47**, no 42: 43 `no-useless-assignment`, 3 `preserve-caught-error` y 1 `no-irregular-whitespace`. #757 añadió 5 el mismo día. Los 43 son, sin excepción, el valor inicial de un `let x = …` que un `try` sobrescribe antes de leerlo: **ninguno es una espera descartada**, y la regla se enciende como prevención. El `no-irregular-whitespace` de `qa/dos-corridas.mjs:10` es un U+200B puesto a propósito para que `*/` no cierre el comentario: no entra en esta tanda. La cifra que vale es la de HEAD tras el rebase.
>
> **#744 — medido.** Con `no-unused-vars` salen 3 hallazgos, todos en `labs/authoring/three/escena.js` (`:84`, `:503`, `:512`); los otros 13 ficheros están limpios. El guion 176 (A) y `el-lint-del-banco-salta-lo-que-el-banco-salta.test.ts` miden SOLO `qa/`, y así tienen que seguir.
>
> **#734.** Además del padrón, cambia el censo de `test/el-reloj-de-pared-tiene-padron.test.ts:155` (31→29 relojes, 11→10 guiones).

## Criterios de aceptación

Los fija el crítico en critica.md a partir de los issues (sección «Criterios de aceptación»; el coordinador los acepta tal cual). Mínimos: lógica en nefan-core (el cliente solo pinta); negativos probados en rojo; guion de QA ejecutable si hay algo observable; cero créditos (motor falso, `e2e-sin-creditos`).

## Restricciones

- **Números de guion RESERVADOS para esta tanda: 186-189.** Hay otras tandas en paralelo; no uses otro número.
- Contexto de hoy: `NEFAN_ENTORNO` (#757) decide si lo automático paga arte (desarrollo: solo restaura; el banco mide en producción contra el motor falso).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node` (v26).

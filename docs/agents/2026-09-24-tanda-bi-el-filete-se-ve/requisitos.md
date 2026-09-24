# Requisitos — tanda BI: el filete de botones y paneles llega a 3:1 en los cinco packs (#758)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

## Decisión del usuario (AskUserQuestion, 2026-09-24)

«#758 … ¿Qué hacemos?» → **«Subir el border de los packs (Recomendado)»**: se sube el token `border` hasta 3:1 contra `surface` en los 4 packs; `ui-theme.test` lo exige; los filetes se verán más marcados en toda la UI.

## El issue, verbatim

> La silueta de los botones .nf-action no llega a 3:1 en 4 de 5 packs (border/surface 1,6–2,1)
> 
> Sale del plan de la tanda BA (#748), medido el 2026-09-24 con los tokens de cada pack.
> 
> - El filete de los botones `.nf-action` contra `surface` da entre 1,6 y 2,1:1 en 4 de los 5 packs. WCAG pide 3:1 para componentes de interfaz.
> - Subirlo cambia el filete de todos los paneles, así que es una decisión de dirección de arte y no un arreglo mecánico.
> - En el mismo tema: el detalle de los muros usa `ink_dim` con el umbral de 3:1, que es el de texto grande.
> 
> **Decisión pendiente del usuario:** subir el `border` de los packs, o aceptar que la silueta del botón la da el relleno o el texto y no el filete.
> 
> **Criterio:** `ui-theme.test.ts` mide `border/surface` en los cinco packs con el umbral elegido.

## Criterios de aceptación

1. `border/surface ≥ 3` en los cinco packs, exigido por `ui-theme.test.ts` (negativo: un pack por debajo → rojo).
2. El `ink_dim` usado como texto normal en los muros cumple el umbral de texto normal (4,5) o se documenta por qué es texto grande — decisión medida, no a ojo.
3. Crítica visual de director de arte de los cinco packs (título, HUD, muros, panel P) con capturas: el filete más marcado no puede romper la identidad del pack; si un pack pierde carácter, se dice y se propone el matiz (hue del border) sin bajar de 3:1.
4. Guion en 226-229 si hace falta medir en el navegador; si `ui-theme.test` basta, no.

## Restricciones

Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`. Cero créditos.

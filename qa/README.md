# qa/ — guiones de QA ejecutables

El rol `qa` (`.claude/agents/qa.md`) valida contra la petición ORIGINAL desde el punto de vista de
quien juega. Buena parte de ese trabajo es juicio —crítica visual, fricción, estados sin salida,
la regla del workaround— y no se automatiza. Pero la otra parte sí: *"el jugador camina hasta ahí
y no atraviesa el muro"* es una afirmación que o se vuelve a comprobar a mano cada vez, o queda
como prosa que alguien tiene que creerse.

Esto es lo segundo: **guiones que conducen el juego real y devuelven verde o rojo**.

```bash
node qa/run.mjs                  # todos
node qa/run.mjs colision hud     # los que casen con esos nombres
node qa/run.mjs --headed         # con ventana, para mirar qué hace
node qa/run.mjs --keep           # deja el stack arriba al terminar
node qa/run.mjs --url http://…   # contra un stack ya arrancado
```

Si no hay nada en `:3000`, el runner levanta el **preset 5** (`./start.sh --preset 5`:
fake-ai-server + bridge + cliente) — cero créditos. Las capturas quedan en `qa/capturas/`.

## Cómo se escribe un guion

Un fichero en `guiones/` que exporta `async (ctx) => {}`. El contexto ofrece:

| | |
|---|---|
| `ctx.nefan(path, ...args)` | llama o lee `window.__nefan.<path>` |
| `ctx.waitFor(desc, fn, ms, arg)` | espera a que `fn` (en la página) devuelva algo truthy |
| `ctx.holdUntil(key, desc, fn, ms, arg)` | mantiene una tecla hasta que se cumple `fn`, y la suelta siempre |
| `ctx.expect(desc, cond, detalle)` | apunta un criterio; los fallos deciden el veredicto |
| `ctx.shot(label)` | captura a `qa/capturas/` |
| `ctx.page` | la página de Playwright, para lo que no cubra lo anterior |

Reglas que hacen que un guion valga algo:

1. **Nunca esperes por tiempo de pared.** El movimiento va por delta de rAF y el typewriter por
   `setInterval`: ningún `sleep` es determinista. Espera por ESTADO (`waitFor`). Los `maxMs` son
   cortafuegos, no la condición de parada.
2. **Nunca leas píxeles.** Los asserts van contra `window.__nefan`; las capturas son para que un
   humano las mire, no para decidir el verde.
3. **Entra por el camino del jugador.** Cerrar el título es pulsar `#ts-close`, no `display:none`;
   viajar es pisar la zona *y confirmar*, no teletransportarse. Si para ver algo hay que forzar el
   estado, eso es un hallazgo, no un paso de la receta.
4. **Prueba el guion en negativo.** Rompe a mano lo que dice verificar y comprueba que se pone
   rojo. Un guion que no detecta nada se ve exactamente igual que uno que funciona.

## Los guiones sembrados

| Guion | Qué protege |
|---|---|
| `01-arranque-y-fixture` | El flujo real desde el título (el estado donde más regresiones se cuelan) y que el game loop corre de verdad en headless |
| `02-colision-desde-huella` | La colisión sale de la huella declarada, nunca de los píxeles |
| `03-hud-de-ataques` | El HUD se genera desde el catálogo del sistema de combate de la sesión |
| `05-terreno-desde-ground` | El suelo declarativo (`ground`) se rasteriza al grid y de ahí sale la colisión — incluido un tile generado EN VIVO al explorar, no el snapshot de pre-generación |
| `06-solidos-de-la-leyenda` | `solid_chars` y `{name, solid:false}`: el jugador cruza el río por el puente y rebota contra el agua; declarar el agua vadeable le abre el paso |
| `07-npc-clave-del-skin` | `role`/`style_ref`/`description` sobreviven a `formatDToWorld`, y partida y batch de estilo derivan la MISMA clave de caché (si divergen, el skin se paga dos veces) |
| `11-un-solo-contexto-webgl` | La pestaña abre UN contexto WebGL y solo uno (criterio central de "solo la vista 3D"): se cuenta envolviendo `getContext` antes de cargar la app, no leyendo imports |

Los guiones que necesitan una PARTIDA real (no una fixture) comparten el arranque del
título en `qa/lib/sesion.mjs` — `qa/lib/` no lo recorre el runner, solo `qa/guiones/`.
`07` dispara generación de skins: se niega a correr si `?ai=` no apunta al fake-ai-server.

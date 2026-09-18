# Tanda O — «El canal sabe de quién es» (#659 + #673)

## La petición, literal

El mandato vigente lo dio el usuario el 2026-09-17 y sigue en pie:

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

Y hoy, 2026-09-18, al reanudar:

> «Seguimos, ya ha acabado la mutacion»

Decisión del usuario para HOY, tomada al abrir la jornada: **ciclo completo con fase de QA**. Ayer las
seis tandas fueron sin QA por el mandato de velocidad y eso quedó declarado como desviación; hoy se
restaura, porque QA es quien lleva ocho tandas cazando los candados que cubren menos de lo que prometen.

## Estado medido al abrir

- `main` = `900b5b71`, árbol limpio, un solo worktree.
- Batería sobre ese commit (medida anoche en el checkout principal, que SÍ tiene `labs/narrative/runs/`):
  **145 verde · 0 rojo · 1 ⊘ de 146**. El ⊘ es el guion 97, que es el caso sano por diseño.
- Backlog: **36 abiertos = 24 núcleo + 12 `futuro`**.
- Corrida de mutación **`35317748262`** lanzada hoy sobre `900b5b71` y EN VUELO. Sale COMPLETA (64 de 64
  módulos) y trae la primera medida de `estilo-refs`, `ui-theme` y `plugins-dispatcher`, que son los que
  cierran #514 y #462. **Una petición pendiente no bloquea nada**: esta tanda sigue.

## Los dos issues

### #659 — `state_update` no lleva `sessionId` y el cliente no lo filtra

Coordenadas que da el issue y que hay que **verificar antes de usarlas** (la casa ha pagado varias veces
por copiar un cuerpo de issue a un requisito sin medirlo):

- `StateUpdateMessage` sin `sessionId`: `nefan-core/src/protocol/messages.ts:296-341`.
- El cliente no lo filtra: `nefan-html/src/net/game-client.ts`, cero menciones de `sessionId`.
- Los otros dos canales sí, desde #282: `nefan-html/src/net/narrative-client.ts:99` (evento) y `:153`
  (status).
- `state_update` sale por `ctx.send(ws, …)` en `nefan-core/bridge/handlers/simulation.ts:131`, o sea
  como respuesta al tick del socket y **no en difusión**.

Lo que el issue afirma y hay que tratar como hipótesis hasta medirla: que ésta es la firma del guion 80
(«entradas heredadas a una página sin sesión»), y que la entrada extra la emite
`nefan-html/src/world/lo-que-manda-el-bridge.ts:53`.

**Protocolo de medida obligatorio, y viene con historia**: aislado y en par, **tres corridas de cada,
nunca la batería completa** — la completa mezcla esta causa con la de #634 y eso es lo que congeló #543
durante una semana. La regla que salió de ahí: *prohibido es sin medir, no sin explicar*.

Criterio de cierre del issue: `sessionId` en `StateUpdateMessage`, el cliente descartando el que no es
suyo igual que los otros dos canales, y el guion 80 dejando de heredar entradas del 79.

### #673 — el guion 15 se pone rojo 4 de 21 si su 17ª espera se conduce

Medido en la tanda N con el cambio puesto y quitado sobre el mismo commit: migrada da **rojo 4 de 21**,
la de siempre **0 de 11**. El rojo cae **siempre en `page.click("#ts-new")`, en el título**, tras la
pre-generación de las 9 escenas, y el cambio vive en `encarar()`, mucho después. **No se encontró la vía
causal** y por eso se deshizo, con la espera entrando como séptima exención en
`data/contract/esperas-por-fotogramas.json`.

Va con #659 **porque el propio issue nombra a #659 como su instrumento**: la firma —rojo en el título,
tras una pre-generación, con el cambio en otra parte— es la familia de #496/#659, y conviene descartarlo
antes que nada.

## Qué se pide a esta tanda

1. Arreglar #659 en los dos lados (protocolo y cliente) con el candado que impida la vuelta.
2. Con #659 puesto, **re-medir #673** por su protocolo: ¿sigue el rojo 4 de 21? Si desaparece, la
   exención se retira con el número y el issue se cierra; si sigue, se escribe qué se descartó y el issue
   se queda con una pregunta MÁS PEQUEÑA que la de hoy.

**No se pide** migrar la 17ª espera «a ver si ahora va»: eso es exactamente lo que el issue prohíbe. La
migración solo vuelve si la medida dice que el rojo se fue.

## Restricciones de la casa que aplican aquí

- Cero créditos: motor falso, `e2e-sin-creditos`, `html-fixtures`.
- Nunca `--parar-todo` ni `pkill` ni matar por puerto: hay otros agentes en la máquina. Solo
  `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` desde el propio worktree.
- Ningún umbral se baja, y ninguno se sube para acomodar lo que acaba de crecer.
- Pre-producción: cero compatibilidad hacia atrás. Si `sessionId` entra en el mensaje, entra obligatorio
  y lo que no lo mande se arregla el mismo día; no hay campo opcional «por los clientes viejos».
- Una retirada incluye prosa, comentarios y docs: `grep` a cero.

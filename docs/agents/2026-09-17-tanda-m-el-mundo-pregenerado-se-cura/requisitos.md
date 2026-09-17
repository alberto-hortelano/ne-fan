# Requisitos — Tanda M «El mundo pre-generado se cura»

## La petición

Cita literal del usuario (2026-09-17):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

## Los tres issues

Los tres son **lo que el jugador nota** y los tres salen del mismo sitio: un mundo pre-generado que se
sirve con algo roto dentro y **nadie lo cura**.

| Issue | Qué | Quién lo mide hoy |
|---|---|---|
| **#577** | El tile cribado de un snapshot **se paga en CADA partida nueva**: nadie lo cura en disco | El guion **127**, bloque E4, afirma `[1,1,1]` llamadas |
| **#578** | Una escena conservada puede apuntar a **un lugar que el mapa nuevo ya no nombra**: el panel «Salidas» se apaga | El guion 127, bloque E5 |
| **#463** | `GET /entity/player` **sin sesión responde 200 con un jugador fantasma**; `GET /story` responde 404: dos semánticas de «sin partida» para leer | — |

## #577 · el mecanismo, que ya está medido

Desde #451, una escena del ANILLO que no pasa el validador se **criba** al cargar el snapshot en vez de
tirar el mundo entero. Eso es lo que el usuario eligió y funciona. **Lo que no se cura es el FICHERO**:
`world/tile.json` conserva el tile roto para siempre, porque los dos únicos llamantes de
`writeSessionSnapshot` son el bootstrap vivo y `generate_game`, y **ninguno corre cuando el snapshot se
sirve bien**. Así que el tile cribado se regenera —una llamada al motor— en cada partida nueva.

**Con motor real eso son créditos**, una y otra vez, por un fichero que nadie arregla.

## Lo que el crítico tiene que decidir

1. **¿Quién cura el fichero y cuándo?** Escribir el snapshot al servirlo tiene el riesgo evidente: el
   camino de lectura pasa a escribir. Y escribirlo al cribar significa que **una partida modifica el
   mundo pre-generado de todas las demás**. Las dos tienen peaje; elige con medida y dilo.
2. **¿#578 es el mismo arreglo o es otro?** Los dos salen de la conservación parcial, pero uno es sobre
   el tile y otro sobre el mapa. Si comparten la pieza, van juntos; si no, dilo — **y no repitas mi
   error de la tanda I**, donde escribí que dos issues compartían la pieza que falta y la crítica lo
   tumbó midiéndolo.
3. **¿#463 entra?** Es de otra familia (semántica del State API sin sesión), pero es barato y observable.
   Verifica primero que sigue vivo: el issue es del 2026-09-05 y aquí los issues caducan en horas.
   **Cuidado**: «devolver 404 en las dos» parece obvio y puede romper a quien hoy lee el 200. Mira quién
   llama antes de decidir.
4. **¿Hay conflicto con el guion 127?** Ese guion afirma HOY que el tile **NO** se cura (`E4 · el tile
   cribado NO se cura en disco`). Si #577 se arregla, **ese aserto se invierte** — y el guion está
   además en rojo intermitente por otra causa (#656). Decide qué pasa con sus bloques E4 y E5.

## Restricciones

- **Cero créditos**: motor falso, `e2e-sin-creditos`. Este trabajo trata **precisamente** sobre no gastar
  llamadas al motor: no las gastes tú midiéndolo.
- **Bloque de puertos 1100**: `NEFAN_PORT_OFFSET=1100 ./start.sh --preset <slug>` desde el árbol
  `/home/al/code/ne-fan-m-mundo`, y `--parar` con el mismo offset desde el mismo árbol. **Nunca
  `--parar-todo`, nunca `pkill`, nunca matar por puerto.** Hay otros agentes trabajando en la máquina.
- Log de corrida larga: `bateria-m.log`.
- **Pre-producción: cero compatibilidad hacia atrás.** Si un formato se sustituye, se borra el mismo día,
  entero y en todos los procesos. La pregunta «¿y los saves viejos?» hoy se responde que no importan.
- Una retirada incluye prosa, comentarios y docs: `grep` a cero.
- Solo se commitean `requisitos.md`, `critica.md` y `qa*.md`.

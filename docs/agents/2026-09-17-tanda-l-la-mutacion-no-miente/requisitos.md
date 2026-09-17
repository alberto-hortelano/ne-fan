# Requisitos — Tanda L «La mutación no miente sobre lo que mide»

## La petición

Cita literal del usuario (2026-09-17):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

## Los cinco issues, y el hilo que los une

Todos son de **la herramienta que decide si los tests se enterarían de un cambio** — y los cinco dicen,
cada uno a su manera, que **el número que da puede no significar lo que parece**.

| Issue | Qué | Nacido |
|---|---|---|
| **#596** | Un módulo que no mide **ni un mutante** sale verde: `NaN >= break` es falso y Stryker sale con 0 | 2026-09-14 |
| **#598** | **1.122 mutantes en 43 ficheros que NINGÚN test ejerce**, con `place-target.ts` al **100 %** | 2026-09-14 |
| **#604** | La huella no guarda `Timeout` ni `NoCoverage`: comparar dos instrumentos depende de un directorio local que `traer` **vacía** | 2026-09-15 |
| **#605** | Trocear `scripts/mutacion.ts`: **1.692 líneas**, diez verbos, y **ninguna herramienta lo mide** — su deuda es cero *por construcción* | 2026-09-15 |
| **#462** | Nadie mide `src/plugins/dispatcher.ts` ni `loadSession`: el gate del inventario (#452) aterrizó a ciegas | 2026-09-05 |

**#596 ya tiene su número y son SEIS módulos, no uno**: `blueprint-volumenes` pierde **12 muertes** sin
que su break se entere; `contrato-sprite-forge` es el caso limpio (51/58 = 87,93 % ≥ 87); y
`plugins-dsl` es el extremo — pierde tres muertes y **el score no se mueve ni una centésima**, porque el
mutante sale del numerador y del denominador a la vez.

## Lo que el crítico tiene que decidir

1. **¿Cuáles de los cinco caben juntos?** #605 es un troceo de 1.692 líneas y puede comerse la tanda
   entera. Decide si va con los otros, si va solo, o si es un programa. Ojo al orden: trocear el fichero
   **mientras** se le cambian tres verbos es cómo se pierden los cambios.
2. **¿#598 es un issue o un programa?** «1.122 mutantes que ningún test ejerce» no se arregla escribiendo
   tests para 43 ficheros. Puede que lo vivo sea **saber decirlo** (que la herramienta distinga «no
   medido» de «medido y sobrevive») y que escribir los tests sea otra cosa. Si es así, dilo y **parte el
   issue**.
3. **¿#604 sigue vivo tal como está escrito?** Desde que se abrió, `comparar` ganó sus siete condiciones
   y `traer` sus guardias. Verifica si el agujero real es el que dice o si se ha movido.
4. **¿#462 entra?** Es de otra familia (dos módulos sin medida) pero se cierra con el mismo gesto:
   meterlos en `mutation-targets.json`. Verifica su coste — si no caben en el tope local, **necesitan
   corrida autorizada** y eso lo decide el usuario.
5. **Lo que NO se puede hacer**: bajar un suelo, ni subirlo para acomodar lo que acaba de crecer.

## Avisos medidos de la casa que aplican aquí

- **`repartir` corrido DOS veces da «0 nuevos» TAUTOLÓGICO**, porque la segunda compara contra la huella
  que escribió la primera. Pasó el 2026-09-16 y se corrigió restaurando la huella desde `HEAD`.
- **`local` NO escribe la huella**, así que un módulo medido en local sale «base de otro código» hasta la
  siguiente corrida.
- **Una primera medida no se puede hacer en local**: `permisoLocal` rechaza el coste desconocido. Un
  módulo nuevo nace `sin medir` por diseño.
- **Aplicar un mutante a mano y ver morir la batería ES evidencia**, pero solo de ESE mutante; el número
  lo sigue debiendo la corrida.
- El tope local es **120 mutantes**. `salida-del-solido` (90) cabe; `scene-normalize` (313) no.

## Restricciones

- **Cero créditos**. Ninguna medida de esta tanda necesita un servicio de pago.
- **Bloque de puertos 1000**: `NEFAN_PORT_OFFSET=1000 ./start.sh --preset <slug>` desde el árbol
  `/home/al/code/ne-fan-l-mutacion`, y `--parar` con el mismo offset desde el mismo árbol. **Nunca
  `--parar-todo`, nunca `pkill`, nunca matar por puerto.** Hay otros agentes trabajando.
- **No corras `npm run mutacion -- repartir`**: escribe la huella y destruye la base de comparación. Para
  mirar sin tocar está `comparar`, que es el mismo delta EN SECO.
- Log de corrida larga: `bateria-l.log`.
- Solo se commitean `requisitos.md`, `critica.md` y `qa*.md`.

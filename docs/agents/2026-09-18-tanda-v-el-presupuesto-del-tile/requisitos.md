## La petición, literal

El usuario, el 2026-09-18 (sesión nueva, `main` = `a25d8c2f`):

> «Mira los issues que hay en github y ve cerrandolos, si tienes alguna duda dejala apuntada para
> mas tarde y trabaja de forma autonoma con la estructura de agentes definida.»

Sigue en pie el mandato del 2026-09-17: «ve cerrando sin parar, si tienes bloqueo en alguno lo
apuntas pero sigue hasta reducir el numero al minimo».

Decisión del coordinador para esta jornada: **ciclo completo con fase de QA** (crítico → arquitecto →
ingeniero → QA), porque QA es quien lleva nueve tandas cazando los candados que cubren menos de lo
que prometen. El usuario no está mirando en tiempo real: las dudas se APUNTAN (en `requisitos.md`,
sección «Preguntas abiertas», con la suposición que se toma) y se sigue.

## Estado medido al abrir

- `main` = `a25d8c2f`, árbol limpio, un solo worktree, máquina en reposo (load 0,2).
- Backlog: **37 abiertos = 25 núcleo + 12 `futuro`**. Esta jornada abre 14 tandas EN PARALELO
  (S…AF) sobre los 19 issues de núcleo no bloqueados; las otras tandas tocan OTROS ficheros, pero
  dos pueden rozarse en `qa/README.md`, en `qa/run.mjs` y en la numeración de guiones (#680: el
  número de guion se elige al fusionar, no al escribir; hasta que la tanda U cande el prefijo
  único, un guion nuevo lleva el número que le toque en `main` EN EL MOMENTO DE FUSIONAR).
- Batería de navegador: NO medida hoy al abrir. Última conocida: 145 verde · 0 rojo · 1 ⊘ de 146
  sobre `900b5b71` (ayer por la mañana); desde entonces entraron los guiones 148 y 149. Quien
  toque `qa/` mide lo que toca, aislado y en par (tres corridas de cada) antes de la completa.
- Las dos últimas corridas de mutación (`35317748262` y `35354800866`) salen COMPLETAS con 0
  nuevos y **dos suelos rotos conocidos** (#675 `npc-director` 75,33 % < 81; #676
  `state-http-dispatch` 99,28 % < 100): el gate de mutación está en rojo por eso y no distingue
  un rojo nuevo. La tanda T los cierra.

## Restricciones de la casa que aplican a TODAS las tandas

- Cero créditos: motor falso, presets `e2e-sin-creditos` y `html-fixtures`. Nada que llame a
  Imagen IA ni al motor real.
- Nunca `--parar-todo`, nunca `pkill`, nunca matar por puerto: hay otros agentes en la máquina.
  Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` desde el propio worktree. **Gotcha vivo (#684)**:
  con offset ≥ 1000 `--parar` MIENTE («nada que parar aquí» con el stack en pie); por eso hoy los
  offsets se reparten entre 100 y 900. Si te toca uno ≥ 1000, para por PID demostrando propiedad
  con `/proc/<pid>/cwd`.
- Ningún umbral se baja, y ninguno se sube para acomodar lo que acaba de crecer.
- Pre-producción: cero compatibilidad hacia atrás. Lo que se retira, se retira entero el mismo
  día (`grep` a cero en prosa, comentarios y docs).
- Un candado nuevo se prueba EN NEGATIVO (se reintroduce el defecto y se ve el rojo) y se declara
  por escrito lo que NO cubre. Un candado headless nuevo entra en `candados-headless` el día que nace.
- El worktree se monta con la receta de `docs/agents/README.md` (los cuatro `npm ci`, el build de
  `nefan-core`, las hojas de sprites). El fichero de salida de una corrida larga lleva el nombre
  del worktree.
- Cada afirmación factual del issue se VERIFICA contra el árbol antes de usarse como requisito:
  los cuerpos citan `fichero:línea` que caducan en horas.
- No se commitea en `main` ni se fusiona nada sin que el coordinador lo pida; el ingeniero trabaja
  en su rama y commitea en ella.

# Tanda V — «El presupuesto del tile se mide, y las dos mitades del predicado dicen lo mismo» (#677 + #687)

## Los issues

- **#677**: once sitios esperan un tile del bridge; nueve presupuestan 240 s y dos 90 s
  (`MS_DEL_TILE` en `qa/lib/sesion.mjs`, guiones 120 y 127). Nadie ha medido cuánto tarda de
  verdad. Se pide la DISTRIBUCIÓN (no un caso) con el motor falso, en esta máquina; con ella UN
  presupuesto y su margen escrito, o dos números con su porqué donde se lean.
- **#687**: cuatro hallazgos menores de #656: H-3 las dos precedencias invertidas entre el
  predicado que PARA (`sesion.mjs`: llegado > fallo > rechazado) y el veredicto que JUZGA
  (`tile-episodio.mjs`: llegado > rechazado > fallo), y la mitad que para no la mide nadie; H-4 con
  `absorbe` el 127 quema 7 × 90 s bajo silencio real en vez de abortar en la primera; H-5
  `hook.tiles ?? []` degrada en silencio lo que el módulo puro fail-loudea 90 s después; H-7 un md5
  del informe que no casa (solo documental: se anota, no se arregla).

## Criterios de aceptación

1. Medida de cuánto tarda un tile del bridge en llegar al cliente con motor falso, en esta
   máquina, con N suficiente para hablar de distribución (mínimo 30 muestras; p50, p95, máximo),
   y cómo se midió (guion/script reproducible en `qa/`). La parte «en CI» y «con motor real» del
   issue queda FUERA (no hay runner de navegador en CI y el motor real gasta créditos) y se dice.
2. Con la medida: un presupuesto único para los once sitios con su margen escrito al lado
   (precedente `HOLGURA_DEL_TECHO = 1,25`), o dos con su porqué en el sitio donde se leen. Los
   once sitios se censan por el árbol, no por `grep` del número.
3. H-3: una sola precedencia, en un solo sitio, que usen las dos mitades; y que la mitad que
   PARA tenga quien la mida (o se declare por qué no).
4. H-4: decidido a propósito: ¿aborta en la primera o acaba diciendo la verdad? La decisión se
   escribe junto a `ctx.absorbe` y se canda si es mecánica.
5. H-5: el `?? []` desaparece o falla en voz alta en el momento en que el hook no publica `tiles`.
6. Batería aislada y en par de los guiones tocados (120, 127 y cualquiera que use `MS_DEL_TILE`),
   tres corridas de cada.

## Fuera de alcance

- #678 (los sockets que se cierran sin esperar): va en la tanda AF, que toca otros guiones.

## Preguntas abiertas

- Si la distribución medida dice que 90 s basta con margen, los nueve de 240 BAJAN, y eso no es
  «bajar un umbral» sino ponerlo por medida. Suposición: se aplica lo que diga la medida.

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

Aceptado sin consultar: corrige el censo (otros once, cuatro números) y la fuente del número (coste del cuelgue, no p95 del falso). Sustituye lo que nombra:


Sustituir «Los issues», el criterio 1 y el 2 por esto, tal cual:

**#677, corregido contra el árbol.** El sujeto «un tile del bridge» tiene ONCE esperas y CUATRO cortafuegos: 60 s (63:130-135, en el save), 90 s (120, 127 vía `MS_DEL_TILE`), 180 s (05:255, 42:210, `holdUntil` por frontera), 240 s (08:106, 09:92, 15:393, 74:139, 75:235, 144:164, por viaje). **Fuera del sujeto**: 115:175 (pago del batch de estilo) y `sesion.mjs:499/:541` (pre-generación de 9 escenas, un lote); se dejan como están y se dice.

1. Medida con motor falso (retraso 0 por defecto, `fake-ai-server.ts:120,:285`), N ≥ 30, p50/p95/máx, reproducible en `qa/`. Se escribe como **suelo** («un tile del falso llega en X s; el cortafuegos está a Y× de ahí»), no como fuente del número. Ya se sabe que está bajo 2 s (127 entera: 17-18 s con 7 esperas); la medida lo confirma con recibo.
2. **Un** cortafuegos para las once esperas, decidido por el coste del CUELGUE y escrito: esperas por guion × cortafuegos = minutos perdidos cuando el bridge calla, y qué sitios paran antes por estado (`viaje.error`, tres desenlaces) y cuáles no. Si quedan dos números, el porqué va donde se lee, y no es «lo midió el falso».
2b. Fuera de alcance, apuntado como issue: el 08, el 15 y el 74 no miran `viaje.error`; el viaje roto quema el cortafuegos entero (el MUDO de #656 en el camino del viaje).

H-7 se cierra sin trabajo: el recibo vive en un fichero gitignored que ya lo reconoce (`implementacion-656.md:442`).

Y en «Preguntas abiertas», retirar la suposición «se aplica lo que diga la medida»: la medida no puede decir 90 ni 240, dirá 2.

Decisiones del coordinador: (1) V fija la constante/los números y AF hereda: AF NO toca MS_DEL_TILE ni los presupuestos, solo los sockets; V NO toca el socket del 63. (2) El punto 6 (08:106, 15:393, 74:139 no miran viaje.error) lo abre el coordinador como issue aparte; no entra aquí. (3) H-7 se cierra sin trabajo, dicho en qa.md.

## Decisión del coordinador tras el plan (2026-09-18)
Plan adoptado tal cual (90 s únicos por coste del cuelgue; H-4 aborta en la primera expiración; H-5 preflight en node). El guion de medida SÍ entra en la batería completa. El 63 lo toca también la tanda AF en otras líneas (89-105): V fusiona primero. Offset propio para stacks: 400.

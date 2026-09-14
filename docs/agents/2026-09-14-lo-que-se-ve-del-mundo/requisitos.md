# Tanda C · «Lo que se ve del mundo»

## De dónde sale

Del triaje del backlog del 2026-09-10, cuyas doce decisiones contestó el usuario el 2026-09-14.
Su mensaje literal al entregarlas: **«Mutacion corriendo, decisiones respondidas»**.

Las respuestas están en `docs/agents/2026-09-10-triaje-del-backlog/decisiones.md` y se citan
literales abajo. **No se reabren**: el crítico verifica premisas y hechos del código, no vuelve a
plantear la elección.

## Qué entra

### 1 · #484 — los rótulos de nombre sobre el mundo (tres preguntas, tres respuestas)

Hoy las tres estaban «como está» **por omisión, no por decisión**.

1. **¿El rótulo de un enemigo se ve distinto del de un vecino?** Respuesta literal **«- R: a»** =
   **(A) sí, en `--nf-danger`** (el token ya existe). Hoy el HUD lo nombra en rojo pero su rótulo de
   mundo es la misma caja crema que la del tabernero: de lejos no sabes a quién puedes pegar.
2. **¿Un rótulo desaparece cuando el personaje está detrás de una pared?** Respuesta literal
   **«- R: c»** = **(C) se sigue viendo a través** — «te dice dónde está la gente del pueblo, y es
   gratis». **Ojo: esto es lo que el juego YA hace.** No es «no hacer nada»: es que el issue deja de
   pedir el test de oclusión por rótulo y frame, y la conducta pasa de omisión a **decisión
   escrita**, con lo que haga falta para que nadie la «arregle» dentro de tres meses.
3. **Dos rótulos alineados se pisan.** Respuesta literal **«- R: a»** = **(A) se oculta el más
   lejano** (barato), frente a (B) desplazarlos en vertical y (C) dejarlo.

### 2 · #478 — el bridge que llega tarde

Respuesta literal: **«- R: b»**, sobre estas opciones:

- (a) Que se arranque solo (relanzar el arranque al conectar). ~1 día.
- **(b) ELEGIDA** — «Que te lo ofrezca — el chip pasa a «Connected» y el muro da **«Reintentar»**.»
  ~medio día.
- (c) Solo la verdad — el chip deja de mentir y nada más.

Hoy: arrancas sin bridge, ves el muro, el bridge se levanta después, **el muro se retira solo** y te
quedas en el visor sin título, con el chip diciendo «Disconnected» con el socket abierto. La única
salida es recargar. (La mitad de «el chip deja de mentir» va en cualquiera de las tres: eso no era
elección.)

### 3 · #451 — un snapshot de 9 escenas con UNA injugable se tira entero

Respuesta literal: **«- R: b»**, sobre estas opciones:

- (a) Como hoy: se tira entero y se regenera desde cero.
- **(b) ELEGIDA** — «Se sirve la entrada y las 8 buenas, y solo se vuelve a pedir el tile malo.»
- (c) Se queda (a), pero el título dice el motivo.

## Criterio de aceptación (del jugador, no del código)

1. De lejos, **se distingue a quién puedes pegar**: el rótulo del hostil va en el rojo de peligro y
   el del vecino no.
2. Dos personajes alineados en la misma dirección **no producen dos rótulos pisados**: se ve el del
   cercano.
3. El rótulo **sigue viéndose a través de la pared**, y eso está escrito como decisión con fecha.
4. Arrancar sin bridge, levantarlo después y **poder entrar al juego sin recargar la página**, por un
   botón que lo ofrece; y el chip dice la verdad en todo momento.
5. Un snapshot con un tile injugable **sirve la partida igual** (entrada + tiles buenos) y solo
   vuelve a pedir el malo, en vez de sustituirlo por uno de una sola escena.

## Fuera de alcance

- Relanzar el arranque solo (opción (a) de #478, descartada).
- Oclusión de rótulos por geometría (descartada en la 4.2).
- #480 y #481 (el lienzo negro y el muro que se contradice): son del mismo vecindario pero no
  entraron en la decisión. Si el crítico ve que uno de los dos **cae gratis** dentro del trabajo,
  que lo diga y lo justifique; si no, se quedan fuera.

## Avisos para el crítico

- Verifica los cuerpos contra el código de HOY: aquí los issues caducan en horas. #484 nació en la
  QA del corte 2 de #358 y **#483 (la mirilla tapada por el canvas) ya se cerró**: comprueba qué
  queda vivo de su backlog visual.
- Las etiquetas del mundo viven en `nefan-html/src/ui/etiquetas-del-mundo.ts` (corte 2 de #358) y los
  guiones leen `data-target`.
- El muro de carga es `nefan-html/src/ui/muro-de-carga.ts` (corte 1), con la política de
  `muroPuestoPorAviso` en tabla y los guiones 77 y 78 encima. #469 dejó escrito que la causa entra al
  canal **desde quien la conoce**, con cero decisión en `main.ts`.
- #451 toca `loadWorldSnapshot` en core, que desde #302 rechaza el snapshot entero si la escena de
  ENTRADA es injugable. Servir «la entrada y las buenas» tiene que decir qué pasa cuando la injugable
  **es** la de entrada.
- Crítica visual de director de arte en la QA: no vale un checklist técnico.
- **Cero créditos**: `html-fixtures` y `e2e-sin-creditos`.

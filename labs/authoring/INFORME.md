# Informe — Autoría libre de escenario: three.js vs Godot (run 001, 2026-08-15)

> **DECISIÓN (2026-08-15)**: nos quedamos con **three.js** como renderer del
> juego. La ventaja de calidad de Godot no compensa perder el despliegue en
> navegador; los dos benches (este y `labs/fps/COMPARATIVA_GODOT.md`) quedan
> como evidencia, sin plan de integración. Los bancos de referencia se
> archivaron con el cliente en `archivo/labs/`.

**Pregunta**: ¿qué calidad y complejidad de escenario puede crear el modelo
(actuando de motor narrativo, SIN el formato declarativo del juego) con cada
herramienta, en cuánto tiempo y a qué coste?

**Método**: una única descripción rica (`DESCRIPCION.md`, "Cala de Brumaluz":
aldea pesquera al anochecer, 17 elementos, paleta y 4 poses obligatorias)
escrita primero; después dos implementaciones nativas e independientes
(`three/escena.js` y `godot/`), cada una iterada como director de arte sobre
capturas reales hasta rendimiento decreciente, con el mismo presupuesto de
iteraciones (≤8). Sin assets externos ni APIs de pago: geometría procedural,
texturas generadas por código y shaders propios. Resultado pareado en
`runs/001/index.html` (verlo: `./labs/serve.sh` →
`http://localhost:8912/authoring/runs/001/index.html`).

## Mediciones

| Métrica | three.js | Godot 4.6 |
|---|---|---|
| Tiempo de implementación (reloj) | **932 s (15,5 min)** | **773 s (12,9 min)** |
| Iteraciones (construcción + pulido) | 1 + 3 | 1 + 4 |
| Capturas revisadas | 13 | 12 |
| Código autorado | 43,4 KB (escena.js 42,4 KB + html + sh) | 38,8 KB (3 .gd 31,2 KB + 2 shaders 6 KB + proyecto) |
| Tokens de sesión consumidos en la fase (≈) | ~100k | ~85k |
| Errores de ejecución/parseo | 0 | 0 (GDScript estricto compiló a la primera) |
| Defectos visuales corregidos en el pulido | 3 | 5 |
| Captura headless | ~9 s/pose (Chrome+swiftshader) | ~40 s/pose (45 frames de convergencia SDFGI, GPU real bajo xvfb) |

Fase previa compartida: descripción = 64 s, 6,8 KB (~8k tokens de sesión).
Informe (esta fase): ~25k tokens. **Total del experimento ≈ 220k tokens de
presupuesto de sesión** (imágenes de verificación incluidas, que son el coste
dominante: ~1,6k tokens por captura revisada). A precios de API de un modelo
frontier eso son ~$2–4; con la suscripción Max del proyecto, coste marginal 0.
Cronología exacta en `metrics.json`.

## Errores y fricción (lo que me costó a MÍ como autor)

**three.js** — cero fricción de arranque (un archivo, un import de unpkg) y
depuración transparente. Los 3 defectos fueron de autoría, no del motor:
cámara p0 pegada al lomo del espigón (banda negra), interior de las barcas
desalineado por el orden rotación→escala del `Object3D`, y texturas canvas
con repeat corto (motas gigantes). Todo lo "cinematográfico" hay que
FALSIFICARLO a mano: halos = sprites aditivos, bruma = sprites + término en
el shader del agua, bloom no existe, GI no existe (la puerta de la taberna
"ilumina" con un SpotLight + un plano aditivo en el suelo).

**Godot** — el GDScript tipado (3 archivos, ~1.100 líneas) y los 2 shaders
compilaron y ejecutaron A LA PRIMERA; toda la fricción fue de semántica del
motor: (1) los shaders custom de cielo/agua emiten lineal → paleta lavada
hasta linealizar los hex (lección ya conocida del bench labs/fps, aquí
`pow(col, 2.2)·1.2`); (2) el hemisferio de `SphereMesh` incluye su disco
base (interior de barca pálido hasta taparlo); (3) el ruido de nubes sobre
`atan(azimut)` deja costura al sur (→ proyección gnomónica); (4) el
`FogVolume` enseña sus aristas de caja (→ `edge_fade`); (5) las omni sin
sombra atraviesan muros e iluminan fachadas que no deben. Ninguno rompió
nada: todos se vieron en captura y se arreglaron en una iteración.

## Calidad (juicio de director de arte sobre runs/001)

| Criterio | three.js | Godot |
|---|---|---|
| Tema de luz (anochecer cálido/frío) | ✓ conseguido, más "noche cerrada" | ✓ conseguido, crepúsculo más creíble |
| Halos/bloom de faroles y faro | sprites aditivos (aceptable, se nota el truco) | **bloom real + niebla volumétrica: los faroles VIVEN** |
| Luz derramada (puerta de la taberna) | spot + plano aditivo (plano) | **SDFGI: el porche entero baña la fachada y el suelo** |
| Cielo (gradiente, nubes, luna, estrellas) | bueno; nubes de sprite algo blob | **mejor: cirros procedurales continuos, luna con halo** |
| Agua (reflejo del cielo + caminos de luz) | empate — mismo shader portado en ambos | empate |
| Bruma de la bocana | sprites + fog lineal (correcta) | **FogVolume volumétrico real (el faro se hunde en ella)** |
| Materiales de cerca (p2/p3) | texturas canvas más marcadas | algo más cremoso; triplanar salvó la piedra del espigón |
| Fidelidad a las 4 poses de la descripción | 4/4 (ermita débil en p2) | 4/4 (ermita débil en p2) |
| **Pantalla de carga de juego comercial** | p1 sí; p0/p3 casi | **p1 y p3 sí, p0 casi; conjunto más pro** |

Desviaciones comunes respecto a DESCRIPCION.md (deuda de ambos): la ermita no
quedó enmarcada en p2, las gaviotas son casi invisibles, el nombre "La Garza"
no está pintado en el casco, y las redes tendidas leen débil. Nada de esto lo
impidió el motor: fue presupuesto de iteraciones.

## Conclusión para el motor narrativo

- **Misma complejidad alcanzable**: los ~17 elementos de la descripción
  entraron ENTEROS en ambos, con el mismo layout y en tiempos parejos
  (15,5 vs 12,9 min). Escribir la escena no es el cuello de botella en
  ninguno: verificar con capturas lo es (y Godot tarda 4× más por captura
  con SDFGI, aunque su bucle total fue MÁS CORTO porque necesité menos
  arreglos estéticos manuales).
- **Calidad máxima por unidad de esfuerzo: Godot.** Bloom, GI, niebla
  volumétrica y triplanar son UNA LÍNEA cada uno y sustituyen los cuatro
  trucos más laboriosos de three (sprites de halo, luz falsa derramada,
  bancos de bruma por sprites, UVs por cara). El acabado "de juego" sale del
  motor, no del autor.
- **Control máximo por píxel: three.js.** Cuando quise EXACTAMENTE un look
  (paleta clavada del cielo, caminos de luz en el agua), el shader único sin
  pipeline por medio fue más directo; en Godot cada shader custom pelea con
  el pipeline (lineal/sRGB, tonemap) — la fricción nº 1 de este run.
- **Errores**: empate técnico (0 errores duros en ambos; Godot sorprende:
  1.100 líneas de GDScript estricto sin un solo error de parseo). La
  diferencia es el TIPO de defecto: en three son de composición manual; en
  Godot, de semántica del motor — y estos últimos se agotan (tres de los
  cinco ya eran conocidos del bench labs/fps y no los repetí).
- **Para el juego**: coherente con `labs/fps/COMPARATIVA_GODOT.md` — si el
  motor narrativo pudiera emitir "escenas cinematográficas" libres, Godot
  produce el resultado más profesional con menos instrucciones; three
  conserva el despliegue instantáneo en navegador y la depuración más
  transparente.

---

# Run 002 — Luz de gameplay + scatter procedural declarativo (2026-08-15, solo three)

**Cambio de dirección del usuario**: nada de efectos luminosos marcados — luz
legible de juego; el detalle se gana con MÁS ELEMENTOS (matorrales, árboles
de fondo, rocas…) generados programáticamente: el modelo solo declara zonas
con densidad y una **función generadora por tipo escrita en el momento** (sin
catálogo predefinido), y el sistema produce variaciones asentadas en el
terreno. Resultado: `runs/002/index.html` (mismas 4 poses, ahora de día).

## Qué se construyó

- **`three/scatter.js` (4,7 KB)** — motor genérico reutilizable:
  `populate(scene, zones, generators, {groundH, seed, exclusions})`. Zonas
  `rect|ellipse|poly` con densidad en elem/m², muestreo por rejilla
  estratificada con jitter determinista, `y` del terreno por zona (el cabo
  norte usa su propia función de altura), filtros `minY/maxY` (juncos solo en
  la franja de orilla), exclusiones rect/círculo (casas, muelle, callejón,
  porche, ermita, higuera…), y conteos `wanted/placed` por zona.
- **Declaración de autor** (lo que emitiría el motor narrativo): 4
  generadores ad hoc — `pino` (tronco + 2–4 pisos de copa, tono/altura
  jitter), `matorral` (2–4 esferas achatadas), `roca` (1–3 icosaedros con
  vértices perturbados, flat shading), `junco` (5–9 tallos inclinados) — y
  **8 zonas** (pinar de ladera y de cabo, matorral en bancal/bordes, rocas de
  playa y bancal, juncos de orilla).
- **Reluz de gameplay**: cielo de tarde clara (solo tocar `SKY_GLSL` — el
  agua hereda el cambio gratis), sol con sombras PCF + `normalBias`, fuera
  halos/spill/luna/estrellas, faroles apagados, ventanas de vidrio neutro.

## Mediciones

| Métrica | Run 002 |
|---|---|
| Tiempo | **797 s (13,3 min)**, 5 iteraciones, 13 capturas revisadas |
| Tokens de sesión | ~95k |
| Instancias generadas | **130 colocadas** de 166 pedidas (descartes = exclusiones + filtros de orilla, comportamiento pedido) |
| Determinismo | md5 de dos capturas de p0 IDÉNTICO |
| Errores de ejecución | 0 (scatter.js funcionó a la primera) |

## Veredicto de la prueba

- **Sí es viable y barato**: declarar `{zona, densidad, generador}` añadió
  ~130 elementos con variedad estructural real (ningún clon aparente) por
  ~60 líneas de módulo + ~70 de declaración. La escena pasa de "maqueta con
  7 casas" a paisaje habitado sin colocar nada a mano.
- **El coste real fue la RELUZ, no el scatter**: pasar de anochecer a día
  destapó 3 deudas invisibles con luz dramática (winding invertido de los
  tejados, auto-sombra del terreno con sol alto, albedos nocturnos). Lección
  para el juego: **la luz de gameplay es el banco de pruebas honesto**; los
  contraluces esconden geometría rota.
- **Patrón recomendable para el motor narrativo**: es exactamente la
  generalización de `vegetation_zones` que ya existe en el juego, con dos
  extensiones: (1) densidad + forma libre de zona, (2) el generador como
  DECLARACIÓN paramétrica del modelo. En el juego el generador no puede ser
  código arbitrario (el motor emite JSON): la traducción natural es un árbol
  de primitivas con rangos aleatorios por campo (alturas, radios, conteos,
  jitter de tono) — expresable en zod y evaluable con el SeededRng de
  nefan-core, mismo espíritu que los plugins declarativos.
- Fricción menor: equilibrar densidades/exclusiones llevó 1 iteración; los
  conteos `wanted/placed` por zona fueron la telemetría clave para verlo.

---

# Run 003 — Generadores como JSON puro del motor narrativo (2026-08-15)

Prueba de la traducción propuesta en run 002: el generador deja de ser código
y pasa a ser **JSON declarativo** — lo único que un motor narrativo que emite
JSON puede producir. Resultado: `runs/003/index.html` (misma escena, misma
calidad, ahora sin una línea de código de autor).

## Formato (`three/generadores.json`, 4,3 KB — 5 generadores)

Árbol de primitivas con valores que son: literal, rango `[min,max]`
(muestreado con el rng sembrado), `{var}` (variables por instancia),
aritmética `{op:+,-,*,/}`, `{int:[a,b]}`, `{lerp:[a,b]}` dentro de
`repeat` (progresiones, p. ej. copas del pino decrecientes), `vars` locales
por iteración, materiales con `hslJitter`. El compilador/validador
(`gen-json.js`, 7,4 KB) valida fail-loud con ruta exacta y compila a la misma
firma que consume `populate()` — mismo espíritu que el DSL de plugins
declarativos del juego.

## Resultados

| Métrica | Run 003 |
|---|---|
| Tiempo | **180 s (3 min)**, 1 iteración, 0 retoques |
| Calidad | equivalente a run 002 a simple vista (misma variedad estructural) |
| Expresividad | los 4 tipos portados SIN pérdida + **`olivo`, tipo nuevo declarado SOLO en JSON** (tronco inclinado + 3–5 copas), distinguible del pino en captura |
| Determinismo | md5 idéntico entre capturas |
| Fail-loud | shape inválida → `generador roca.parts[0]: shape 'dodecaedro' no es box\|cylinder\|cone\|sphere\|icosahedron` |
| Errores | 0 (compilador y JSON funcionaron a la primera) |

## Conclusión

El patrón completo queda demostrado de punta a punta: **el motor narrativo
declara `{zonas con densidad}` + `{generadores como árbol JSON de primitivas
con rangos}`, y el cliente genera cientos de variaciones deterministas bien
asentadas en el terreno**. Ni catálogo predefinido ni código generado. Para
llevarlo al juego: schema zod espejo de `gen-json.js` en nefan-core (como
`PluginManifestSchema`), rng = SeededRng existente, y el campo viajaría en el
plan del tile junto a `ground`/`volumes` (p. ej. `scatter_zones` +
`scatter_generators`), con los conteos `wanted/placed` como telemetría.

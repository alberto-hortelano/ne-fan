# labs/escenografia — bases SVG de plató de cine clásico

Colección standalone de pares **descripción ↔ escenario SVG** para la vista
proscenio. NO está integrada en el juego: son bases de referencia hechas a
mano para (a) fijar el norte visual de un futuro compositor v4 y (b) servir
de referencias de estilo al modelo de imagen (las actuales son top-down y no
le enseñan la perspectiva a nivel de suelo).

**Estética objetivo: plató de cine de los años 50** — decorado construido a
nivel de suelo + fondo pintado (matte painting), realista. NADA de teatro:
sin marcos, sin cortinas, sin bandas, sin vocabulario escénico.

## Convención de cámara (compartida con el juego, nada más)

- Cámara a ~1.6 m del suelo (altura de ojos), al SUR mirando al norte.
- Un punto de fuga en la línea de horizonte; focal larga (teleobjetivo).
- El suelo converge hacia el punto de fuga; un objeto de h metros a
  profundidad z mide h·ppm·s(z) — misma familia que `stage/projection.ts`,
  pero aquí la geometría se dibuja a mano, sin compositor ni paletas del
  juego.

## Principios de composición (checklist de cada escena)

1. **Nada frontal-paralelo** — la calle/camino entra en diagonal o curva;
   cada edificio muestra dos planos (frente + lateral en fuga).
2. **Tres términos** — primer término construido y recortado que enmarca;
   término medio jugable; fondo matte desaturado con niebla atmosférica.
3. **Un punto focal** por escena (torre, fuente, portón, hoguera), colocado
   por regla de tercios, con las líneas de fuga apuntándole.
4. **Variedad y solapamiento** — alturas/anchos/orientaciones distintas,
   siluetas irregulares, los volúmenes se tapan entre sí en profundidad.
5. **Luz única direccional** — lado lit/shade consistente, sombras arrojadas
   sobre el suelo, cielo con gradiente; la hora se declara en la descripción.
6. **Suelo trabajado** — adoquines/roderas/charcos convergiendo al punto de
   fuga (la señal de perspectiva más fuerte para el modelo de imagen).
7. **Vida sin personajes** — barricas, toldos, ropa tendida, humo… pero sin
   figuras (las pone el juego).

## Estructura

```
NN_nombre/
  descripcion.md   — párrafo de lugar (tono del motor narrativo) + decisiones
                     de composición (reutilizables como prompt)
  escena.svg       — el escenario, SVG standalone 1600×1000
index.html         — galería con todos los pares lado a lado
```

## Referencias de estilo (`estilos/`)

`gen_estilos.py` repinta el render de cada base SVG con gpt-image-2 (fal)
manteniendo composición/cámara/luz y variando solo la cláusula de estilo.
17 imágenes en 3 tandas (~$0.17/u); galería en `estilos/index.html`.
Hallazgo: con una base a nivel de suelo bien compuesta el modelo SÍ sigue el
layout; los estilos "de autor" se toman más licencias que los "de producción".

## Bench greybox (`greybox/`) — ¿otro formato de plano mejor que el SVG?

Motivación (investigación 2026-08-04): el patrón dominante en LLM→escena→
imagen es un plano 3D intermedio (SceneCraft/Blender, Holodeck, Ctrl-Room)
o el workflow de industria blockout 3D → depth → ControlNet; nuestro propio
labs/render (E5 híbrido) subió seedream de 45→100% de fidelidad con un render
three.js como base. Este bench replica 3 de las escenas validadas
(01_calle, 02_plaza, 05_puerto) como **greybox three.js** con la misma
convención de cámara (1.6 m, sur→norte, focal larga, un sol):

```
greybox/
  lib.mjs           — helpers (casas con tejado, cintas de suelo, sol con
                      sombras, cielo gradiente, colinas, props)
  viewer.html       — render 1600×1000 con 3 pasadas: ?pass=clay|depth|seg
  capture.sh        — ./capture.sh 01_calle clay depth seg  (Chrome headless)
  NN_escena/
    escena.mjs      — la escena en metros (export build(THREE) → {group,
                      camera, fog, manifest})
    clay.png        — greybox iluminado (entrada de editores img2img)
    depth.png       — profundidad lineal (blanco=cerca; entrada FLUX depth)
    seg.png         — color plano por categoría (pista semántica)
  gen.py            — Fase 2: clay→gpt-image-2, clay→seedream4,
                      depth→FLUX-depth; comparativa vs baseline SVG en
                      out/index.html (misma cláusula Magic)
```

El manifest de cada escena da huellas/alturas EXACTAS de cada volumen → si
esta vía gana, colisión y recortes salen del plan sin calibrar trapecios.

### Resultados del run 001 (2026-08-04, ~$0.69)

| Vía | Coste/img | Fidelidad de layout | Crítica |
|-----|-----------|---------------------|---------|
| clay → **gpt-image-2** | $0.17 | **La más alta de todo el lab** | Sigue volúmenes, cámara, huecos, props Y la dirección de luz/sombras del clay; conserva la HORA en las 3 escenas (la vía SVG cambió el amanecer del puerto). Perspectiva correcta gratis. GANADORA. |
| clay → **seedream4** | $0.03 | Alta (confirma E5 de labs/render) | 2/3 con MARCO DE CARTA literal (la cláusula "Magic card" se lo pide — arreglable con "artwork only, no card frame" o recorte); estilo menos controlado. Palanca 5× más barata. |
| depth → **FLUX depth** | $0.03 | Sorprendentemente alta en estructura | Solo ve depth+texto: semántica débil (iglesia→genérica), rellena zonas libres con inventos (castillo), 2/3 con watermark, estilo deriva a render 3D. Backup barato, no la elección. |
| SVG a mano → gpt-image-2 (baseline) | $0.17 | Alta pero con derivas | Perspectiva/tamaños a ojo del dibujante; hora cambiada en puerto; ambigüedades de la base (lámina de luz→vitrina) se heredan. |

**Conclusión**: el formato de plano base ganador es el **greybox three.js**
(clay iluminado + manifest), no un SVG mejor. Recomendación para el
compositor v4 del proscenio: mantener el plan semántico (`stage` volumes) y
sustituir el compositor SVG por un builder three.js determinista que emita
clay + depth + manifest; repintar con gpt-image-2 (calidad) o seedream
(barato, con prompt anti-marco). Los 2-4 renders de iteración de cada escena
salen gratis y el manifest da colisión/recortes sin calibración.

## Navegar

```bash
./labs/serve.sh   # :8912 (sirve labs/ entero)
# → http://localhost:8912/escenografia/           (galería de bases SVG)
# → http://localhost:8912/escenografia/estilos/   (referencias de estilo)
# → http://localhost:8912/escenografia/greybox/out/  (bench greybox vs SVG)
```

(o abrir `index.html` directamente con file://)

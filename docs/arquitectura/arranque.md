# Arrancar y probar el juego

Cómo se conduce el juego sin manos y qué hay que comprobar tras un cambio visual. El menú de presets vive en `CLAUDE.md`; esto es lo que viene después.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Conducir el juego sin manos

Tres caminos, según lo que quieras mover:

| Quiero… | Herramienta |
|---|---|
| comprobar el juego entero desde el arranque | `node qa/run.mjs` — levanta el preset `e2e-sin-creditos` él solo y corre los guiones de `qa/guiones/` |
| conducir el cliente a mano desde un guion | `?input=scripted` + `window.__nefan` (el `inputDriver` sustituye al teclado) |
| emular ser el juego frente al bridge | `node labs/narrative/game-emulator.mjs` — API HTTP de control en `:9899`, sin navegador |

El contrato de `window.__nefan` y las reglas que hacen que un guion valga algo
(esperar por ESTADO y nunca por tiempo de pared, probar el guion en negativo)
están en [`qa/README.md`](../../qa/README.md), que es la referencia — esto no la duplica.

## Testing visual automatizado

**IMPORTANTE:** Cada vez que se modifique algo visual (animaciones, movimiento, cámara, colisiones), ejecutar los guiones y verificar las capturas de `qa/capturas/`.

### Comprobación final crítica (definición de hecho)

Una tarea NO está terminada cuando "funciona lo que construí": está terminada cuando se cumple **lo que se pidió**. Antes de cerrar cualquier tarea:

1. **Releer la petición ORIGINAL del usuario** (no el plan propio) y convertirla en criterios de aceptación literales. Un requisito absoluto ("siempre", "en todo momento", "cualquier") obliga a enumerar TODOS los estados del sistema (arranque/título, diálogo, overlays, history browser, offline, fixtures…) y probar el criterio en cada uno.
2. **Verificar en el flujo real del usuario, empezando donde él empieza** (arrancar el juego desde cero), no en un escenario preparado para que la prueba pase.
3. **Regla del workaround:** si durante la verificación hay que ocultar/forzar/stubear algo para ver la feature (un `display:none` a un overlay, estado sintético, saltarse una pantalla), el usuario tendrá ese mismo obstáculo delante — es un HALLAZGO que arreglar o reportar, nunca un paso de la receta de captura.
4. **Pasada adversarial:** el último paso es intentar FALSIFICAR cada criterio ("¿en qué situación NO se cumple?"), no confirmarlo una vez y declararlo hecho.

Caso de referencia (2026-08-09): panel de dev "siempre visible" — renderizaba bien, pero el title-screen lo tapaba justo en el flujo donde más importaba (crear mundo/estilo = gastar créditos). La captura de verificación YA lo mostraba tapado y se ocultó el overlay para fotografiar en vez de leerlo como bug.

### Principios de testing visual

1. **Los guiones deben simular el input real del jugador.** Conducir por el `inputDriver` (la misma ruta que el teclado) en vez de llamar directamente al método que quieres ver. El camino debe ser idéntico al del jugador.

2. **Capturar durante la acción**, no solo antes y después. Una animación puede verse perfecta al inicio y al final y romperse a mitad de ejecución.

3. **Verificar SIEMPRE las capturas generadas.** Los guiones dan verde/rojo sobre estado numérico (posición, colisión, qué ofrece el HUD), pero pies deslizando, escalas incoherentes o una luz que no casa solo se ven mirando.

4. **La escena de prueba debe tener referencia visual.** Una fixture con marcas conocidas en el suelo permite comparar lo que se pinta contra lo que se dice; las fixtures vivas están en `nefan-core/data/scenes/` y las ofrece el selector «Room» del cliente.

### Guiones

```bash
node qa/run.mjs                  # todos
node qa/run.mjs colision hud     # los que casen con esos nombres
node qa/run.mjs --headed         # con ventana, para mirar qué hace
```

## Lecciones aprendidas sobre animaciones Mixamo

Aplican a **sprite-forge** (repo aparte, servicio en :8770), que es quien consume
hoy los FBX de Mixamo y produce las hojas de sprites de personaje:

- **Hips XZ drift:** las locomociones de Mixamo mueven el bone Hips en XZ (root motion horneado). Sin tratarlo, el personaje se sale de la celda del sprite. Solución: congelar Hips en XZ al primer keyframe en walk/run/strafe, preservando Y para que sobreviva el balanceo. Ataques e idle no se congelan: su drift es ~0. Qué clips son locomoción lo declara el set de assets (`"locomotion": true`), no una lista de nombres en el código: un set que llame `andar` a la caminata tiene que poder decirlo.
- **Animaciones estáticas vs con pasos:** usar animaciones SIN pasos hacia adelante para los ataques (attack(4), slash, slash(5), slash(3)). Las que tienen pasos (attack, attack(2)) deslizan los pies al congelar el Hips.
- **El prefijo de hueso no siempre casa:** el modelo puede traer `mixamorig_` y la animación `mixamorig1_`. Si no se reescribe el prefijo de las pistas, el personaje renderiza en pose de reposo — y eso se ve igual que "la animación no carga".

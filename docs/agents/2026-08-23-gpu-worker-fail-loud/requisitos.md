# El gpu-worker dice qué le falta (#199)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## El issue

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/199`.

Resumen: al retirar `/inpaint_scene_plate` (PR #198) salió a la luz que era **el único endpoint
de `ai_server/routers/gpu_generation.py` que comprobaba su dependencia**. Los cuatro restantes
—`/generate_texture`, `/generate_model`, `/generate_skin`, `/generate_sprite`— usan `deps.*`
directamente: si el generador no está inicializado (gpu-worker sin GPU, backend caído,
dependencia opcional ausente), lanza `AttributeError` y FastAPI lo convierte en un **500 opaco**.

Incumple la regla de errores del proyecto: en Python/FastAPI los fallos van por `HTTPException`
con código y `detail` legibles. Es preexistente, no lo introdujo la #198.

El issue pide además un test que **recorra los endpoints del router** y falle si alguno toca
`deps.<x>` sin comprobarlo antes, «en vez de confiar en que el siguiente que añada uno se
acuerde».

## Lo que hay que verificar, no dar por bueno

- ¿Siguen siendo cuatro los endpoints, y siguen sin guardia? El fichero, según mi lectura, **ni
  siquiera importa `HTTPException`**: compruébalo, porque si es cierto es la prueba más corta de
  que ninguno la usa.
- ¿Hay ya un candado equivalente en el repositorio? El checker de fronteras
  (`data/contract/arch-rules.json`) cubre fail-loud por capa en los endpoints Python. Si esta
  regla ya está candada y este router se le escapa, la tarea es **extender un candado
  existente**, no escribir uno nuevo — y eso cambia el plan.
- ¿Es esto alcanzable de verdad en una máquina sin GPU, o solo teórico? El arranque del
  gpu-worker sin GPU es un caso declarado en `CLAUDE.md` («opcional»), así que debería serlo.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- Los cuatro endpoints responden un error con código y `detail` que nombra el servicio que falta.
- Un candado impide que el próximo endpoint nazca sin guardia.
- Patrón consistente con el resto de routers del repositorio, no uno nuevo.

## Fuera de alcance

Hacer que los generadores funcionen sin GPU. Cambiar el arranque del gpu-worker.

## Preguntas abiertas

Ninguna para el usuario, salvo que tú determines que la hay.

# #404, reabierto — veredicto sobre un veredicto

**REENCUADRADO: de PREMATURA a prerrequisito de #439.** El material del arquitecto es correcto y mi motivo para aplazarlo ha caducado. Pero la vía derivada **no es gratis del todo**: tiene un agujero medido que hay que candar, y no es el que yo temía.

## 1 · ¿Se reabre? Sí, y el arquitecto no se ha pasado de frenada

Los tres forzadores existen y están donde dice, sobre `main` = `4747917`:

| Forzador | Sitio | Comprobado |
|---|---|---|
| rama `dato` → `todos: true` | `nefan-core/scripts/afectado.ts:306-315` | sí |
| `mutation-targets.json` como TOOLING | `:81-89` | sí |
| todo `scripts/` como TOOLING | `:82` (primer elemento de `TOOLING`) | sí |

Las tres reproducciones dan **exactamente** lo que dice, ejecutadas hoy:

- `233b7b4^..233b7b4` (#412) → «EJECUTA LOS 41 MÓDULOS», motivo único `data/contract/client-file-size.json`
- `81a7ce0^..81a7ce0` (#416) → los 41, y con **dos** motivos, no uno: `data/contract/mutation-targets.json` **y** `scripts/manifest-kinds-con-productor.ts`. Corrección menor que refuerza su tesis: en esa PR dispararon dos de los tres forzadores a la vez
- `8aa3f9f^..8aa3f9f` (#422) → «NO EJECUTA NADA». El selector funciona cuando le dejan

**Mi motivo para aplazarlo era éste, literal**: «su beneficio en esta tanda es cero medido — el propio diff de T10 toca `scripts/` y `mutation-targets.json`, así que la corrida siguiente sale COMPLETA de todos modos». Era cierto **dentro de T10**, donde el instrumento se estaba tocando por definición. Deja de serlo con #439: ahí el carril rápido tiene que activarse en PRs que **no** tocan el instrumento, y con los tres forzadores vivos no se activa nunca. El coste pasa de «alguna corrida cara» a «la funcionalidad no existe». Se reabre.

Y tiene razón en que **#404 solo nombra uno de los tres**: su cuerpo habla de la rama `dato` y de `client-file-size.json`. Los otros dos son TOOLING, que es una clase distinta y con mejor justificación — hay que decidirlos por separado, no arrastrarlos en el mismo párrafo.

## 2 · ¿La vía derivada elimina mi riesgo? Sí el que yo nombré — pero deja otro, y lo he medido

Ejecuté `ctx.leen` de verdad (`contextoDe(leerPlan())`) sobre los datos reales. **Contesta, y sin lista a mano:**

```
client-file-size.json   -> NINGÚN módulo      generate_scene.json  -> blueprint-volumenes, contrato-escena
sprite-set.json         -> sprite-census      narrative_react.json -> contrato-escena
combat_config.json      -> 10 módulos         scene_instructions.md-> contrato-escena
```

Mi objeción original —«una lista a mano cuyo defecto para un fichero nuevo es el silencio»— **desaparece**: el defecto pasa a ser *calculado*, y el fichero que #404 nombra sale «ningún módulo» derivándolo, que es la respuesta correcta y nadie la escribió. También sale bien el caso que más me preocupaba: `sin_tile.json` y compañía → ningún módulo, y es un **verdadero negativo**, porque su único lector `test/contract-fixtures.test.ts` está en `excluidos` con motivo escrito (llega al schema por el `dist/` compilado, así que no puede matar un mutante).

**Pero `leeElDato` mira nombres dentro de LITERALES DE CADENA** (`scripts/mutation-plan.ts:604-629`), y eso no ve a un lector que **enumera un directorio**. Medido:

```
puerto_tile.json  -> NINGÚN módulo
zorder_test.json  -> status-motivo
robledo_tile.json -> scene-normalize, blueprint-*, status-motivo   (NO contrato-escena, NO scene-validate)
```

`test/scene-fixtures.test.ts` lee `data/scenes/` con `readdirSync` (`:35`) y **está en la batería de `contrato-escena` y de `scene-validate`**. O sea: con la vía derivada tal cual, tocar `data/scenes/puerto_tile.json` seleccionaría **nada** y saldría verde, cuando de verdad alimenta dos baterías vivas. Es exactamente la clase de fallo que esta familia de tareas no puede producir: más permisivo sin que se note.

No lo diseño yo, pero el criterio es falsable y se lo dejo al arquitecto: **ningún fichero de datos puede resolverse a «no lo lee nadie» sin que un candado haya comprobado que ninguna batería enumera su directorio.** Y ese candado hay que verlo rojo (borrar el nombre de un literal, o meter una fixture nueva en `data/scenes/`, tiene que poner el check en rojo).

## 3 · El reloj: el arquitecto acierta en el fondo, y el issue #439 está mal medido

Calculado hoy con `segundosDe` (máximo por módulo, como hace `lotes`) sobre la huella de `4747917`:

| grupo | segundos | % reloj | % mutantes |
|---|---|---|---|
| escena / blueprint | 9.899 | **80,1 %** | 64,1 % |
| plugins (`plugins-dsl`) | 640 | 5,2 % | 11,4 % |
| **combate** (3 módulos) | **58** | **0,5 %** | 2,5 % |
| núcleo vivo | 1.756 | 14,2 % | 22,0 % |

Confirmo lo esencial: **aparcar el combate entero ahorra ~1 minuto**. Mis cifras difieren un poco de las suyas (0,5 % contra 0,7 %; 58 s contra 66 s) porque el corte de grupos es opinable —yo mando todo `src/scene/**` a escena/blueprint, incluido `scene-normalize`—; la conclusión no depende de eso.

**Lo que hay que corregir en #439**: su tabla está en **mutantes**, la moneda vieja. En reloj, plugins cae de 13 % a ~5 % y combate de 3 % a ~0,5 %: «plugins y combate salen del reparto por defecto» compra **698 s de 12.353 (5,7 %)**, no el 16 % que sugiere la tabla. La frase «el 81 % se gasta en código aparcado o en deuda conocida» se sostiene solo porque mete a escena/blueprint en el saco, y ése **no** está aparcado ni #439 propone quitarlo.

Y el dato que #439 no tiene y cambia sus prioridades: **`scene-validate` solo cuesta 2.510 s — el 20 % del reloj total**, cuatro veces plugins y combate juntos, y **no cabe en el tope de lote de 1.800 s** (`lotes` lo dice: «irá solo y hay que partir su batería»). Entró en el contrato con #339, en T10, y no es un argumento contra aquello: es el número que faltaba. Si se busca reloj, la primera palanca es ésa, no el combate.

## Qué cambiaría, concreto

- **#404**: reetiquetar como prerrequisito de #439 y ampliar su cuerpo a **los tres** forzadores (`:306-315`, `:81-89`, `:82`), diciendo que TOOLING es una clase aparte que se decide por separado. Añadir al criterio de cierre: «un fichero de datos solo se resuelve a “ningún módulo” con un candado que compruebe que ninguna batería enumera su directorio — probado en rojo».
- **#439**: sustituir la tabla de mutantes por la de reloj; corregir «plugins y combate salen del reparto» diciendo que compra **5,7 % del reloj (698 s)**; y añadir que **`scene-validate` es el 20 % del reloj él solo y no cabe en un lote**.
- Retirar de #439 la frase «el 81 % del coste se gasta en código que el usuario aparcó», que en reloj se lee como si aparcar plugins y combate resolviera el problema.

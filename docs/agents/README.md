# docs/agents — el rastro del equipo de agentes

Una carpeta por tarea: `AAAA-MM-DD-slug/`. Los roles de `.claude/agents/` (`arquitecto`,
`ingeniero`, `qa`) arrancan con contexto limpio y no se ven entre sí, así que todo el handoff
viaja por ficheros. El ciclo se lanza con `/feature`.

**Aquí solo se commitean dos**, los que envejecen bien:

| Fichero | Lo escribe | Contiene |
|---------|-----------|----------|
| `requisitos.md` | Coordinador (sesión principal) | La petición literal del usuario citada, criterios de aceptación, fuera de alcance, preguntas abiertas |
| `qa.md` | `qa` | Criterio → veredicto con evidencia, hallazgos priorizados, workarounds, veredicto final |

`plan.md` e `implementacion.md` viven en **esta misma carpeta** —son el handoff entre el
arquitecto y el ingeniero, y una sola ruta por tarea es una cosa menos que puede salir mal—
pero **`.gitignore` no los deja entrar al repo**. Son andamio: qué se pensaba hacer y cómo se
hizo. Guardados, dejan de coincidir con el código en cuanto alguien lo toca, y entonces son
peor que nada, porque alguien se los cree. Lo que perdura es **qué se pidió** y **qué se
verificó**; lo demás lo cuenta el código y su historia de git.

Que sea el `.gitignore` y no esta frase quien lo impida es deliberado: un `git add` distraído
no puede saltarse un candado, pero se salta un párrafo sin enterarse.

Para lo mecánico, el rastro de verdad no es prosa: es el guion en `qa/guiones/` que cualquiera
puede volver a correr.

# docs/agents — memoria compartida del equipo de agentes

Una carpeta por tarea: `AAAA-MM-DD-slug/`. Es el handoff entre los roles definidos en
`.claude/agents/` (`arquitecto`, `ingeniero`, `qa`), que arrancan con contexto limpio y no se
ven entre sí — este directorio es lo único que comparten.

| Fichero | Lo escribe | Contiene |
|---------|-----------|----------|
| `requisitos.md` | Coordinador (sesión principal) | Petición literal del usuario, criterios de aceptación, fuera de alcance, preguntas abiertas |
| `plan.md` | `arquitecto` | Estado actual, opciones + recomendación, ficheros y contratos a tocar, compatibilidad, mejoras estructurales, criterios de verificación |
| `implementacion.md` | `ingeniero` | Qué se implementó, tests, verificación EJECUTADA con su salida, desviaciones del plan |
| `qa.md` | `qa` | Criterio → veredicto con evidencia, hallazgos priorizados, workarounds, veredicto final |

El ciclo se lanza con `/feature`. Los documentos se commitean con el cambio: son el rastro
revisable de por qué el código es como es.

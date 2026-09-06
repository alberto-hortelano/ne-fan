# docs/agents — el rastro del equipo de agentes

Una carpeta por tarea: `AAAA-MM-DD-slug/`. Los roles de `.claude/agents/` (`critico`,
`arquitecto`, `ingeniero`, `qa`) arrancan con contexto limpio y no se ven entre sí, así que todo
el handoff viaja por ficheros. El ciclo se lanza con `/feature`.

**Aquí solo se commitean tres**, los que envejecen bien:

| Fichero | Lo escribe | Contiene |
|---------|-----------|----------|
| `requisitos.md` | Coordinador (sesión principal) | La petición literal del usuario citada, criterios de aceptación, fuera de alcance, preguntas abiertas |
| `critica.md` | `critico` | Veredicto sobre la tarea (vigente / reencuadrada / obsoleta / en conflicto / prematura), el problema real en una frase, la premisa verificada afirmación por afirmación, el día después y los conflictos |
| `qa.md` | `qa` | Criterio → veredicto con evidencia, hallazgos priorizados, workarounds, veredicto final |

`plan.md` e `implementacion.md` viven en **esta misma carpeta** —son el handoff entre el
arquitecto y el ingeniero, y una sola ruta por tarea es una cosa menos que puede salir mal—
pero **`.gitignore` no los deja entrar al repo**. Son andamio: qué se pensaba hacer y cómo se
hizo. Guardados, dejan de coincidir con el código en cuanto alguien lo toca, y entonces son
peor que nada, porque alguien se los cree. Lo que perdura es **qué se pidió**, **por qué se hizo así — o por qué no se hizo** y **qué se
verificó**; lo demás lo cuenta el código y su historia de git. La crítica se queda con los dos
primeros: no describe código, describe una decisión, y una tarea descartada sin su motivo
escrito se vuelve a abrir al mes siguiente.

Que sea el `.gitignore` y no esta frase quien lo impida es deliberado: un `git add` distraído
no puede saltarse un candado, pero se salta un párrafo sin enterarse.

Para lo mecánico, el rastro de verdad no es prosa: es el guion en `qa/guiones/` que cualquiera
puede volver a correr.

## Montar un worktree para un ingeniero o una QA

Un worktree nuevo (`git worktree add ../ne-fan-<tarea> …`) nace SIN nada de lo que git ignora, y
eso incluye la red que hace verdes los guiones. Ha mordido tres veces (2026-09-03 dos, 2026-09-06
una): los guiones 70 y 71 salen rojos «sobre la base» diciendo otra cosa. La receta, entera:

```bash
git worktree add -b <rama> ../ne-fan-<tarea> main        # o --detach <sha> para una QA
cd ../ne-fan-<tarea>
(cd nefan-core && npm ci && npm run build)               # el build lo importan bridge y narrative-mcp
(cd narrative-mcp && npm ci)
(cd nefan-html && npm ci)
(cd qa && npm ci)                                        # playwright-core: sin él no hay batería
cp -r ../ne-fan/nefan-html/public/sprites nefan-html/public/   # las hojas base (~28 MB, ignoradas)
mkdir -p docs/agents/<tarea> && cp ../ne-fan/docs/agents/<tarea>/{plan,implementacion*}.md docs/agents/<tarea>/
```

Sin las hojas de sprites el cliente se niega a empezar partida («Faltan las hojas de sprites…») y
la batería lo cuenta como fallo del guion, no como red incompleta (#476 pide que el runner salga `⊘`).
Y al recoger: copia `plan.md`/`implementacion*.md` al checkout principal ANTES de `git worktree remove`,
porque el `.gitignore` los deja fuera y `remove --force` se los lleva.

**`--parar` es por árbol, no por bloque de puertos.** `NEFAN_PORT_OFFSET=100 ./start.sh --parar`
para todo lo que demuestre ser de ESTE worktree en los diez bloques, y la batería de `qa/run.mjs`
que arrancaste desde el mismo árbol también lo es: una pasada de ojos y una batería en el mismo
worktree no se pueden parar por separado.

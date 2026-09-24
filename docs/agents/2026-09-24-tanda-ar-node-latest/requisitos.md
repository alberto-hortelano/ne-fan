# Requisitos — tanda AR: Node a la última, sin fijar versión, y fuera el reporter de #697

## Petición literal del usuario

> «Sube node a latest, mientras estemos en desarrollo no fijamos version. Mutacion lanzada, sigue con la siguiente tanda. Los assets ya pagados o no es algo que tenemos que sacar del codigo, debe ser configuracion y no volver a generar por defecto mientras estemos en desarrollo, no queremos que recargas automaticas y pruebas gasten creditos pero cuando estemos en prod si.» (2026-09-24)

Esta tanda cubre la primera frase. Es la respuesta a una duda que le planteó el coordinador: «subir `engines` a >=24.15 y el Node local, y retirar el reporter de #697».

## Contexto

- La máquina local ya está en Node **v26.10.0**: el coordinador lo hizo con `nvm install node` y `nvm alias default node`. Antes estaba en 24.11.1. Puede que haga falta reconstruir módulos nativos (`npm ci`/`npm rebuild`) en los checkouts.
- CI fija `node-version: 24` en `.github/workflows/ci.yml` (4 sitios) y en `mutation.yml` (3 sitios). `nefan-core/package.json` declara `engines: {node: ">=24"}`.
- **#697 (PR #726):** Node < 24.15 salía con 0 cuando el cuerpo de un `describe` lanzaba. Por eso se añadió un reporter, `nefan-core/test/la-suite-que-falla-pone-rojo.ts`, con su unitario `test/una-suite-que-falla-pone-rojo.test.ts`. También controles que miden la versión y hacen skip o log según ella (en `qa/contrato-candados-en-negativo.mjs` y en el guion 165 `qa/guiones/165-una-suite-que-lanza-pone-rojo-cada-entrada-al-runner.mjs`), y filas en `qa/README.md`.

## Criterios de aceptación

1. CI (`ci.yml` y `mutation.yml`) corre con la **última** versión de Node, sin fijar un número. Verifica qué alias acepta `actions/setup-node` (`latest`, `current` o `node`) y **mide** en el log del runner la versión que resolvió.
2. `engines`: nada de fijar versión. Como mucho, un suelo justificado por un requisito real y medido: el que hace innecesario el reporter, o el de `node:sqlite`. Si lo quitas, dilo.
3. Se retira el reporter de #697 y todo lo que existía solo por Node < 24.15: el reporter, su registro en los scripts de `package.json`, las ramas de skip/log por versión y los rastros en docs y comentarios (`grep` a cero). El fallo de fondo sigue candado: una suite cuyo `describe` lanza pone rojo `npm test`, coverage y el arnés de contrato, ahora por el propio Node. Deben seguir los negativos que lo demuestran (guion 165 y `contrato-candados-en-negativo`), ya sin rama por versión. Si un negativo deja de tener sentido, se borra y se dice qué cobertura se pierde.
4. Si hay otros sitios que existían solo por un Node viejo, retíralos. Si Node 26 rompe algo (deprecaciones, `node:sqlite`, `--experimental-*`, cambios de `node --test`), se arregla aquí.
5. `npm run verify` verde en local con Node 26, y CI verde en la PR.

## Restricciones

Cero créditos. Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador.

# Requisitos — Tanda K «El cliente se puede probar»

## La petición

Cita literal del usuario (2026-09-17):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

## Los cuatro issues, y por qué van juntos

**#636 es el techo y #543 es lo que lo sostiene.** `nefan-html` **no tiene banco de tests unitarios** —0
ficheros y ni script `test`, contra 156 en core—, así que toda decisión del cliente o emigra a core o se
prueba a 30 s con navegador. Y una de las razones por las que no se puede empezar está medida: **importar
`ui/titulo/atomos.ts` en Node revienta con `location is not defined`** (`:144` y `:148` llaman a
`serviceUrl` AL CARGAR el módulo), y ese fichero lo importan las **siete** hojas del título.

| Issue | Qué | Estado medido hoy (`main` = `81735f13`) |
|---|---|---|
| **#636** | `nefan-html` sin banco de tests unitarios | La regla «lógica en core» está sostenida **en parte por una CARENCIA** |
| **#543** | `atomos.ts` llama a `serviceUrl` al cargar | **VIVO**, verificado: `:144` `ASSET_STORE_URL`, `:148` `AI_SERVER_HTTP` |
| **#555** | 12 parejas de acoplamiento por id de DOM entre módulos del título, **6 sin red** | Reserva de la QA que dictaminó que #346 REPARTIÓ |
| **#654** | `const size = 0.5; // TILE_MPC` en `main.ts:514` | **VIVO**. `fps-gl.ts:35` ya importa `TILE_MPC` de core, así que el arreglo suelto son dos líneas |

## El bloqueo que ya está escrito y hay que respetar

La cabecera de `atomos.ts` (`:14-30`) dice, con todas las letras, que hacer las constantes **perezosas**
(funciones en vez de constantes) **arregla** el problema —«probado»— pero **perturbó dos corridas de dos
del guion 80 sin que nadie encontrara el mecanismo**, y por eso no viajó en la PR de movimiento: «un
cambio que no se sabe explicar no entra en la PR que promete no cambiar el comportamiento».

**Eso es exactamente lo que esta tanda tiene que resolver o declarar.** Si el mecanismo aparece, se
arregla; si no aparece, se dice por qué no y se apunta, pero **no se mete a ciegas**.

## Lo que el crítico tiene que decidir

1. **¿#636 cabe en una tanda?** Montar un banco de tests para el cliente es infraestructura, no un
   arreglo. Decide si el alcance sensato es **el banco mínimo + un primer sujeto** (y cuál), o si es un
   programa como lo fueron #358, #346 y #241. Si es programa, **dilo y propón el corte**.
2. **¿#543 se arregla en esta tanda o es su primer paso?** Es el bloqueo medido de #636.
3. **¿#555 entra?** El candado `las-hojas-del-titulo-no-se-atan-entre-si` no ve estas parejas porque
   prohíbe imports y esto son **cadenas de ids de DOM**. Verifica cuántas de las 12 siguen vivas y
   cuántas siguen sin red: el issue es del 2026-09-09 y aquí los issues caducan en horas.
4. **#654 es de dos líneas** y no necesita crítica, pero sí una decisión: el arreglo suelto deja el
   agujero abierto para el siguiente. ¿Se amplía la regla `la-fisica-no-se-copia-a-mano` o se declara en
   su `why` que no se puede cazar honestamente? Su `why` ya declara que un nombre nuevo (`RADIO_BICHO =
   0.7`) se le escapa; `0.5` es medio de cualquier cosa, así que un `grep` inundaría de falsos positivos.
   Si no sale un candado honesto, **mejor decirlo que fingirlo**.

## Lo que la tanda NO debe hacer

- **No meter el cambio de `atomos.ts` sin explicar el mecanismo** de las dos corridas del guion 80.
- **No mover lógica a core solo para poder probarla.** #241 ya movió lo que tenía que moverse (8 PR,
  cliente 14.466 → 14.116); lo que queda en el cliente es presentación derivada y está ahí a propósito.
- **No bajar ningún umbral** y no tocar la cifra de `main.ts` (hoy **1.378**, clavada desde la tanda G)
  sin anotarla con motivo en `client-file-size.json`.

## Restricciones

- **Cero créditos**: motor falso, `html-fixtures`, `e2e-sin-creditos`.
- **Bloque de puertos 900**: `NEFAN_PORT_OFFSET=900 ./start.sh --preset <slug>` desde el árbol
  `/home/al/code/ne-fan-k-cliente`, y `--parar` con el mismo offset desde el mismo árbol. **Nunca
  `--parar-todo`, nunca `pkill`, nunca matar por puerto.** Hay otros agentes trabajando.
- Log de corrida larga: `bateria-k.log`.
- Una retirada incluye prosa, comentarios y docs: `grep` a cero.
- Solo se commitean `requisitos.md`, `critica.md` y `qa*.md`.

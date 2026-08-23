# Requisitos — plugins: evolución en runtime (#164)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo
> que puedas con el flujo de agentes»

Es la orden de vaciar la cola de issues abiertos del repo. Esta es la segunda tanda; el issue
#164 es el más antiguo que sigue vivo.

## El issue

**#164 — «Evolución de plugins en runtime: plugin_register no migra por versión»**

> `nefan-core/src/plugins/register.ts`. Hoy la migración v→v+1 **solo opera en resume**
> (`bindPluginsForResume`): un `plugin_register` con `version` mayor que el plugin vigente
> añade un segundo record coexistente en lugar de migrar y reemplazar.
>
> **Alcance** (lo dejó escrito §7.3 "Evolución"): detectar mismo `name` con `version` mayor que
> un record activo, ejecutar `migrate` sobre su slice reutilizando `runMigrationStep`, y
> sustituir el record igual que hace el resume — o rechazar fail-loud si la cadena de
> migraciones no cubre el salto.
>
> Es lo ÚNICO que queda del roadmap §7 (F1–F8 cerrado). El sistema de plugins es funcional sin
> esto.

`docs/arquitectura/plugins.md` lo confirma en dos sitios: *«Evolución en runtime (vía
`plugin_register` con versión mayor) aún pendiente»* y *«**Pendiente** (único, opcional):
evolución en runtime vía `plugin_register`»*.

## Lo que ya se ha verificado sobre el repo (no hay que volver a averiguarlo)

Comprobado sobre `main`. Rutas y líneas reales.

**La causa exacta está en un `continue`.** `nefan-core/src/plugins/loader.ts:188-192`:

```ts
for (const record of state.plugins) {
  // Plugins generados por la IA llevan el manifest embebido en el save (F5).
  if (record.manifest) {
    active.set(record.id, record.manifest);
    continue;                                  // ← ni mira `version`
  }
```

Y `register.ts:110` **siempre** embebe el manifest para registros de runtime (el comentario lo
dice: *«no hay archivo en disco del que releerlo en resume (§7.6)»*). Consecuencia: un plugin
registrado por el motor narrativo **siempre** entra por ese `continue` y **nunca** llega al
bloque de migración. La migración solo existe para el camino FS (`byName`, `loader.ts:200-215`).

**Por qué no choca el registro duplicado.** `register.ts:64-68` lanza `PluginRegisterError` si
`state.getPluginRecord(id)` existe… pero el `id` es `sha256` del manifest canónico
(`computePluginId`, `register.ts:56`), así que **una versión nueva tiene id nuevo y no choca**:
se registra como un segundo plugin independiente con su slice inicial, y el slice viejo queda
huérfano en `state.plugins`.

**Las piezas para el arreglo ya existen y están probadas**:
- `migrateSliceForResume` (`loader.ts:246-300`) — exige `to > from`, exige `migrate[v]` para
  cada `v` en `[from, to)`, fail-loud ante hueco o degradación.
- `runMigrationStep` (`src/plugins/dsl/evaluate.ts:161`) — slice-only y puro.
- `state.migratePluginRecord(id, {id, version, slice})` — la sustitución que hace el resume
  (`loader.ts:202-206`).

**Forma del record** (`src/plugins/types.ts:203-218`): `{id, name, version, slice, origin,
activated_at, manifest?}`. El resume «adopta id/version/slice nuevos preservando name/origin».

**Cobertura actual**: `test/plugin-migrate.test.ts` cubre bien el camino FS (v1→v2 feliz,
idempotencia, `/falta 'migrate\[1\]'/`, `/mantiene version 1/`, `/ANTERIOR al del save/`,
slice-only). **Todos parten de `LoadedPlugin[]` del FS.** El único test del camino embebido es
`test/plugin-register.test.ts:130` (`bindPluginsForResume(s2, [])`), y usa la MISMA versión.
Ese es exactamente el hueco.

Call site de producción del resume: `bridge/handlers/session.ts:474`. La tool MCP
`plugin_register` entra por `POST /plugins/register` del State API.

## Criterios de aceptación

1. Un `plugin_register` con el mismo `name` y `version` mayor que un record activo **migra y
   sustituye**: el record resultante tiene el id, la versión y el slice nuevos, preserva `name`
   y `origin`, y **no quedan dos records del mismo `name`**.
2. Si la cadena `migrate` no cubre el salto (hueco, o `migrate` ausente), **se rechaza
   fail-loud** con un mensaje que diga qué falta — el mismo criterio y, si se puede, el mismo
   texto que ya usa el resume (`/falta 'migrate\[N\]'/`).
3. Una versión **menor o igual** que la activa se rechaza (degradación), como en el resume.
4. Un `name` distinto sigue registrándose como plugin nuevo: esto no puede convertir dos
   plugins legítimos en una migración.
5. La migración es **slice-only**: escribir fuera del slice o emitir eventos lanza, igual que en
   el resume. Se reutiliza `runMigrationStep`, no se escribe un evaluador paralelo.
6. **Tras migrar, el resume sigue siendo idempotente**: guardar y rehidratar la sesión da el
   mismo record (el manifest nuevo queda embebido).
7. Tests por el camino EMBEBIDO en `test/plugin-migrate.test.ts` (hoy no hay ninguno). Cubren
   los criterios 1-6, incluidos los casos inválidos.
8. `npm run verify` verde, la deuda del módulo sin crecer (`npm run crap -- --check`), y los
   **mutantes supervivientes del módulo tocado, muertos** (`src/plugins/dsl/**` es objetivo de
   mutación; si el cambio cae en `loader.ts`/`register.ts`, que no lo son, dilo en el informe).
9. `docs/arquitectura/plugins.md` deja de decir «pendiente» en los dos sitios donde lo dice.
10. CI de la PR entero en verde.

## Fuera de alcance

- Cambiar el esquema del manifest o el cálculo de `plugin_id`.
- Tocar el camino FS del resume, que funciona.
- Los otros issues abiertos.

## Preguntas abiertas

- ¿Dónde vive la detección: en `registerRuntimePlugin` (`register.ts`) o en una función nueva
  compartida con `bindPluginsForResume`? Hoy la lógica de migración vive entera en `loader.ts`
  y `register.ts` no la importa. **Recomendación esperada, no un empate** — con el criterio de
  que la cadena de migración no se duplique.
- El `PluginRegisterError` de `register.ts:64` («ya está activo en esta sesión») se dispara por
  id, no por nombre. ¿Sigue teniendo sentido tal cual cuando el mismo `name` con la misma
  versión se re-registra?

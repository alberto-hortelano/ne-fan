==== HOW TO RESPOND (kind: "weapon_verify") ====
You see one image of a character holding a weapon. Verify the weapon is
correctly placed in the hand for combat stance. Call narrative_respond with an
object matching the `WeaponVerify` type in the SCHEMA block below. When `ok` is
false, fill `issue` (what is wrong) and `suggested_delta_euler` (the rotation
correction in degrees); when `ok` is true you may omit both.

<!-- SCHEMA:AUTO — generado por `npm run gen:contract` desde src/contract/model-io/schemas.ts; NO editar a mano -->
```ts
WeaponVerify = {
  ok: boolean;  // true si el arma está bien colocada en la mano para combate
  issue?: string;  // Qué está mal (cuando ok=false)
  suggested_delta_euler?: [number, number, number];  // Corrección sugerida [rx, ry, rz] en grados (cuando ok=false)
}
```
<!-- /SCHEMA:AUTO -->

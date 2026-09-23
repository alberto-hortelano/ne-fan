#!/usr/bin/env bash
# Impide dar una tarea por terminada mientras el CI de la PR de esta rama no
# esté ENTERO en verde. Hook `Stop` — ver .claude/settings.json.
#
# Por qué existe: el 2026-08-20 se abrió la PR #177 anunciándola como
# verificada. `npm run verify` estaba verde EN LOCAL y el check `nefan-core`
# estaba rojo en CI (un enlace simbólico a un directorio generado que no existe
# en el runner). Verde en local no es verde: el runner tiene otro sistema de
# ficheros, otras dependencias y ninguna caché.
#
# No estorba al trabajo normal: si la rama no tiene upstream, no tiene PR o su
# PR ya está mergeada o cerrada, no hay CI que esperar y sale en silencio.
#
# Una PR ABIERTA sin ningún check NO es «nada que esperar» (#709): GitHub no
# lanza el workflow `pull_request` de una rama en conflicto
# (`mergeable_state: dirty`), así que el CI no sale rojo, sale AUSENTE — y eso
# se confundía con verde. Ahora bloquea, y también bloquea una PR en conflicto
# aunque sus checks (de un sha anterior) estén verdes. Negativo en
# `nefan-core/test/hook-ci-verde.test.ts`.

set -uo pipefail

# Sin repo, en main, o sin rama subida: nada que esperar.
rama=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$rama" in "" | HEAD | main) exit 0 ;; esac
git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || exit 0

sha=$(git rev-parse HEAD 2>/dev/null) || exit 0

# Backstop de bucle: si ya ha avisado muchas veces para ESTE commit, deja pasar
# con aviso. Sin esto, un CI que nunca converge deja la sesión atascada.
estado="$(git rev-parse --git-dir)/claude-ci-verde"
previo=$(grep -F "$sha " "$estado" 2>/dev/null | tail -1 | awk '{print $2}')
veces=$(( ${previo:-0} + 1 ))
if [ "$veces" -gt 6 ]; then
  printf '{"systemMessage":"CI aún no verde en %s, pero el guardia ya ha avisado %s veces para este commit: deja de bloquear. Compruébalo a mano con `gh pr checks`."}\n' "$rama" "$previo"
  exit 0
fi

# `gh` puede no estar instalado, no estar autenticado, o la red puede fallar.
# Nada de eso es motivo para bloquear al usuario: fail-open explícito.
# El filtrado va en `jq` local y no en `gh --jq`: así el hook se prueba con un
# `gh` falso que solo imprime JSON.
pr=$(timeout 25 gh pr view --json state,mergeable,statusCheckRollup 2>/dev/null) || exit 0
[ -n "$pr" ] || exit 0
[ "$(printf '%s' "$pr" | jq -r '.state // ""')" = "OPEN" ] || exit 0
checks=$(printf '%s' "$pr" | jq -c \
  '[(.statusCheckRollup // [])[] | {n: (.name // .context), s: (.status // "COMPLETED"), c: (.conclusion // .state // "")}]')

# En conflicto bloquea AUNQUE los checks estén verdes: son de un sha anterior
# al conflicto, y el workflow del merge con main no va a correr hasta rebasar.
mergeable=$(printf '%s' "$pr" | jq -r '.mergeable // "?"')
if [ "$mergeable" = "CONFLICTING" ]; then
  echo "$sha $veces" >> "$estado"
  motivo="La PR de \`$rama\` está EN CONFLICTO con main (mergeable: CONFLICTING). GitHub no lanza el workflow de una rama en conflicto, así que los checks que se vean son de antes y no valen. Haz rebase sobre main, resuelve, sube y espera al CI."
  jq -cn --arg r "$motivo" '{decision:"block", reason:$r}'
  exit 0
fi
if [ "$checks" = "[]" ]; then
  echo "$sha $veces" >> "$estado"
  motivo="La PR de \`$rama\` está abierta y NO tiene ningún check (mergeable: $mergeable). Ausente no es verde. Si acabas de subir, espera a que aparezcan (\`gh pr checks\`); si no aparecen, mira si la rama está en conflicto con main."
  jq -cn --arg r "$motivo" '{decision:"block", reason:$r}'
  exit 0
fi

corriendo=$(printf '%s' "$checks" | jq -r '[.[] | select(.s != "COMPLETED")] | length')
rojos=$(printf '%s' "$checks" | jq -r \
  '[.[] | select(.c | test("FAILURE|CANCELLED|TIMED_OUT|ERROR|STARTUP_FAILURE"))] | .[].n' | paste -sd", ")

[ "$corriendo" = "0" ] && [ -z "$rojos" ] && exit 0

echo "$sha $veces" >> "$estado"

if [ -n "$rojos" ]; then
  motivo="El CI de la PR de \`$rama\` está EN ROJO: $rojos. No des la tarea por terminada. Lee el log con \`gh run view --job <id> --log-failed\`, REPRODUCE el fallo en local, arréglalo, sube y vuelve a esperar. Verde en local no es verde."
else
  motivo="El CI de la PR de \`$rama\` sigue corriendo ($corriendo checks sin terminar). Espera a que acabe antes de dar nada por hecho. Para esperar: \`gh run list -L5 --json databaseId,headBranch,status\`, coge el databaseId de la rama y \`gh run watch <id>\`; o repite \`gh pr checks\`. OJO: el \`gh\` de esta máquina es 2.4 — NO tiene \`gh pr checks --watch\` ni \`gh run list -b\`. Verde en local no es verde."
fi

jq -cn --arg r "$motivo" '{decision:"block", reason:$r}'

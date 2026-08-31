# Assets de personaje (ejemplo: Mixamo)

Los FBX de esta carpeta **no están en el repositorio**: Adobe no permite redistribuir los
archivos raw de Mixamo, ni derivados suyos. Por eso `assets/characters/` y
`nefan-html/public/sprites/` están los dos en `.gitignore`.

**Esto es un ejemplo, no un requisito.** Vale cualquier set de rigs humanoides y cualquier
pack de animaciones: quien despliega pone los suyos y describe qué ofrece en el fichero de
set de sprite-forge (`sets/*.json` en `~/code/sprite-forge`). Lo que este documento describe
es el set que usamos nosotros, que resulta ser Mixamo porque ya lo teníamos descargado.

## La estructura que espera el set `mixamo`

La raíz de assets que se le pasa a sprite-forge es **`assets/characters/`** (no
`assets/characters/mixamo/`: el propio set añade ese tramo).

```
assets/characters/
├── mixamo/<id>/character.fbx        ← un modelo por carpeta; el nombre de la carpeta ES su id
├── mixamo/ambient_anims/*.fbx       ← clips de ambiente (talking, drinking, waving…)
└── anims/sword_and_shield/*.fbx     ← el pack de combate y locomoción
```

`sets/mixamo.json` declara **16 animaciones** con su fichero, sus `keyframes` y su `play_fps`.
De ellas, las **10 primeras son las `BASE_ANIMS`** que el cliente necesita para que alguien
tenga cuerpo: `idle`, `walk`, `run`, `quick`, `heavy`, `medium`, `defensive`, `precise`,
`hit_react`, `death`. Las otras seis son de ambiente y solo las usa la vida de los NPCs.

En esta máquina hay 22 modelos y 54 clips de combate; el catálogo completo son **320 hojas**,
muy por encima del tope de 32 por petición. Se renderiza por lotes, nombrando modelos y
animaciones — ver la sección «Characters, on a fresh clone» del [README raíz](../README.md).

## Descargar un set desde Mixamo

1. Entrar en [mixamo.com](https://www.mixamo.com/) con una cuenta Adobe gratuita.
2. Descargar el personaje en **FBX** (T-pose, sin animación) y guardarlo como
   `mixamo/<id>/character.fbx`. El modelo base del juego es `y_bot`, el rig genérico de Mixamo.
3. Descargar el pack **Sword and Shield** en FBX *with skin* y dejar los clips en
   `anims/sword_and_shield/`, con el nombre tal cual lo da Mixamo — `sets/mixamo.json` los
   busca por ese nombre (`sword and shield idle.fbx`, `sword and shield slash (3).fbx`…).

## El desplegable del título se llena solo

El editor de personaje deriva su lista de modelos del **censo vivo** del dev server
(`GET /sprites/index.json`, que escanea `nefan-html/public/sprites/` en cada petición):
un modelo aparece en el desplegable cuando tiene **las 10 hojas base completas** en disco,
y desaparece si le falta una. No hay lista que actualizar — renderiza el set completo de un
modelo con sprite-forge, recarga el título (F5) y está ofrecido (#216).

## Dos cosas que se aprendieron por las malas

- **Animaciones de ataque SIN pasos hacia delante**: `attack (4)`, `slash`, `slash (5)`,
  `slash (3)`. sprite-forge congela Hips en XZ en los clips marcados como locomoción, y un
  ataque con pasos desliza los pies al congelarlo.
- **El juego arranca sin estos assets, pero nadie tiene cuerpo.** No es una degradación
  elegante: sin las 10 hojas de `y_bot` el fallback tampoco existe (#255).

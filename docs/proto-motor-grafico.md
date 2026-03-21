# CLAUDE.md — AI-Rendered RPG Engine

## Visión del proyecto

RPG 3D en Unreal Engine 5 donde **ningún asset artístico es creado por humanos**. El motor de historia (LLM) genera misiones, personajes y objetos en tiempo de ejecución. El motor visual (StreamDiffusion + ControlNet) transforma geometría primitiva en gráficos detallados frame a frame. DLSS 4 Multi Frame Generation multiplica los FPS del resultado final.

### Principio central

Cada objeto del juego es una **entidad semántica**: tiene una representación 3D mínima (primitivo geométrico) y una descripción en lenguaje natural. La IA visual usa la descripción para decidir qué pintar; el motor de física usa la geometría para decidir cómo colisionar.

```
LLM genera → { mesh: "box", description: "cofre de roble con herrajes oxidados", state: "locked" }
UE5 instancia → BoxMesh gris en posición X
ControlNet recibe → depth map + "rusty oak chest, dungeon, torchlight"
ControlNet devuelve → frame fotorrealista con el cofre en la misma posición
DLSS 4 multiplica → ×8 frames interpolados
```

---

## Stack tecnológico

| Capa | Tecnología | Propósito |
|---|---|---|
| Motor de juego | Unreal Engine 5.4+ | Física, lógica, render base, exportación GBuffer |
| Lenguaje juego | C++ + Blueprints | Lógica de actores y sistemas |
| AI visual | Python 3.11 + StreamDiffusion | Server local de transformación de frames |
| Modelo difusión | SD 1.5 + LCM-LoRA + ControlNet Depth | img2img en tiempo real |
| Upscaling | DLSS 4 Multi Frame Generation | ×8 FPS sobre frames AI |
| Motor de historia | Claude API (claude-sonnet-4-5) | Generación estructurada de contenido RPG |
| LLM local | Ollama + Mistral 7B | Barks de NPC, descripciones de ítems, diálogos frecuentes |
| Comunicación | Named pipes / shared memory | UE5 ↔ Python server (latencia mínima) |
| Serialización | JSON + FlatBuffers | World state y frame metadata |

---

## Estructura del proyecto

```
/
├── CLAUDE.md                          ← este archivo
├── Source/
│   └── AIRpg/
│       ├── Core/
│       │   ├── SemanticActor.h/.cpp           # Actor base con description string
│       │   ├── SemanticComponent.h/.cpp        # Componente adjuntable a cualquier Actor
│       │   ├── WorldStateManager.h/.cpp        # Snapshot serializable del estado del mundo
│       │   └── GameEventBus.h/.cpp             # Bus de eventos para comunicación entre sistemas
│       ├── Rendering/
│       │   ├── DepthBufferExporter.h/.cpp      # Custom render pass → exporta depth PNG por pipe
│       │   ├── AIFrameReceiver.h/.cpp          # Recibe frames transformados del Python server
│       │   ├── SemanticPromptCompiler.h/.cpp   # Objetos visibles → scene prompt string
│       │   └── FrameBlender.h/.cpp             # Cross-fade entre frames AI consecutivos
│       ├── Narrative/
│       │   ├── LLMClient.h/.cpp               # Wrapper HTTP para Claude API y Ollama
│       │   ├── StoryEngine.h/.cpp             # Orquestador principal del motor de historia
│       │   ├── ObjectSpawner.h/.cpp            # JSON → instancia Actor semántico en el mundo
│       │   ├── QuestManager.h/.cpp             # Estado y progresión de misiones
│       │   └── NPCBrain.h/.cpp                 # Comportamiento e identidad de personajes
│       └── Schemas/                            # Structs C++ que reflejan los JSON del LLM
│           ├── SpawnableObject.h
│           ├── QuestSchema.h
│           └── NPCSchema.h
├── ai_server/                                  # Proceso Python independiente
│   ├── main.py                                 # Entry point, gestiona pipe IPC
│   ├── diffusion_pipeline.py                   # StreamDiffusion + ControlNet
│   ├── frame_manager.py                        # Cache, ordering, cross-fade metadata
│   ├── prompt_utils.py                         # Helpers de prompt building
│   └── requirements.txt
├── Content/
│   ├── Primitives/                             # Meshes base (cubo, esfera, cápsula, cono, plano)
│   ├── Blueprints/
│   │   ├── BP_SemanticActor.uasset
│   │   ├── BP_SemanticNPC.uasset
│   │   └── BP_SemanticItem.uasset
│   └── Maps/
│       └── TestMap.umap                        # Mapa de desarrollo inicial
└── Config/
    ├── ai_server_config.json                   # Modelo SD, parámetros ControlNet, puerto pipe
    └── narrative_config.json                   # System prompts, temperaturas LLM, schemas
```

---

## Sistema de objetos semánticos

### SemanticComponent (C++)

Todo Actor del juego que deba ser transformado por IA tiene este componente.

```cpp
UCLASS(ClassGroup=(AIRpg), meta=(BlueprintSpawnableComponent))
class AIRPG_API USemanticComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    // Descripción en lenguaje natural para el prompt de difusión
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Semantic")
    FString Description;

    // Categoría semántica para agrupación en el prompt
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Semantic")
    FString Category; // "building" | "creature" | "item" | "terrain" | "prop"

    // Estado actual del objeto
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Semantic")
    FString State; // "intact" | "damaged" | "burning" | "open" | "locked"

    // Tono emocional que aporta a la escena
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Semantic")
    FString Mood; // "ominous" | "peaceful" | "mysterious" | "hostile"

    // Si true, se incluye en el prompt aunque esté parcialmente fuera del frustum
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Semantic")
    bool bAlwaysIncludeInPrompt = false;

    // Peso de influencia en el prompt (0.0–1.0). Objetos cercanos = más peso
    float GetPromptWeight(const FVector& CameraLocation) const;

    // Serializa este componente para el world state snapshot
    FString ToJSON() const;
};
```

### Ejemplos de objetos generados por el LLM

```json
{
  "type": "item",
  "mesh": "box",
  "scale": [0.6, 0.4, 0.4],
  "description": "A weathered oak chest with rusted iron bands, slightly ajar, faint golden glow from inside",
  "category": "item",
  "state": "unlocked",
  "mood": "mysterious",
  "spawn_position": [340.0, 0.0, 50.0],
  "game_data": {
    "loot_table": "dungeon_common",
    "interaction": "open_chest"
  }
}
```

```json
{
  "type": "npc",
  "mesh": "capsule",
  "scale": [1.0, 1.0, 1.8],
  "description": "A hooded merchant of advanced years, grey beard, leather apron, carrying a heavy pack",
  "category": "creature",
  "state": "idle",
  "mood": "neutral",
  "spawn_position": [800.0, 200.0, 0.0],
  "game_data": {
    "name": "Aldric",
    "faction": "traders_guild",
    "dialogue_seed": "merchant_generic_01",
    "shop_inventory": "potions_herbs"
  }
}
```

---

## Pipeline de rendering AI

### Flujo de datos por frame

```
[UE5 - game thread]
  │
  ├─ SemanticPromptCompiler::CompileScenePrompt()
  │    └─ Itera actores visibles en frustum
  │    └─ Ordena por distancia a cámara
  │    └─ Construye prompt: "fantasy RPG, {desc1}, {desc2}, ..."
  │    └─ Añade style token global: "concept art, detailed, 8k"
  │
  └─ DepthBufferExporter::CaptureFrame()
       └─ SceneCaptureComponent2D en resolución 512×512
       └─ Captura ESceneCaptureSource::SCS_SceneDepth
       └─ Exporta raw buffer por named pipe → Python

[Python server - ai_server/main.py]
  │
  ├─ Recibe: depth_buffer (512×512 float32) + prompt string + frame_id
  │
  ├─ diffusion_pipeline.py::transform_frame()
  │    ├─ Normaliza depth → imagen PIL
  │    ├─ StreamDiffusion img2img
  │    │    ├─ Model: runwayml/stable-diffusion-v1-5
  │    │    ├─ ControlNet: lllyasviel/control_v11f1p_sd15_depth
  │    │    ├─ LCM-LoRA: latent-consistency/lcm-lora-sdv1-5
  │    │    ├─ Steps: 2–4
  │    │    ├─ Strength: 0.65  ← sweet spot preservación/detalle
  │    │    └─ Seed: deterministic por camera_hash (consistencia temporal)
  │    └─ Retorna: frame RGB (512×512 JPEG, quality=85)
  │
  └─ frame_manager.py
       ├─ Verifica ordering (descarta frames obsoletos)
       ├─ Almacena en ring buffer (últimos 4 frames)
       └─ Envía resultado por pipe → UE5

[UE5 - render thread]
  │
  ├─ AIFrameReceiver::OnFrameReceived()
  │    └─ Actualiza UTexture2D dinámica con el frame AI
  │
  ├─ FrameBlender::BlendFrames()
  │    └─ Cross-fade lineal entre frame anterior y nuevo (8 frames UE5 = ~133ms)
  │
  └─ Post-process material aplica la textura AI sobre el viewport
       └─ DLSS 4 Multi Frame Generation actúa sobre el output final
```

### Parámetros críticos de StreamDiffusion

```python
# ai_server/diffusion_pipeline.py

PIPELINE_CONFIG = {
    "model_id": "runwayml/stable-diffusion-v1-5",
    "controlnet_id": "lllyasviel/control_v11f1p_sd15_depth",
    "lcm_lora_id": "latent-consistency/lcm-lora-sdv1-5",
    "width": 512,
    "height": 512,
    "num_inference_steps": 3,       # LCM permite 2-4 pasos con buena calidad
    "strength": 0.65,               # Más bajo = más fiel a la geometría original
    "guidance_scale": 1.0,          # LCM requiere guidance_scale bajo (1.0–2.0)
    "controlnet_conditioning_scale": 0.9,
    "use_tiny_vae": True,           # TAESD: 10× más rápido en decode
    "t_index_list": [0, 16, 32],    # StreamBatch timesteps
    "use_denoising_batch": True,
    "frame_buffer_size": 1,
}

# El seed se calcula como hash de la posición/rotación de cámara cuantizada
# Esto produce seeds estables mientras la cámara no se mueve significativamente
def get_camera_seed(camera_pos: tuple, camera_rot: tuple, quantize: float = 50.0) -> int:
    qpos = tuple(round(v / quantize) for v in camera_pos)
    qrot = tuple(round(v / 15.0) for v in camera_rot)
    return abs(hash((qpos, qrot))) % (2**32)
```

### Comunicación UE5 ↔ Python (Named Pipes)

```cpp
// Source/AIRpg/Rendering/DepthBufferExporter.cpp

// Protocolo de mensajes por pipe:
// [4 bytes] frame_id (uint32)
// [4 bytes] prompt_length (uint32)
// [N bytes] prompt string (UTF-8)
// [4 bytes] depth_width (uint32)
// [4 bytes] depth_height (uint32)
// [W*H*4 bytes] depth data (float32, row-major)

// Respuesta del server:
// [4 bytes] frame_id (uint32) — para verificar ordering
// [4 bytes] jpeg_length (uint32)
// [N bytes] jpeg data
```

---

## Motor de historia (LLM)

### World State

El LLM siempre recibe un snapshot completo del estado del mundo antes de generar contenido. Mantenerlo conciso es crítico para no desperdiciar tokens de contexto.

```json
{
  "world": {
    "region": "The Ashwood Dungeon, level 2",
    "time_of_day": "eternal_darkness",
    "atmosphere": "ancient, dangerous, forgotten",
    "style_token": "dark fantasy concept art, detailed stone architecture"
  },
  "player": {
    "level": 3,
    "class": "rogue",
    "health": 68,
    "gold": 142,
    "active_quests": ["find_the_missing_merchant"],
    "inventory_summary": "shortsword, lockpicks, 2x health potion"
  },
  "current_room": {
    "visited": false,
    "existing_objects": [],
    "exits": ["north", "east"]
  },
  "story_so_far": "Brief 2-3 sentence summary of recent events"
}
```

### Schemas de generación estructurada

Claude API se llama con `tool_use` para forzar output JSON válido.

```json
{
  "name": "populate_room",
  "description": "Populates a room with objects, enemies and story elements",
  "input_schema": {
    "type": "object",
    "properties": {
      "room_description": {
        "type": "string",
        "description": "2-3 sentence atmospheric description for the player"
      },
      "objects": {
        "type": "array",
        "items": { "$ref": "#/definitions/SpawnableObject" },
        "maxItems": 8
      },
      "npcs": {
        "type": "array",
        "items": { "$ref": "#/definitions/NPC" },
        "maxItems": 3
      },
      "ambient_event": {
        "type": "string",
        "description": "Optional single atmospheric event (sound, movement, smell)"
      }
    },
    "required": ["room_description", "objects"]
  }
}
```

### System prompt del motor de historia

```
You are the narrative engine of a dark fantasy RPG. You generate world content as structured data.

RULES:
- Every object you create must have a vivid, specific visual description (used for AI image generation).
  Bad: "a chest". Good: "a weathered oak chest with rusted iron bands, slightly ajar, faint golden glow inside".
- Descriptions must be in English (used as Stable Diffusion prompts).
- Keep descriptions under 25 words. They will be concatenated with other descriptions.
- Mesh types available: box, sphere, capsule, cylinder, cone, plane, torus.
- Choose mesh by rough silhouette: humanoids=capsule, containers=box, pillars=cylinder, etc.
- Maintain consistency with the world state. Do not contradict established facts.
- Scale emergent content to player level.
- style_token from world state must always appear in the prompt you build mentally — it is appended automatically.
```

### Jerarquía de llamadas LLM

```
Al entrar a nueva región:
  → Claude API: generate_region_overview()
    Genera: nombre, atmósfera, historia, 3-5 puntos de interés, style_token

Al entrar a nueva sala:
  → Claude API: populate_room()
    Genera: descripción, 2-8 objetos, 0-3 NPCs, evento ambiental

Al interactuar con NPC:
  → Ollama (Mistral 7B local): generate_npc_response()
    Genera: línea de diálogo, emoción, posible quest trigger

Al abrir ítem especial:
  → Claude API: generate_item_lore()
    Genera: nombre, descripción extendida, historia del objeto, stats

Periódicamente (cada 5 minutos de juego):
  → Claude API: advance_main_story()
    Genera: evento narrativo, actualización de quests activas, nuevo objetivo
```

---

## Integración DLSS 4

### Setup en UE5

```cpp
// Config/DefaultEngine.ini — añadir:
[/Script/Engine.RendererSettings]
r.TemporalAA.Upsampling=1
r.NGX.Enable=1
r.NGX.DLSS.Enable=1
r.NGX.DLSS.EnableAutoExposure=1

// En el proyecto: activar plugin "DLSS" de NVIDIA desde el Plugin Manager
// Requiere: Unreal Engine 5.3+ y NVIDIA Streamline SDK
```

```cpp
// Source/AIRpg/Rendering/AIFrameReceiver.cpp
// Tras recibir el frame AI y actualizar la textura:

// El frame AI se aplica como post-process ANTES de que DLSS actúe.
// DLSS recibe el frame AI (10-20 FPS) y genera hasta 3 frames adicionales
// usando motion vectors del GBuffer original de UE5.
// Resultado: input AI a 15 FPS → output percibido a 60-120 FPS.

// IMPORTANTE: pasar motion vectors del render UE5 original, no del frame AI.
// Los motion vectors del frame AI son incorrectos (la IA no sabe de física).
void UAIFrameReceiver::SubmitFrameToDLSS(UTexture2D* AIFrame)
{
    // El plugin NVIDIA DLSS en UE5 se engancha automáticamente al pipeline
    // de post-process. Sólo necesitamos asegurarnos de que el material
    // post-process que muestra el frame AI esté ANTES del pass de DLSS.
    PostProcessMaterial->SetTextureParameterValue("AIFrameTexture", AIFrame);
}
```

---

## Convenciones de código

### Nomenclatura

- Clases del proyecto: prefijo `A` (Actors) o `U` (UObjects/Components) según UE5 estándar
- Variables de semantic layer: siempre `FString`, nunca `FName` (los prompts son texto libre)
- Funciones que llaman a APIs externas: sufijo `Async`, devuelven `TFuture<T>` o usan delegates
- Blueprints expuestos: `UFUNCTION(BlueprintCallable, Category="AIRpg|Narrative")`

### Threading

```cpp
// Las llamadas al LLM y al Python AI server son siempre asíncronas.
// NUNCA bloquear el game thread esperando una respuesta AI.

// Patrón correcto para llamadas LLM:
FLLMClient::PopulateRoomAsync(WorldState)
    .Then([this](FRoomData RoomData) {
        // Esto se ejecuta en el game thread cuando el LLM responde
        ObjectSpawner->SpawnFromRoomData(RoomData);
    });
```

### Gestión de errores en llamadas AI

- Si el LLM falla o da timeout (>5s): usar fallback de sala genérica del pool precalculado
- Si el AI server falla: mostrar el render UE5 original sin transformar (siempre correcto)
- Si DLSS falla: fallback transparente a TAA nativo de UE5
- Loggear todos los errores a `/Saved/Logs/AIRpg_[date].log` con timestamp y contexto

---

## Fases de desarrollo

### Fase 1 — Fundamentos (semanas 1-2)

**Objetivo:** Frame transformado visible en pantalla.

- [ ] Proyecto UE5 base con `TestMap.umap` y 5 primitivos posicionados
- [ ] `DepthBufferExporter`: exporta depth map de 512×512 a fichero PNG cada segundo
- [ ] `ai_server/` básico: recibe PNG, aplica StreamDiffusion sin ControlNet, devuelve JPEG
- [ ] `AIFrameReceiver`: muestra el JPEG recibido como textura en un plane de debug
- **Criterio de éxito:** ver el cubo gris convertido en algo visualmente distinto en pantalla

### Fase 2 — Semantic layer (semana 3)

**Objetivo:** El prompt controla el resultado visual.

- [ ] `SemanticComponent` implementado y adjuntable desde el editor
- [ ] `SemanticPromptCompiler`: genera prompts reales desde los actores visibles
- [ ] ControlNet Depth integrado en el pipeline de difusión
- [ ] Named pipes reemplazando la lectura/escritura de ficheros
- **Criterio de éxito:** cambiar la `Description` de un cubo cambia cómo lo renderiza la IA

### Fase 3 — Motor de historia (semana 4)

**Objetivo:** El LLM puebla salas.

- [ ] `WorldStateManager`: serializa el estado del mundo a JSON
- [ ] `LLMClient`: llama a Claude API con tool_use, parsea respuesta
- [ ] `ObjectSpawner`: instancia actores desde JSON con descripción y mesh correctos
- [ ] `TestMap` segunda sala generada íntegramente por el LLM
- **Criterio de éxito:** entrar a una sala vacía y verla poblarse con objetos del LLM en <3s

### Fase 4 — DLSS + pulido (semana 5)

**Objetivo:** Experiencia jugable fluida.

- [ ] Plugin DLSS 4 activado con Multi Frame Generation
- [ ] `FrameBlender` con cross-fade para evitar flickering entre frames AI
- [ ] `NPCBrain` básico con diálogos via Ollama local
- [ ] Sistema de quests mínimo (accept, progress, complete)
- [ ] Player controller con movimiento, colisiones y cámara en tercera persona
- **Criterio de éxito:** 10 minutos de gameplay continuo sin crashes ni artefactos graves

### Fase 5 — Iteración (ongoing)

- Estilo visual configurable via `style_token` por región
- Múltiples biomas (dungeon, ciudad, bosque) con paletas ControlNet distintas
- Save/load de world state
- Inventario y sistema de combate simple

---

## Setup del entorno de desarrollo

### Prerrequisitos

```bash
# Unreal Engine
# Descargar UE5.4+ desde Epic Games Launcher
# Activar plugin "DLSS" desde Edit → Plugins → NVIDIA DLSS

# Python AI server
cd ai_server
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install diffusers transformers accelerate
pip install streamdiffusion
pip install controlnet-aux
pip install Pillow numpy

# Ollama (para NPCs locales)
# Instalar desde https://ollama.ai
ollama pull mistral
```

### Variables de entorno

```bash
ANTHROPIC_API_KEY=sk-...          # Para Claude API (motor de historia)
AI_SERVER_PIPE_NAME=\\\\.\\pipe\\AIRpgFramePipe   # Windows named pipe
AI_SERVER_PORT=8765               # Alternativa: WebSocket local
OLLAMA_HOST=http://localhost:11434
SD_MODEL_CACHE=/path/to/models    # Cache local de modelos HuggingFace
```

### Arrancar el servidor AI

```bash
# Siempre arrancar el Python server ANTES de lanzar el juego desde el editor
cd ai_server
python main.py --config ../Config/ai_server_config.json
# Output esperado: "AI server ready. Listening on pipe: AIRpgFramePipe"
```

---

## Notas para Claude Code

- **No crear assets de arte.** Todos los meshes son primitivos UE5 estándar. Si necesitas una forma, usa `StaticMesh` de la carpeta `/Engine/BasicShapes/`.
- **El Python server es un proceso separado.** No intentar embeber Python en UE5. La comunicación es siempre por pipe o socket local.
- **Los prompts de SD son siempre en inglés.** Las descripciones generadas por el LLM deben estar en inglés aunque el resto del juego esté en otro idioma.
- **Prioridad de estabilidad sobre calidad.** Si hay que elegir entre un frame AI perfecto y que el juego no crashee, el juego no crashea. El AI server puede fallar silenciosamente.
- **World state es la fuente de verdad.** El LLM nunca tiene acceso directo a los objetos del mundo — solo al JSON del `WorldStateManager`. Si hay contradicción entre lo que dice el LLM y el estado en C++, gana C++.
- **Seeds determinísticos para coherencia.** Usar siempre `get_camera_seed()` para el seed de StreamDiffusion. Esto evita que los objetos "tiemblen" visualmente entre frames cuando la cámara está quieta.
# AI Graphics Prototype - Conclusiones

## Qué se probó

Pipeline completo de rendering AI en tiempo real usando UE5 como fuente de depth maps y Stable Diffusion como motor gráfico:

- **SD 1.5 + ControlNet Depth**: genera imágenes de fantasía condicionadas por el depth buffer de UE5
- **LCM-LoRA** (4 pasos de inferencia): reduce de 20-50 pasos a 4
- **TAESD** (AutoencoderTiny): 10x más rápido que el VAE estándar para encode/decode
- **Temporal EMA blending**: mezcla pixel-space entre frames consecutivos para suavizar
- **Semillas deterministas**: basadas en posición/rotación cuantizada de cámara
- **Prompt caching**: embeddings cacheados para evitar re-encoding por frame
- **Binary TCP pipe server** (:8764): protocolo binario de baja latencia para comunicación UE5→Python

## Resultados

| Métrica | Valor |
|---------|-------|
| FPS (ControlNet Depth) | **1.3 FPS** a 512x512 |
| VRAM | 2.9 GB (de 12 GB disponibles en RTX 3060) |
| Consistencia temporal | **Insuficiente** - flickering visible entre frames |
| Calidad visual | Buena para frames individuales, mala en secuencia |

## Por qué no es viable ahora

1. **Modelos de difusión son estocásticos**: incluso con semillas fijas, LCM-LoRA produce variación frame a frame. El temporal EMA blending suaviza pero no elimina el flickering.

2. **1.3 FPS no es jugable**: el mínimo para un RPG sería ~15 FPS. Necesitaríamos ~10x de mejora.

3. **Los modelos que sí resuelven consistencia temporal requieren hardware de datacenter**:
   - Krea Realtime 14B, StreamDiffusionV2: consistencia temporal real, pero 40GB+ VRAM
   - Oasis 2.0, GameNGen, DIAMOND: motores de juego neurales completos, solo GPU de datacenter
   - vid2vid / ScreenDiffusion: buenos resultados pero latencia prohibitiva en local

4. **StreamDiffusion fue descartado temprano**: su API de pipeline no es compatible con ControlNet Depth. Se optó por diffusers nativo con TAESD + LCM-LoRA.

## Tecnologías a monitorizar

- **Modelos de video compactos**: cuando SVD/AnimateDiff/Mochi puedan correr a <8GB VRAM con consistencia temporal
- **Distillation de modelos grandes**: cuando los modelos de 14B se destilen a versiones de 2-4B ejecutables en consumer GPUs
- **Neural game engines locales**: cuando Oasis/DIAMOND/GameNGen publiquen modelos que corran en RTX 3060/4060
- **NVIDIA TensorRT optimizations**: cuando los modelos de video tengan optimizaciones TRT que bajen la latencia 5-10x
- **Apple MLX / Qualcomm NPU**: hardware de inferencia dedicado que cambie la ecuación de rendimiento

## Qué sí funciona (y se mantiene activo)

El **servidor narrativo** funciona correctamente y se mantiene en `ai_server/`:

- **LLM Client** (`llm_client.py`): genera salas de dungeon estructuradas (objetos, NPCs, eventos ambientales) via Claude API o MCP bridge
- **MCP Bridge** (`narrative-mcp/`): puente WebSocket entre Python y Claude Code para generación narrativa
- **Narrative Schemas** (`narrative_schemas.py`): validación, clamping de valores, fallback rooms
- **Endpoint activo**: `POST /populate_room` acepta world state y devuelve JSON estructurado

El pipeline UE5 de semántica (SemanticComponent, ObjectSpawner, QuestManager) sigue funcional con primitivos estándar de Unreal.

## Archivos archivados

Todo el código del prototipo gráfico está en `archive/ai-graphics-prototype/`:

```
archive/ai-graphics-prototype/
├── diffusion_pipeline.py    # SD 1.5 + ControlNet + LCM-LoRA + TAESD
├── frame_manager.py         # Ring buffer de frames
├── prompt_utils.py          # Compilador de prompts semánticos
├── test_client.py           # Cliente HTTP de test
├── test_depth_generator.py  # Generador de depth maps sintéticos
├── test_narrative_visual.py # Test combinado narrativo + visual
└── test_outputs/            # Depth maps, resultados, frames UE5
    ├── depth_*.png
    ├── result_*.jpg
    ├── scenes/
    └── ue5_session/
```

## Decisión

Archivado el 2026-03-18. Se retomará cuando la tecnología de rendering AI en tiempo real sea viable en hardware consumer (RTX 3060/4060, <12GB VRAM, >15 FPS con consistencia temporal).

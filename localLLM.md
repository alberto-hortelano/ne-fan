# Motor de Historia — LLM Local

Conclusiones y recomendaciones para el motor narrativo del juego (generación de historia, personajes, conversaciones y mapas).

## Hardware objetivo

- GPU: RTX 3060 12 GB · CPU: Ryzen 7 5800X · RAM: 32 GB DDR4-3200
- Margen real de VRAM: ~11 GB (descontando escritorio).

## Modelo recomendado

**`qwen3:14b`** (Ollama) como modelo principal.

- Entra entero en GPU (~9.3 GB), ~30 tok/s.
- Buen equilibrio entre creatividad de prosa y disciplina de formato.
- Modo *thinking* → planifica la escena antes de generar, mejora coherencia de personaje en sesiones largas.
- Se prefiere un modelo **instruct** frente a finetunes de roleplay (Magnum, Rocinante…): estos últimos dan mejor prosa pero peor obediencia estructural, lo que no compensa en un motor que mezcla narrativa + JSON.

Opcional: tener un finetune de prosa (p. ej. Rocinante-12B) en el mismo Ollama solo para diálogos concretos sin schema.

## JSON: regla de oro

**No confiar en que el modelo "sea bueno con JSON". Forzar la estructura.**

- Usar el parámetro `format` de Ollama con un **JSON Schema** → llama.cpp construye una gramática que garantiza JSON válido a nivel de sampler.
- La validez deja de depender del modelo. El modelo decide *contenido*; el schema impone *forma*.
- Se puede subir `temperature` para prosa creativa sin romper el JSON: la restricción actúa sobre la estructura, no sobre el texto dentro de los campos.

```typescript
await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  body: JSON.stringify({
    model: "qwen3:14b",
    messages: [{ role: "user", content: "Genera un NPC tabernero hostil" }],
    format: npcSchema,        // JSON Schema -> gramática
    stream: false,
    options: { temperature: 0.9 }
  })
});
```

## Parámetros por tipo de tarea

| Tarea | Temperatura | Formato |
|---|---|---|
| Mapas, stats de NPC, estructura de quest | 0.3 – 0.5 | JSON Schema estricto |
| Diálogo / narración de escena | 0.8 – 1.0 | Prosa (string dentro de schema) |

## Principios de arquitectura

1. **Separar forma de contenido.** Constreñir con schema todo lo que el motor consume (IDs, posiciones, ramas de diálogo); dejar la prosa libre dentro de campos `string`. No generar "JSON creativo" todo en uno.
2. **Memoria / coherencia.** El contexto (~40K) no abarca toda la partida. Implementar *lorebook* o RAG: guardar hechos del mundo (personajes, eventos) y reinyectar solo lo relevante en cada prompt. Evita contradicciones de NPCs.
3. **Latencia.** A ~30 tok/s, generar contenido largo tarda segundos. Generar en cargas/transiciones, cachear o pregenerar; no bloquear el frame esperando al modelo.

## Stack

- **Ollama** como runtime (autodetecta CUDA, gestiona cuantización y `format`).
- **Referencia de patrones:** SillyTavern ya resuelve lorebooks, fichas de personaje y persistencia de contexto — revisar antes de reimplementar.

## Setup rápido

```bash
ollama pull qwen3:14b
# opcional, solo prosa:
# ollama pull <finetune-roleplay>
```
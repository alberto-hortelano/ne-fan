# Generación 3D con IA: guía completa para assets de RPG en 2025

**La mejor ruta para crear assets 3D de un RPG con IA combina un pipeline text→image→3D local (usando TripoSG o Stable Fast 3D en tu RTX 3060 12 GB) con una API cloud como Meshy AI o Tripo AI para piezas que exijan mayor calidad, todo canalizado a través de Blender hacia Godot 4 como motor de juego.** El ecosistema ha madurado enormemente entre 2024 y 2025: ya existen más de 20 modelos open-source que caben en 12 GB de VRAM y al menos 10 APIs comerciales con precios por debajo de $0.30 por modelo. La clave está en elegir el formato **glTF/GLB** como estándar de intercambio, porque es el único soportado nativamente por todos los motores open-source relevantes.

---

## Modelos open-source que caben en tu RTX 3060 12 GB

La limitación más importante de la RTX 3060 12 GB LHR no es el hash rate (que solo afecta minería), sino la VRAM. La buena noticia: **la mayoría de modelos state-of-the-art de 2024-2025 funcionan en 12 GB**, algunos con holgura y otros ajustados con optimizaciones fp16. Casi todos son image-to-3D, por lo que el workflow recomendado es generar primero una imagen con Stable Diffusion XL o FLUX y luego convertirla a 3D.

### Tier 1 — Recomendados sin reservas

| Modelo | VRAM | Velocidad | Salida | Calidad | Tipo | Repo |
|--------|------|-----------|--------|---------|------|------|
| **Stable Fast 3D (SF3D)** | ~6 GB ✅ | **0.5 s** | GLB (PBR, UV unwrap) | Buena | Img→3D | [GitHub](https://github.com/Stability-AI/stable-fast-3d) |
| **SPAR3D** | 7-10.5 GB ✅ | 1-2 s | GLB | Buena+ (mejor backside) | Img→3D | [GitHub](https://github.com/Stability-AI/stable-point-aware-3d) |
| **TripoSG** | ≥8 GB ✅ | 1-2 min | GLB (face count configurable) | **Alta** | Img→3D | [GitHub](https://github.com/VAST-AI-Research/TripoSG) |
| **TripoSR** | ~6 GB ✅ | <1 s | OBJ | Media | Img→3D | [GitHub](https://github.com/VAST-AI-Research/TripoSR) |
| **Hunyuan3D 2.0/2.1** | 6 GB (shape) / 12-16 GB (textura) ⚠️ | 30-60 s | GLB, OBJ | **Excelente** (PBR completo) | **Text+Img→3D** | [GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) |

**Stable Fast 3D** destaca por su velocidad absurda — medio segundo por modelo — ideal para iterar rápidamente sobre conceptos de armas, props o mobiliario de un RPG. Exporta GLB con UV unwrap y parámetros de material (albedo, roughness, metallic), aunque le falta profundidad en PBR completo. **TripoSG**, con 1.5B parámetros, ofrece la mejor calidad geométrica en código abierto: bordes definidos, detalles finos de superficie, y meshes limpias configurables hasta el número exacto de caras (`--faces 5000`). Necesita ≥8 GB de VRAM, así que tus 12 GB son más que suficientes.

**Hunyuan3D 2.0** de Tencent es el único modelo tier-1 que soporta **text-to-3D nativo** (además de image-to-3D) con texturas PBR completas (albedo, normal, roughness, metallic). La generación de geometría consume solo 6 GB; el texturizado sube a 12-16 GB. Para tu RTX 3060, existe un fork optimizado llamado [Hunyuan3D-2GP](https://github.com/deepbeepmeep/Hunyuan3D-2GP) que mediante offloading a RAM permite ejecutar el pipeline completo con solo 6 GB de VRAM (más lento, pero funcional). También hay un [paquete portable para Windows](https://github.com/YanWenKun/Hunyuan3D-2-WinPortable).

### Tier 2 — Viables con ajustes

| Modelo | VRAM | Velocidad | Calidad | Notas |
|--------|------|-----------|---------|-------|
| **TRELLIS** (Microsoft) | 8-16 GB ⚠️ | ~1 min | **Muy alta** (PBR) | Usar modo fp16 o [TRELLIS-BOX](https://github.com/microsoft/TRELLIS) Docker para reducir a ~8 GB. CVPR 2025 Spotlight. |
| **InstantMesh** (Tencent) | 10-12 GB ⚠️ | ~10 s | Buena | Usar variante small/base en 12 GB. [GitHub](https://github.com/TencentARC/InstantMesh) |
| **LGM** | 8-10 GB ✅ | ~5 s | Media-Buena | Único con text-to-3D vía MVDream. Salida Gaussian Splat → requiere conversión a mesh. [GitHub](https://github.com/3DTopia/LGM) |
| **CRM** | ~8 GB ✅ | ~10 s | Buena | Instalación compleja (kaolin, nvdiffrast). [GitHub](https://github.com/thu-ml/CRM) |
| **Step1X-3D** | 12-16 GB ⚠️ | Minutos | **SOTA** | Modelo más nuevo (mayo 2025). Supera benchmarks de TRELLIS y Hunyuan3D. Geometría (1.3B) cabe en 12 GB; textura (3.5B) probablemente ajustada. [GitHub](https://github.com/stepfun-ai/Step1X-3D) |

**TRELLIS** de Microsoft es posiblemente el modelo de mayor calidad visual ejecutable en 12 GB con optimizaciones. Genera meshes, Gaussian Splats y Radiance Fields con materiales PBR listos para exportar como GLB. El proyecto TRELLIS-BOX reduce el consumo de VRAM aproximadamente un 50% mediante Docker. **Step1X-3D** es el más reciente (2025) y lidera benchmarks, pero su requisito de VRAM para texturizado es ajustado.

### Modelos que NO caben o no merecen la pena

**Era3D** requiere ≥16 GB (descartado). **TRELLIS.2** necesita 16-30 GB para el pipeline completo (descartado sin optimización extrema). **Point-E** y **Shap-E** de OpenAI son históricamente relevantes pero su calidad es demasiado baja para assets de juego — Shap-E produce formas blobby y Point-E genera nubes de puntos que necesitan meshing adicional. **Zero123++** y **MVDream** no son generadores 3D autónomos, sino generadores de multi-vistas que alimentan a otros modelos.

---

## APIs cloud: precio, calidad y viabilidad para RPG

Las APIs comerciales eliminan las limitaciones de hardware y generalmente producen resultados de mayor calidad, con texturas PBR completas y features específicas para juegos como auto-rigging y LODs.

### Las dos mejores opciones para un RPG

**Meshy AI** (https://meshy.ai) y **Tripo AI** (https://tripo3d.ai) son las dos plataformas más completas para generación de assets de videojuego. Ambas ofrecen text-to-3D e image-to-3D, API REST bien documentada, plugins para motores de juego, auto-rigging, y precios accesibles.

| Característica | Meshy AI | Tripo AI |
|---|---|---|
| **Precio mensual** | $20 (Pro) / $60 (Max) / $120 (Unlimited) | $19.90 (Pro) / $49.90 (Advanced) / $139.90 (Premium) |
| **Coste por modelo** | ~$0.10-$0.30 | ~$0.10-$0.30 |
| **Free tier** | 100-200 créditos/mes, 10 descargas | 300 créditos/mes, 1 tarea concurrente |
| **Modelo actual** | Meshy-6 | Tripo v3.0 (2B parámetros) |
| **Formatos** | FBX, GLB, OBJ, STL, USDZ, BLEND | GLB, OBJ, FBX, STL |
| **Latencia** | 30-90 s | 10-100 s (según modelo) |
| **Texturas** | PBR completo (Diffuse, Roughness, Metallic, Normal) | **PBR 4K** en planes de pago |
| **Auto-rigging** | ✅ + **500+ animaciones** (combate, caminar, danza) | ✅ con exportación de esqueleto |
| **Plugins** | Unity, Unreal, Blender, Maya, **Godot**, 3ds Max | Unity, Unreal, **Godot**, Cocos, Blender |
| **Seguridad** | SOC2 + ISO 27001 | — |
| **Diferenciador clave** | Biblioteca de animaciones, mejor documentación | Estilos (LEGO, voxel, cartoon, clay), Smart low-poly, topología quad |

Para un RPG, **Meshy AI** sobresale por su biblioteca de **500+ animaciones** (crítico para personajes) y su documentación enterprise con certificaciones de seguridad. **Tripo AI** tiene ventaja en **calidad pura del modelo** (su v3.0 de 2B parámetros lidera rankings independientes) y en features como transformaciones de estilo (convertir un modelo a estilo cartoon, voxel o clay), **topología quad** nativa (ideal para deformación en animaciones), y segmentación de partes.

### Opciones especializadas y complementarias

**Rodin by Hyper3D** (https://hyper3d.ai) es la opción premium: su modelo Gen-2 de **10 mil millones de parámetros** produce la mayor calidad del mercado con topología quad limpia y texturas PBR de hasta 4K. El coste es elevado ($0.50-$1.50 por modelo, API solo desde $120/mes en plan Business), pero merece la pena para *hero assets* — el boss final, armas legendarias, o personajes clave de tu RPG. También disponible vía fal.ai a $0.40/generación.

**Sloyd** (https://sloyd.ai) usa un enfoque híbrido procedural+IA que genera props de entorno (edificios, armas, mobiliario, elementos de dungeon) con **topología limpia, UV automáticos y LODs** de forma instantánea. Ofrece generaciones ilimitadas incluso en el plan gratuito (~$15/mes para exportaciones). Tiene un SDK de Unity para generación en runtime. Su limitación: **no genera personajes ni formas orgánicas**. Es un complemento perfecto a Meshy/Tripo para llenar tu mundo RPG de props.

**Kaedim** (https://kaedim3d.com) emplea un modelo **AI + artistas humanos**, lo que produce assets de calidad producción con topología quad limpia, UVs correctos y retopología profesional. La contrapartida es el tiempo: horas o días por asset en lugar de segundos. Ideal para los assets más críticos del juego. Precios desde $29/mes (50 modelos).

**3D AI Studio** (https://3daistudio.com) funciona como una "navaja suiza" — ofrece acceso a múltiples modelos (TRELLIS.2, Hunyuan3D) a través de una API unificada con pipeline completo (generación → texturizado → reparación → optimización → conversión). Pago por uso desde ~$0.05/modelo, sin suscripción obligatoria.

### APIs no recomendadas para RPG

**Luma AI Genie** ha pivotado hacia generación de vídeo; su producto 3D es secundario y no está optimizado para game assets. **Alpha3D** está enfocada en e-commerce, con categorías limitadas. **3DFY.ai** solo soporta 8 categorías (lámparas, sofás, mesas, espadas, escudos, hachas...) — demasiado restrictivo. **CSM/Common Sense Machines** fue adquirida por Google en enero 2026, lo que genera incertidumbre sobre el futuro de su API standalone.

---

## El formato ideal y el motor de juego recomendado

Para un pipeline de assets 3D generados con IA en un proyecto open-source, **glTF/GLB es el formato estándar sin discusión**. Es el único formato soportado nativamente por todos los motores open-source relevantes, es un estándar abierto de Khronos, tiene soporte PBR nativo (metallic-roughness), y es el formato de salida predeterminado de la mayoría de herramientas de IA 3D (TripoSG, SF3D, SPAR3D, Meshy, Tripo, Rodin...).

La comparación entre motores muestra un ganador claro:

| Motor | Soporte GLB | Soporte FBX | PBR | Madurez RPG | Comunidad | Licencia |
|-------|-------------|-------------|-----|-------------|-----------|----------|
| **Godot 4** | ✅ Recomendado | ✅ Nativo (4.3+) | ✅ Completo | ⭐⭐⭐⭐⭐ | Enorme y creciendo | MIT |
| **Bevy** | ✅ Único formato | ❌ | ✅ | ⭐⭐ | Creciente (Rust) | MIT |
| **Stride** | ❌ No nativo | ✅ Vía Assimp | ✅ | ⭐⭐⭐⭐ | Pequeña | MIT |
| **O3DE** | ⚠️ En desarrollo | ✅ Primario | ✅ | ⭐⭐⭐⭐ | Pequeña | Apache 2.0 |
| **Blender** (DCC) | ✅ First-class | ✅ | ✅ | Hub central | Masiva | GPL |

**Godot 4 + Blender** es la combinación recomendada. Godot 4 trata glTF como formato de primera clase: importa meshes, materiales PBR, animaciones, esqueletos, luces y cámaras directamente. Desde la versión 4.3, también soporta FBX nativamente mediante la librería ufbx (sin necesidad de convertidores externos). Blender actúa como hub de procesamiento intermedio donde se limpia, retopologiza, se ajustan UVs y se riggea antes de exportar a Godot.

**Bevy** es interesante para equipos con expertise en Rust que priorizan rendimiento, pero carece de editor visual y está en pre-1.0 con breaking changes frecuentes — no recomendable para producción RPG hoy. **Stride** es una alternativa sólida para desarrolladores C# (ex-Unity), pero su falta de soporte glTF nativo complica el pipeline con assets de IA. **O3DE** es demasiado complejo para equipos indie.

---

## Pipeline práctico recomendado para tu RPG

El workflow óptimo combina generación local y cloud según la importancia del asset:

1. **Props y entorno masivo** (rocas, barriles, mobiliario, vegetación): Genera localmente con **Stable Fast 3D** (0.5 s/modelo) o **TripoSG** para mayor calidad. Para armas, edificios y objetos modulares, usa **Sloyd** (gratis, ilimitado, topología limpia).

2. **Personajes principales y assets hero** (protagonista, bosses, armas legendarias): Usa **Tripo AI** o **Meshy AI** vía API para máxima calidad con auto-rigging y animaciones. Para piezas especialmente críticas, **Rodin/Hyper3D** o **Kaedim**.

3. **Iteración rápida de conceptos**: Ejecuta **Hunyuan3D 2.0** localmente para text-to-3D directo, o genera imágenes con FLUX/SDXL y conviértelas con SF3D en medio segundo.

4. **Limpieza en Blender**: Importa todos los assets, corrige geometría no-manifold (Mesh → Clean Up), aplica retopología si es necesario (Instant Meshes para auto, manual para héroes), verifica normales, crea LODs con Decimate modifier, y exporta como GLB.

5. **Importación en Godot 4**: Los GLB se importan directamente con materiales PBR intactos. Configura escala (1 unidad = 1 metro), crea collision shapes, y ajusta materiales si es necesario.

Herramientas de integración útiles: **ComfyUI-3D-Pack** conecta la mayoría de modelos open-source en un workflow visual. **StableGen** (addon de Blender) integra TRELLIS.2 + SDXL directamente dentro de Blender con un botón "Export for Game Engine". Meshy y Tripo tienen **plugins nativos para Godot**.

---

## Conclusión

El ecosistema text-to-3D en 2025 ha alcanzado un punto de inflexión donde una RTX 3060 12 GB es suficiente para ejecutar modelos que hace un año requerían hardware de servidor. **TripoSG y Stable Fast 3D son las mejores opciones locales** por su equilibrio entre calidad, velocidad y consumo de VRAM. **Hunyuan3D 2.0** es el campeón local si necesitas text-to-3D directo con PBR. En cloud, **Tripo AI lidera en calidad de modelo** y **Meshy AI en ecosistema para juegos** (animaciones, plugins, documentación). Para un RPG indie, el stack **Godot 4 + Blender + glTF** es la elección obvia: open-source, sin costes de licencia, y perfectamente alineado con los formatos de salida de toda la industria de IA 3D. El consejo más práctico: empieza con props estáticos (donde la IA ya produce resultados game-ready con mínima intervención) y reserva el presupuesto de API cloud para los personajes que necesitan rigging y animación profesional.
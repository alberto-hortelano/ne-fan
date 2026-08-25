# Capturas del telegraph (#184 · #185)

Copiadas aquí a propósito: **`node qa/run.mjs` vacía `qa/capturas/` al arrancar**
(`qa/run.mjs:389`), así que una corrida posterior se lleva el «antes» y deja la comparación
sin sujeto. Mismo recorrido y mismo stack en los dos lados.

| Par | Qué enseña |
|---|---|
| `01-heavy-campo-abierto` · `01-precise-campo-abierto` | #184: el contorno rojo marca **hasta dónde llegas**; el relleno degradado, dónde pegas mejor. Antes la rampa roja tenía alfa cero porque la alfa del shader *era* la calidad |
| `02-impacto` | El destello de impacto ya respeta el cono frontal. Antes lo teñía una tercera copia de la fórmula que se lo saltaba: un enemigo a la espalda se pintaba verde mientras el resolver no hacía daño |
| **`04-puerto-sobre-el-embarcadero`** | **El par que más dice.** #185 no era un riesgo futuro: `puerto_tile` (15 rasgos, ninguna rareza) dejaba el suelo a 0,219 m contra los 0,2 del parche. El «antes» es una pantalla **sin telegraph ninguno**, con el ataque cargado |
| `05-puerto-suelo-desde-el-muelle` · `06-puerto-suelo-rasante` | El mismo enterramiento visto de cerca y a ras |

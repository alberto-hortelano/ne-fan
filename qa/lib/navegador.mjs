/** Cómo abre el bench su Chrome — y por qué la respuesta no es «swiftshader».
 *
 *  Hasta el 2026-08-25 los tres lanzadores de `qa/` pasaban
 *  `--use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu`, o sea
 *  **renderizar WebGL por software**. SwiftShader reparte su trabajo entre todos
 *  los núcleos, así que una corrida de la batería se comía la máquina de quien
 *  estuviera delante: medido el 2026-08-25, `gpu-process` al **791 % de CPU** y
 *  load average 25 sobre 16 hilos, con una RTX 3060 parada al lado.
 *
 *  Medido en esa misma máquina, con el mismo Chrome:
 *
 *    --use-angle=swiftshader  → ANGLE (Google, SwiftShader driver)
 *    --use-angle=gl           → ANGLE (NVIDIA, RTX 3060/PCIe/SSE2, OpenGL 4.5.0)
 *    --use-angle=vulkan       → ANGLE (NVIDIA, RTX 3060, Vulkan 1.3.242)
 *
 *  Así que se intenta la GPU real y se cae a software solo si no la hay — que es
 *  el caso del runner de CI, donde no existe. **La caída se anuncia**: un bench
 *  que silenciosamente tarda diez veces más es un bench que nadie entiende.
 *
 *  `NEFAN_QA_GPU=0` fuerza software. Sirve para reproducir una corrida de CI en
 *  local y para descartar la GPU cuando una captura no cuadra: SwiftShader es
 *  idéntico entre máquinas y un driver no.
 */

const CHROME = "/usr/bin/google-chrome";

/** Software puro: idéntico en cualquier máquina, y por eso es el fallback y el
 *  modo de reproducción. `--disable-gpu` va con él a propósito. */
export const ARGS_SOFTWARE = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--disable-gpu",
];

/** GL antes que Vulkan: los dos dan la tarjeta, y el backend de GL es el que
 *  lleva más años en producción en Chrome. */
export const ARGS_GPU = ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"];

/** Qué WebGL le está dando de verdad este navegador. Devuelve el renderer
 *  desenmascarado, o `null` si no hay WebGL2 — que es un fallo, no un matiz. */
async function rendererDe(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return null;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
  } finally {
    await page.close();
  }
}

/** Abre el Chrome del bench con la mejor pila que esta máquina pueda dar.
 *
 *  Fail-loud: si NINGUNA de las dos da WebGL2, lanza. Un bench que sigue
 *  adelante sin WebGL no mide el juego, mide un lienzo en blanco — y sus
 *  guiones fallarían mucho más tarde, diciendo otra cosa.
 *
 *  @param {import("playwright-core").BrowserType} chromium
 *  @param {{headed?: boolean, log?: (s: string) => void}} [opts]
 */
export async function abrirNavegador(chromium, opts = {}) {
  const { headed = false, log = console.log } = opts;
  const forzarSoftware = process.env.NEFAN_QA_GPU === "0";

  if (!forzarSoftware) {
    const browser = await chromium.launch({
      executablePath: CHROME,
      headless: !headed,
      args: headed ? [] : ARGS_GPU,
    });
    const renderer = headed ? "(headed: la pila del escritorio)" : await rendererDe(browser);
    if (renderer && !/swiftshader|llvmpipe|softwarerasterizer/i.test(renderer)) {
      log(`· webgl: ${renderer}`);
      return browser;
    }
    await browser.close();
    log(
      `· webgl: sin GPU utilizable (${renderer ?? "sin webgl2"}) — se cae a SwiftShader.\n` +
        "         Va MUCHO más lento y ocupa todos los núcleos; es lo normal en CI.",
    );
  }

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: !headed,
    args: headed ? [] : ARGS_SOFTWARE,
  });
  if (!headed) {
    const renderer = await rendererDe(browser);
    if (!renderer) {
      await browser.close();
      throw new Error(
        "el bench no tiene WebGL2 ni con SwiftShader: sin eso no se mide el juego, se mide un lienzo en blanco",
      );
    }
    if (forzarSoftware) log(`· webgl: ${renderer} (NEFAN_QA_GPU=0)`);
  }
  return browser;
}

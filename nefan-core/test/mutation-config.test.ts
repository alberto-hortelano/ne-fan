/** Guardia del instrumento de medida.
 *
 *  `npm run mutate` es un candado (el `break` de cada módulo) del que dependen
 *  la cola de `npm run deuda` y la decisión de si un test comprueba lo que
 *  dice. Un instrumento mal apuntado no falla: se pone VERDE midiendo el vacío.
 *
 *  Pasó de verdad: el objetivo apuntaba a `src/combat/resolver.ts`, una ruta
 *  que nunca existió (el fichero real es `combat-resolver.ts`), así que llevaba
 *  desde el renombrado generando cero mutantes mientras la batería sí gastaba
 *  tiempo corriendo su suite. Nadie se enteró porque un glob que no casa con
 *  nada no es un error para Stryker.
 *
 *  Con la corrida partida por módulos (`data/contract/mutation-targets.json`)
 *  ese mismo fallo tiene formas nuevas, y son las que se cierran aquí: un
 *  fichero que no está en ningún módulo, un fichero que su batería no puede
 *  siquiera cargar, un test que podría matar mutantes y se quedó fuera de la
 *  batería, y un test en la batería que no alcanza nada de lo que se muta —
 *  este último no miente, pero se paga UNA VEZ POR MUTANTE.
 *
 *  Ninguno mide mutación: comprueban que lo que el plan nombra existe y que el
 *  reparto es alcanzable. Son baratos y corren en cada `npm test`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import {
  cierreDeImports,
  cierreDeRuntime,
  concurrenciaDe,
  dueñoDe,
  ficherosDeclarados,
  ficherosExentos,
  ficherosMutados,
  leerPlan,
  perimetro,
  REGLA_PERIMETRO,
  testConcurrencyDe,
  testsQueImportan,
  type ModuloMutacion,
} from "../scripts/mutation-plan.js";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (f: string) => JSON.parse(readFileSync(resolve(raiz, f), "utf8"));
const plan = leerPlan();

/** El cierre de imports de un test se calcula una vez: la batería de un módulo
 *  y la del siguiente comparten ficheros. */
const cierres = new Map<string, Set<string>>();
const cierreDe = (test: string): Set<string> => {
  const previo = cierres.get(test);
  if (previo) return previo;
  const nuevo = cierreDeImports([test]);
  cierres.set(test, nuevo);
  return nuevo;
};

const nombre = (m: ModuloMutacion): string => `módulo "${m.id}"`;

describe("plan de mutación · lo que nombra existe", () => {
  /** Un patrón vale si nombra un fichero que existe o si su glob casa con al
   *  menos uno. Un glob que no casa con nada es el caso PELIGROSO: ni Stryker
   *  ni `node --test` lo consideran un error, simplemente no miden nada. */
  const casaConAlgo = (patron: string): boolean =>
    patron.includes("*") ? globSync(patron, { cwd: raiz }).length > 0 : existsSync(resolve(raiz, patron));

  it("todo objetivo de todo módulo corresponde a algún fichero real", () => {
    assert.ok(plan.modulos.length > 0, "el plan no puede estar vacío");
    for (const m of plan.modulos) {
      for (const patron of m.mutate) {
        // `!ruta` es una exclusión de Stryker: se comprueba igual, porque
        // excluir una ruta que ya no existe es basura que despista.
        const limpio = patron.startsWith("!") ? patron.slice(1) : patron;
        assert.ok(
          casaConAlgo(limpio),
          `${nombre(m)}: "${patron}" no casa con ningún fichero — el objetivo mide el vacío en verde`,
        );
      }
      assert.ok(ficherosMutados(m).length > 0, `${nombre(m)}: sus patrones no dejan ni un fichero que mutar`);
    }
  });

  it("todo fichero de toda batería corresponde a un test real", () => {
    for (const m of plan.modulos) {
      for (const t of m.tests) {
        assert.ok(
          existsSync(resolve(raiz, t)),
          `${nombre(m)}: la batería nombra "${t}", que no existe — node --test lo ignora sin avisar`,
        );
      }
    }
  });

  it("cada fichero mutado pertenece a exactamente un módulo", () => {
    // Duplicado = se mide dos veces, se paga dos veces y `npm run deuda` lo
    // cuenta dos veces. (La otra mitad —que no haya huérfanos— la comprueba el
    // test siguiente: aquí no hay forma de saber qué "debería" estar.)
    const dueño = new Map<string, string>();
    for (const m of plan.modulos) {
      for (const f of ficherosMutados(m)) {
        const otro = dueño.get(f);
        assert.equal(otro, undefined, `${f} lo mutan dos módulos: "${otro}" y "${m.id}"`);
        dueño.set(f, m.id);
      }
    }
  });

  it("ningún fichero se queda huérfano en un directorio que se mide entero", () => {
    // El agujero que esto tapa: los módulos del blueprint nombran sus ficheros
    // UNO A UNO (agrupados por batería, no por carpeta), así que un
    // `src/scene/blueprint/nuevo.ts` no lo recoge ningún glob y se queda sin
    // medir para siempre sin que nada falle. Es el fallo del objetivo que
    // apuntaba a una ruta inexistente, visto desde el otro lado.
    //
    // Excluir a propósito sigue siendo posible: basta con NOMBRARLO en el plan
    // con `!ruta` (así está `src/world-map/index.ts`), porque lo que se
    // persigue es el fichero del que nadie ha dicho nada.
    const declarados = new Set(plan.modulos.flatMap((m) => ficherosDeclarados(m)));
    assert.ok(plan.directorios_completos.length > 0, "sin directorios_completos este candado no mira nada");
    for (const dir of plan.directorios_completos) {
      const enDisco = globSync(`${dir}/*.ts`, { cwd: raiz }).map((f) => f.split("\\").join("/"));
      assert.ok(enDisco.length > 0, `directorios_completos nombra "${dir}", que no existe o está vacío`);
      for (const f of enDisco) {
        assert.ok(
          declarados.has(f),
          `${f} está en un directorio que se mide entero y ningún módulo lo nombra — ` +
            `métetelo en el módulo que comparta su batería, o exclúyelo con "!${f}"`,
        );
      }
    }
  });
});

describe("plan de mutación · el reparto es TOTAL sobre el perímetro", () => {
  /** El fallo que cierra este bloque, y es el corazón de la ejecución parcial:
   *
   *  Si un fichero del núcleo puro no está en ningún módulo NI declarado como
   *  no-mutado, entonces un diff que toque solo ese fichero selecciona cero
   *  módulos y **sale verde sin que nadie haya medido nada**. Es exactamente
   *  la forma del fallo que esta casa ya se comió una vez —un objetivo
   *  apuntando a una ruta que no existía, meses midiendo el vacío en verde—,
   *  solo que servida por la herramienta que existe para acelerar.
   *
   *  «Solo lo que ha cambiado» únicamente es de fiar si la función
   *  cambio → trabajo es TOTAL. Y la forma de garantizar que lo es no es
   *  vigilar una lista: es que el estado malo no se pueda escribir. Cada `.ts`
   *  del perímetro tiene dueño —un módulo que lo muta o una exención con
   *  motivo— o `npm test` se pone rojo.
   *
   *  El perímetro no es una lista nueva: sale de la regla de `arch-rules.json`
   *  que ya declara qué es núcleo puro. Dos listas mantenidas a mano se
   *  desincronizan, y esa desincronización sería otra vez silenciosa. */
  it("cada fichero del perímetro puro tiene dueño: un módulo o una exención escrita", () => {
    const ficheros = perimetro(plan);
    assert.ok(
      ficheros.length > 50,
      `el perímetro salió con ${ficheros.length} ficheros: la regla no está casando`,
    );
    const huerfanos = ficheros.filter((f) => dueñoDe(plan, f).tipo === "huerfano");
    assert.deepEqual(
      huerfanos,
      [],
      `sin dueño en data/contract/mutation-targets.json: ${huerfanos.join(", ")}. ` +
        `Un diff que toque solo esos ficheros no seleccionaría ningún módulo y saldría verde sin medir nada. ` +
        `Métete cada uno en el módulo que comparta su batería, o decláralo en "sin_mutar" CON MOTIVO`,
    );
  });

  it("el perímetro sale de arch-rules, no de una lista paralela", () => {
    // Si alguien renombra o retira la regla, el perímetro se quedaría vacío y
    // el candado de arriba aprobaría sin mirar nada: el peor de los verdes.
    const arch = leer("data/contract/arch-rules.json") as { rules: { id: string }[] };
    assert.ok(
      arch.rules.some((r) => r.id === REGLA_PERIMETRO),
      `arch-rules.json ya no tiene "${REGLA_PERIMETRO}": el perímetro de mutación sale de ahí`,
    );
  });

  it("ninguna exención está caducada ni tapa lo que ya se mide", () => {
    // `sin_mutar` es el sitio natural para que crezca un vertedero: una
    // entrada que nombra un fichero que ya no existe, o uno que entretanto ha
    // entrado en un módulo, es ruido que hace parecer justificado lo que nadie
    // ha vuelto a mirar.
    const exentos = ficherosExentos(plan);
    for (const e of plan.sin_mutar) {
      const casan = [...exentos].filter(([, x]) => x === e).map(([f]) => f);
      assert.notDeepEqual(
        casan,
        [],
        `sin_mutar nombra "${e.fichero}", que no casa con ningún fichero — retírala`,
      );
      for (const f of casan) {
        const dueño = dueñoDe(plan, f);
        assert.equal(
          dueño.tipo,
          "exento",
          `${f} está en sin_mutar y además lo muta el módulo "${dueño.tipo === "modulo" ? dueño.id : "?"}": ` +
            `decide una cosa`,
        );
      }
    }
  });

  it("una exención no puede ser un encogimiento de hombros", () => {
    // El motivo es obligatorio por schema (min 10), pero eso no impide un "TODO".
    // Lo que se persigue aquí es la frase vacía: si `sin_mutar` se llena de
    // motivos de tres palabras, la lista deja de significar nada.
    for (const e of plan.sin_mutar) {
      assert.ok(
        e.porque.split(/\s+/).length >= 8,
        `sin_mutar["${e.fichero}"]: "${e.porque}" no explica nada — di por qué NO se mide`,
      );
    }
  });
});

describe("plan de mutación · el reparto es alcanzable", () => {
  it("la batería de cada módulo puede CARGAR todo lo que ese módulo muta", () => {
    // Si un fichero mutado no está en el cierre de imports de su batería,
    // ningún test de esa corrida lo ejecuta: sus mutantes salen vivos por
    // construcción y ensucian la cola con deuda que no existe.
    for (const m of plan.modulos) {
      const alcanzable = new Set<string>();
      for (const t of m.tests) for (const f of cierreDe(t)) alcanzable.add(f);
      for (const f of ficherosMutados(m)) {
        assert.ok(
          alcanzable.has(f),
          `${nombre(m)}: ningún test de su batería llega a ${f} — sus mutantes sobrevivirían sin que nadie pudiera matarlos`,
        );
      }
    }
  });

  it("ningún test de una batería es peso muerto", () => {
    // Con coverageAnalysis "off" la batería entera se ejecuta UNA VEZ POR
    // MUTANTE. Un test que no llega a ningún fichero mutado no puede matar
    // nada y multiplica el coste: así se iban 8 ficheros de test por cada uno
    // de los 1684 mutantes de la corrida única.
    for (const m of plan.modulos) {
      const mutados = new Set(ficherosMutados(m));
      for (const t of m.tests) {
        assert.ok(
          [...cierreDe(t)].some((f) => mutados.has(f)),
          `${nombre(m)}: "${t}" no importa nada de lo que el módulo muta — no puede matar un solo mutante y se paga por cada uno`,
        );
      }
    }
  });

  it("ningún test que importe un fichero mutado se queda fuera de su batería", () => {
    // El fallo que esto cierra: alguien añade `src/plugins/dsl/foo.ts` con su
    // `test/foo.test.ts`; el glob del módulo se traga el fichero nuevo, la
    // batería sigue siendo la de antes y foo.ts aparece con todos sus mutantes
    // vivos. La deuda sería del reparto, no del código.
    for (const m of plan.modulos) {
      const excluidos = m.excluidos.map((e) => e.test);
      const debidos = testsQueImportan(ficherosMutados(m));
      const fuera = debidos.filter((t) => !m.tests.includes(t) && !excluidos.includes(t));
      assert.deepEqual(
        fuera,
        [],
        `${nombre(m)}: ${fuera.join(", ")} importa(n) directamente ficheros que el módulo muta y no está(n) en su batería. ` +
          `Si es a propósito, va a "excluidos" CON MOTIVO`,
      );
    }
  });

  it("el cierre de runtime nunca selecciona más que el ingenuo", () => {
    // La selección parcial se apoya en descartar las aristas `import type`,
    // que TypeScript borra al compilar. Descartar aristas solo puede QUITAR
    // ficheros del cierre, nunca añadir: si algún día esto deja de cumplirse,
    // es que `importsRuntime` ha dejado de ser un filtro de `importsDirectos`
    // y la justificación de la selección se ha caído con ello.
    for (const m of plan.modulos) {
      const entradas = [...m.tests, ...ficherosMutados(m)];
      const ingenuo = cierreDeImports(entradas);
      const fuera = [...cierreDeRuntime(entradas)].filter((f) => !ingenuo.has(f));
      assert.deepEqual(
        fuera,
        [],
        `${nombre(m)}: el cierre de runtime alcanza ficheros que el ingenuo no: ${fuera}`,
      );
    }
  });

  it("el alcance de un módulo contiene todo lo que ese módulo muta", () => {
    // La propiedad de la que cuelga `npm run mutate -- --cambiado`: si tocas un
    // fichero, el módulo que lo muta TIENE que quedar seleccionado. Sin esto,
    // la vía normal de trabajo dejaría de medir justo el código que se acaba de
    // escribir, y en verde.
    for (const m of plan.modulos) {
      const alcance = cierreDeRuntime([...m.tests, ...ficherosMutados(m)]);
      for (const f of ficherosMutados(m)) {
        assert.ok(alcance.has(f), `${nombre(m)}: cambiar ${f} no seleccionaría su propio módulo`);
      }
    }
  });

  it("toda exclusión sigue haciendo falta y no se contradice con la batería", () => {
    // Una exclusión que ya no aplica es peor que ninguna: deja un agujero
    // abierto en el candado con la excusa de un problema que ya no existe.
    for (const m of plan.modulos) {
      const debidos = testsQueImportan(ficherosMutados(m));
      for (const e of m.excluidos) {
        assert.ok(
          debidos.includes(e.test),
          `${nombre(m)}: excluye "${e.test}", que ya no importa nada de lo que muta — retira la excepción`,
        );
        assert.ok(
          !m.tests.includes(e.test),
          `${nombre(m)}: "${e.test}" está a la vez en la batería y en excluidos`,
        );
      }
    }
  });
});

describe("plan de mutación · el instrumento no puede quemar la máquina ni medir en frío", () => {
  /** Un mutante puede romper una condición de bucle: el proceso de test deja
   *  de terminar y ASIGNA MEMORIA hasta que Stryker lo corta. Mientras tanto
   *  no está midiendo nada, solo esperando — así que el techo de ese timeout
   *  es, literalmente, cuánta RAM puede quemar un mutante inútil.
   *
   *  Pasó de verdad (2026-08-21): con `timeoutMS: 120000`, mutar
   *  `scene-validate.ts` —flood-fill sobre una rejilla 128×128— llevó a
   *  procesos de 4,24 GB y a un pico de 21,8 GB con `concurrency: 10`. El
   *  kernel invocó al OOM killer y se llevó por delante el editor. Con 10 s
   *  la misma corrida bajó a 7,6 GB de pico y 2m11s (de 4m48s) **con el mismo
   *  score, 95,39 %**: los 12 mutantes desbocados siguen muriendo, solo que en
   *  10 s en vez de en 120. */
  it("un mutante desbocado no puede quemar la máquina", () => {
    const cfg = leer("stryker.config.json") as { timeoutMS: number };
    assert.ok(
      cfg.timeoutMS <= 15000,
      `timeoutMS = ${cfg.timeoutMS}: un mutante que no termina asigna memoria durante todo ese tiempo, ` +
        `y con varios mutantes en vuelo eso multiplica`,
    );

    // Segunda barrera, independiente del reloj: el tope de heap. Va en el
    // `comando` del plan y no por argv porque `node --test` abre un proceso
    // hijo por fichero, y los hijos NO heredan las flags de la línea de
    // comandos del padre — medido: con `node --max-old-space-size=512 --test …`
    // los hijos seguían llegando a 4,2 GB.
    assert.match(
      plan.comando,
      /NODE_OPTIONS=[^\s]*--max-old-space-size=\d+/,
      "el comando del plan no pone tope de heap: un mutante desbocado crece hasta agotar la RAM de la máquina",
    );
  });

  it("la base no declara objetivos: el plan es la única fuente", () => {
    // Dos listas de objetivos = dos verdades, y la que corre no tiene por qué
    // ser la que alguien lee. `mutate: []` en la base es además un fusible:
    // un `stryker run` a pelo, sin config de módulo, no muerde el árbol entero.
    const base = leer("stryker.config.json") as { mutate?: string[] };
    assert.deepEqual(
      base.mutate,
      [],
      "stryker.config.json vuelve a declarar `mutate`: los objetivos viven en data/contract/mutation-targets.json",
    );
  });

  it("el gate mide en frío, sin reutilizar veredictos viejos", () => {
    // Con testRunner "command" Stryker no hashea los ficheros de test, así que
    // la caché incremental NO se invalida al editar un test: medido, vaciar dos
    // ficheros de test y re-correr devolvía el score viejo en 3 s. Antes eso se
    // compensaba con `--force`; ahora la caché no se enciende siquiera, y lo
    // que daba `mutate:quick` lo da correr un módulo suelto.
    const base = leer("stryker.config.json") as { incremental?: boolean };
    assert.notEqual(
      base.incremental,
      true,
      'incremental con testRunner "command" da verde sobre veredictos viejos al editar un test',
    );
  });

  it("`npm run mutate` corre el plan, no un config suelto", () => {
    const scripts = leer("package.json").scripts as Record<string, string>;
    assert.match(
      scripts.mutate,
      /scripts\/mutate\.ts/,
      "npm run mutate tiene que pasar por el runner: es quien genera un config por módulo desde el plan",
    );
    assert.equal(
      scripts["test:mutate"],
      undefined,
      "test:mutate era la batería fija de la corrida única; ahora cada módulo trae la suya en el plan",
    );
  });

  /** Los dos paralelismos ANIDADOS.
   *
   *  Pasó de verdad el 2026-08-23, en la primera corrida completa del reparto:
   *  `stryker.config.json` fijaba `concurrency: 10`, y el comando del plan era
   *  `node --test <ficheros>` a secas — que por defecto arranca un proceso por
   *  fichero de test hasta `availableParallelism() - 1`. Diez workers por hasta
   *  quince procesos cada uno = **~130 procesos node sobre 16 núcleos**. Load
   *  average medido: 129 → 140. La máquina quedó inusable para la persona que
   *  la estaba usando, y la medida salió inflada: todo ese context-switching se
   *  cobra en el CPU que luego se compara con el "antes".
   *
   *  El invariante: procesos simultáneos ≈ núcleos, NUNCA un múltiplo. Y no se
   *  comprueba contra esta máquina —el test corre también en un runner de 4
   *  núcleos— sino contra la fórmula, para cualquier tamaño de máquina. */
  it("el comando de test no abre un paralelismo dentro de cada worker", () => {
    assert.equal(
      testConcurrencyDe(plan.comando),
      1,
      `el comando del plan es "${plan.comando}": sin --test-concurrency=1, node --test arranca ` +
        `un proceso por fichero de test DENTRO de cada worker de Stryker, y los dos paralelismos se multiplican`,
    );
  });

  it("la concurrencia la decide la máquina, no un número fijo en el repo", () => {
    const base = leer("stryker.config.json") as { concurrency?: number };
    assert.equal(
      base.concurrency,
      undefined,
      "stryker.config.json vuelve a fijar `concurrency`: ese número se sobresuscribe en unas máquinas " +
        "y desaprovecha otras. Lo calcula scripts/mutate.ts con concurrenciaDe(núcleos)",
    );
  });

  it("los procesos simultáneos nunca son un múltiplo de los núcleos", () => {
    const porWorker = testConcurrencyDe(plan.comando);
    assert.notEqual(porWorker, "sin tope");
    for (const nucleos of [1, 2, 4, 8, 12, 16, 64, 128]) {
      const simultaneos = concurrenciaDe(nucleos) * (porWorker as number);
      assert.ok(simultaneos >= 1, `con ${nucleos} núcleos no se mediría nada`);
      assert.ok(
        simultaneos <= nucleos,
        `con ${nucleos} núcleos saldrían ${simultaneos} procesos de test simultáneos`,
      );
    }
  });

  it("pedir más concurrencia a mano no puede saltarse el invariante", () => {
    // La vía de escape existe (la máquina puede ser toda tuya), pero se recorta
    // a los núcleos: es la diferencia entre exprimir la máquina y colgarla.
    assert.equal(concurrenciaDe(16, "15"), 15);
    assert.equal(concurrenciaDe(16, "999"), 16);
    assert.equal(concurrenciaDe(16, "0"), 8, "un 0 no puede dejar la corrida sin workers");
    assert.equal(concurrenciaDe(16, "no-es-un-numero"), 8);
    assert.equal(concurrenciaDe(16, undefined), 8, "por defecto, media máquina");
  });

  it("dos módulos no pueden escribir el mismo informe", () => {
    // `npm run deuda` lee un informe POR MÓDULO, y el nombre del fichero es el
    // id: dos ids iguales se pisan el informe y el segundo borra la medida del
    // primero sin que nada falle.
    const ids = plan.modulos.map((m) => m.id);
    assert.deepEqual([...new Set(ids)], ids, "hay ids de módulo repetidos en el plan");
  });
});

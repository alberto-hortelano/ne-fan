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
  configDe,
  correEnElMismoProceso,
  dueñoDe,
  ficherosDeclarados,
  ficherosExentos,
  ficherosMutados,
  leerPlan,
  perimetro,
  REGLA_PERIMETRO,
  SIN_MEDIR,
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
    for (const { directorio: dir } of plan.directorios_completos) {
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
    // Y lo mismo para un directorio que ENSANCHA el perímetro: la regla
    // `core-puro-sin-node` es la que declara qué es núcleo puro, así que meter
    // un directorio por esta puerta y no por la regla es una decisión que hay
    // que poder leer dentro de dos meses sin adivinarla.
    for (const d of plan.directorios_completos) {
      assert.ok(
        d.porque.split(/\s+/).length >= 8,
        `directorios_completos["${d.directorio}"]: "${d.porque}" no explica nada — ` +
          `di por qué se mide entero AQUÍ y no en ${REGLA_PERIMETRO}`,
      );
    }
  });

  it("un módulo `sin medir` se corre SIN suelo, y uno medido con el suyo", () => {
    // `mutate.ts` dice de `configDe` que «es determinista y tiene candado», y
    // hasta hoy la segunda mitad era mentira: ningún test lo llamaba. Importa
    // porque el config generado es lo ÚNICO que Stryker lee, así que el suelo
    // de verdad no es el del contrato sino el que salga de aquí.
    //
    // Sin `break`, Stryker no falla por score: es lo que hay que hacer con un
    // módulo del que no se sabe nada todavía. Un `break: 0` daría el mismo
    // resultado y sería una mentira distinta — el informe diría que hay suelo.
    const base = leer("stryker.config.json") as Record<string, unknown>;
    const medido: ModuloMutacion = { ...plan.modulos[0], break: 91 };
    const nuevo: ModuloMutacion = { ...plan.modulos[0], break: SIN_MEDIR };
    const umbrales = (m: ModuloMutacion) =>
      (configDe(base, plan, m, 2) as { thresholds: Record<string, unknown> }).thresholds;
    assert.equal(umbrales(medido).break, 91);
    assert.equal(
      "break" in umbrales(nuevo),
      false,
      `un módulo "${SIN_MEDIR}" no puede llevar break en su config: ` +
        `${JSON.stringify(umbrales(nuevo))}`,
    );
    // Y lo demás del config no se resiente: los otros umbrales siguen ahí.
    assert.deepEqual(
      Object.keys(umbrales(nuevo)).sort(),
      Object.keys(base.thresholds as object).sort(),
      "el config sin suelo perdió (o inventó) algún otro umbral",
    );
  });

  it("el config generado le da al runner la batería EXACTA, no un patrón", () => {
    // `tap-runner` resuelve `tap.testFiles` con `glob()`, así que acepta
    // patrones — y ahí está la trampa: un `test/*.test.ts` haría que la batería
    // de un módulo creciera sola cada vez que alguien añade un fichero de test,
    // que es justo la puerta que cerró el reparto por módulos. Una ruta literal
    // se resuelve a sí misma, así que lo que hay que candar es que sean las
    // rutas del plan y nada más.
    //
    // Y `nodeArgs` tiene que ser el del plan por lo mismo que `mutate`: el
    // config generado es lo ÚNICO que Stryker lee, así que el tope de heap y el
    // reporter TAP que valen son los que salgan de aquí, no los que ponga el
    // contrato.
    const base = leer("stryker.config.json") as Record<string, unknown>;
    for (const m of plan.modulos) {
      const cfg = configDe(base, plan, m, 2) as {
        tap?: { testFiles?: string[]; nodeArgs?: string[] };
        commandRunner?: unknown;
      };
      assert.deepEqual(
        cfg.tap?.testFiles,
        m.tests,
        `${nombre(m)}: el config no le pasa su batería literal a tap-runner`,
      );
      assert.deepEqual(
        cfg.tap?.nodeArgs,
        plan.node_args,
        `${nombre(m)}: el config no le pasa los node_args del plan (heap y reporter TAP van ahí)`,
      );
      assert.equal(
        cfg.commandRunner,
        undefined,
        `${nombre(m)}: el config sigue trayendo \`commandRunner\`, del runner que se retiró en #443`,
      );
    }
  });

  it("el runner que el config nombra está instalado", () => {
    // Un `testRunner` sin su plugin es una corrida que muere en el arranque —
    // en CI, después de pagar el checkout y el `npm ci`. Y al revés: una
    // dependencia instalada que nadie nombra es rastro.
    // `command` es el único que viaja DENTRO de `@stryker-mutator/core`; los
    // demás son un paquete aparte que hay que instalar.
    const EN_CORE = new Set(["command"]);
    const base = leer("stryker.config.json") as { testRunner?: string };
    const deps = (leer("package.json") as { devDependencies: Record<string, string> }).devDependencies;
    const paquete = `@stryker-mutator/${base.testRunner}-runner`;
    for (const [nombrePaquete, hace_falta] of Object.entries({
      [paquete]: !EN_CORE.has(String(base.testRunner)),
      "@stryker-mutator/tap-runner": String(base.testRunner) === "tap",
    })) {
      if (!hace_falta) continue;
      assert.ok(
        deps[nombrePaquete],
        `stryker.config.json pide testRunner "${base.testRunner}" y ${nombrePaquete} no está en devDependencies: ` +
          `la corrida moriría en el arranque del job, después de pagar el checkout y el npm ci`,
      );
    }
  });

  it("un suelo `sin medir` caduca en cuanto la huella trae la medida", () => {
    // EL CANDADO QUE HACE INEXPRESABLE EL GATE PERMANENTEMENTE VERDE.
    //
    // Un módulo estrenado no puede traer su suelo puesto: `permisoLocal`
    // rechaza el coste desconocido, así que su primera medida exige una corrida
    // autorizada y hay días en los que el módulo existe sin score. Ese estado
    // es legítimo. Lo que no es legítimo es que se quede.
    //
    // Antes se escribía `break: 0`, que aprueba cualquier cosa y no se
    // distingue de un suelo medido: `asset-store-contrato` lo llevó TRES tandas
    // (#354, #380, #389) con sus 9 mutantes y sus 2 vivos ya commiteados en la
    // huella y su suelo sin subir. Nadie lo miró porque nada se ponía rojo.
    //
    // Con `sin medir`, en cuanto la corrida deja la medida en la huella
    // commiteada, este test cae y dice el número que hay que copiar. El suelo
    // no depende de que alguien se acuerde.
    const huella = leer("data/contract/mutacion-huella.json") as {
      ficheros: Record<string, { total: number; vivos?: unknown[] }>;
    };
    for (const m of plan.modulos) {
      if (m.break !== SIN_MEDIR) continue;
      const medidos = ficherosMutados(m).filter((f) => huella.ficheros[f] !== undefined);
      assert.deepEqual(
        medidos,
        [],
        `el módulo "${m.id}" dice "${SIN_MEDIR}" pero la huella ya trae ${medidos.join(", ")}: ` +
          `ya se midió, sube el suelo al score medido. Un suelo que nadie sube es un gate ` +
          `permanentemente verde, y eso no es un final`,
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
    // Con el runner `command` la batería entera se ejecutaba UNA VEZ POR
    // MUTANTE: así se iban 8 ficheros de test por cada uno de los 1684 mutantes
    // de la corrida única. Con `tap-runner` ese peso se paga una vez por
    // corrida, en el dry run — pero un test que no llega a ningún fichero
    // mutado sigue siendo una promesa falsa sobre quién vigila ese código, y
    // por eso el candado no se afloja con el runner nuevo.
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

  it("ninguna batería sale del paquete: el sandbox de Stryker no copia a los vecinos", () => {
    // La trampa que ya ha mordido TRES veces, y la tercera cerró una corrida
    // entera. Stryker copia la batería a `nefan-core/.stryker-tmp/sandbox-XXXX/`
    // —dos niveles más hondo— y NO copia a los hermanos del monorepo. Un salto
    // relativo contado a mano (`../../ai_server`, `from "../../narrative-mcp/…"`)
    // apunta entonces a un sitio que no existe, y no falla el test: falla el
    // DRY-RUN, o sea el módulo entero, que sale SIN INFORME.
    //
    // Las tres: `fake-motor-contract` (labs/, #347), `contract-fixtures`
    // (narrative-mcp/, mismo #347) y `entity-vocabulary` (ai_server/), esta
    // última en la corrida 33790710680 — 290 mutantes sin medir y el reparto
    // parado. Ninguna la vio nadie hasta que la corrida volvió en rojo, porque
    // la mutación no corre por PR: es el sitio exacto donde hace falta candado
    // y no prosa.
    //
    // Salir del paquete NO está prohibido: lo está el salto FIJO. Buscar la
    // raíz hacia arriba sobrevive a cualquier profundidad, y ese es el arreglo
    // (`raizDelRepo()` en test/entity-vocabulary.test.ts). Si un test tiene que
    // saltar a mano, va a "excluidos" CON MOTIVO, como los otros dos.
    const escapes = (src: string): string[] => {
      const hallazgos: string[] = [];
      for (const m of src.matchAll(/(?:from|import\()\s*"((?:\.\.\/){2,}[^"]*)"/g)) {
        hallazgos.push(`import "${m[1]}"`);
      }
      for (const m of src.matchAll(/new URL\(\s*"((?:\.\.\/){2,}[^"]*)"/g)) {
        hallazgos.push(`new URL("${m[1]}", import.meta.url)`);
      }
      if (src.includes("import.meta.url") && /"\.\.",\s*"\.\."/.test(src)) {
        hallazgos.push(`join(…import.meta.url…, "..", "..")`);
      }
      return hallazgos;
    };

    for (const m of plan.modulos) {
      for (const t of m.tests) {
        const hallazgos = escapes(readFileSync(resolve(raiz, t), "utf8"));
        assert.deepEqual(
          hallazgos,
          [],
          `${nombre(m)}: "${t}" sale del paquete con un salto fijo (${hallazgos.join("; ")}). ` +
            `Dentro del sandbox de Stryker esa ruta no existe y el módulo entero se queda SIN INFORME. ` +
            `Búscala hacia arriba, o saca el test a "excluidos" con su motivo`,
        );
      }
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

    // Segunda barrera, independiente del reloj: el tope de heap. Con
    // `tap-runner` va por ARGV en `node_args`, y ahí SÍ aplica: el runner lanza
    // `node -r <hook.cjs> <node_args> <fichero>`, o sea que el proceso que
    // recibe la flag es el mismo que ejecuta el test. Con el runner anterior
    // había que meterlo por `NODE_OPTIONS` porque `node --test` abría un hijo
    // por fichero y los hijos no heredan el argv del padre.
    //
    // MEDIDO el 2026-09-14, las tres ramas del asunto, sobre scene-validate:
    //   · `node -r hook --max-old-space-size=16 --import tsx --test-reporter=tap <f>`
    //     → exit 134, «FATAL ERROR: Reached heap limit» (a 32 y a 1024 pasa)
    //   · `node --max-old-space-size=16 --import tsx --test <f>` → exit 0: el
    //     tope se queda en el padre y el hijo ni se entera
    //   · `NODE_OPTIONS=--max-old-space-size=16 node --import tsx --test <f>`
    //     → exit 1: por entorno sí llega al hijo
    assert.ok(
      plan.node_args.some((a) => /^--max-old-space-size=\d+$/.test(a)),
      `los node_args del plan son ${JSON.stringify(plan.node_args)}: sin tope de heap un mutante desbocado ` +
        `crece hasta agotar la RAM de la máquina`,
    );
    // Y que la flag ESTÉ no basta para que APLIQUE, que es justo lo que este
    // aserto se creía comprobando: con `--test` y sin `--test-isolation=none` el
    // test corre en un hijo que no hereda el argv, y el tope es un no-op.
    // Medido el 2026-09-15 sobre un test que pide ~3 GB con el tope en 16 MB:
    // con `--test` a secas SOBREVIVE (exit 0); con `--test-isolation=none` al
    // lado vuelve a morir con «Reached heap limit» (exit 134).
    assert.ok(
      correEnElMismoProceso(plan.node_args),
      `los node_args del plan son ${JSON.stringify(plan.node_args)}: el tope de heap está escrito pero ` +
        `no aplica, porque el test corre en un proceso hijo que no hereda el argv`,
    );
  });

  /** Node 24 emite `spec` POR DEFECTO, también sin TTY (comprobado el
   *  2026-09-14: `node --import tsx test/scene-validate.test.ts` redirigido a
   *  fichero sale con ✔/▶, no con `ok`). `tap-runner` clasifica al mutante
   *  leyendo TAP de stdout con `tap-parser`: sin esta flag no ve un solo
   *  `not ok`, `result.ok` sale `true` y **todos los mutantes saldrían
   *  detectados sin que ningún test haya opinado**. Es el verde que no
   *  comprueba nada, y aquí cuesta la medida entera de la casa. */
  it("el reporte que el runner sabe leer está pedido explícitamente", () => {
    assert.ok(
      plan.node_args.includes("--test-reporter=tap"),
      `los node_args del plan son ${JSON.stringify(plan.node_args)}: sin --test-reporter=tap Node emite ` +
        `\`spec\` y tap-parser no ve un solo veredicto — la corrida entera saldría en verde sin medir nada`,
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
    //
    // CON `tap-runner` LA PREMISA PUEDE HABER CAMBIADO —el runner sí enumera
    // sus ficheros de test— y NADIE LO HA MEDIDO (#443 midió el reloj y el
    // score, no la caché). Hasta que alguien lo mida, la caché sigue apagada:
    // encenderla sobre una premisa que se supone es exactamente el verde que no
    // comprueba nada, y aquí el verde sería el gate entero.
    const base = leer("stryker.config.json") as { incremental?: boolean };
    assert.notEqual(
      base.incremental,
      true,
      "incremental da verde sobre veredictos viejos al editar un test, y con tap-runner nadie ha medido " +
        "si la caché se invalida — se enciende cuando esté medido, no antes",
    );
  });

  it("el `coverageAnalysis` escrito DESCRIBE lo que el runner hace, y no compra el reloj", () => {
    // MEDIDO EL 2026-09-04, y el resultado es que aquí no hay palanca: con
    // `testRunner: "command"` Stryker ACEPTA `perTest`, lo imprime en el log
    // ("command test runner with \"perTest\" coverage analysis") y luego lo
    // ignora, sin un solo aviso. El runner de comando devuelve UN test
    // sintético ("All tests") y ningún `mutantCoverage`, así que
    // `TestCoverage.hasCoverage` es false y el planificador cae en su rama
    // "no coverage information exists, all tests need to run"; su `mutantRun`
    // ni siquiera lee el `testFilter` que le llega. El propio `stryker init`
    // lo sabe y escribe `coverageAnalysis: "off"` cuando el runner es command.
    //
    // El experimento: 4 módulos (combat-resolver, serialize-llm,
    // state-http-dispatch, npc-director), dos brazos emparejados e
    // intercalados y un tercero con "all". Los 409 mutantes salieron
    // IDÉNTICOS uno a uno —id, mutador, línea, columna y estado— y con
    // `coveredBy` en cero en los tres brazos; el reloj no se movió fuera del
    // ruido (combat-resolver 22,7 s de media con "off" contra 23,0 s con
    // "perTest", n=5 y n=5, con el signo cambiando entre parejas).
    //
    // Por qué es un candado y no una nota: un no-op silencioso es PEOR que no
    // tocarlo. Quien lo ponga leerá un cambio donde no hay ninguno, y la
    // siguiente medida se atribuirá a una palanca que nunca se accionó.
    //
    // Y CON `tap` EL AJUSTE TAMBIÉN ES INERTE. Medido el 2026-09-15 (QA de
    // #597, H-1), y corrige lo que este docblock afirmaba: `off` y `perTest`
    // dan el MISMO resultado, el MISMO reloj y el MISMO filtrado —blueprint-plan
    // `Ran 0.97 tests per mutant`, 10 s, {Killed 37, Timeout 1} con los dos;
    // contrato-sprite-forge {Killed 56, Survived 6, NoCoverage 1} con los dos—
    // porque `tap-runner.dryRun()` nunca lee `options.coverageAnalysis` y
    // devuelve `mutantCoverage` siempre, y `TestCoverage.hasCoverage` es
    // `!!staticCoverage`: depende de lo que REPORTÓ el runner, no del ajuste.
    //
    // CONSECUENCIA QUE NO SE PUEDE ESCRIBIR MAL: el ahorro de #443 —blueprint-plan
    // 24,7 s → 10,9 s (−55,9 %), la corrida completa −63,4 % de CPU— es del
    // RUNNER, no del ajuste. Quien mida «cuánto aporta perTest» medirá cero, y
    // si esto dijera otra cosa creería haber roto algo.
    //
    // ENTONCES, ¿QUÉ SUJETA ESTE CANDADO? Que el valor escrito DESCRIBA lo que
    // la corrida hace. No es decoración: queda en `config.coverageAnalysis` de
    // cada informe, y de ahí lo leen `capacidadDeLaBase` —junto al runner, que
    // por eso van juntos— y cualquiera que abra el informe dentro de seis
    // meses. Un `"off"` con `tap` describiría una corrida sin filtrado que sí
    // filtró. Lo que este candado NO hace es proteger el reloj.
    //
    // EL CANDADO NO PUEDE AUTO-DESARMARSE. Antes empezaba por
    // `if (base.testRunner !== "command") return`, o sea que cambiar de runner
    // lo dejaba verde sin comprobar nada. Ahora cada runner conocido trae el
    // valor que HAY que ponerle, y un runner desconocido es un fallo: si
    // alguien mete un tercero, este test le exige escribir aquí qué significa
    // `coverageAnalysis` para él antes de medir con él.
    const ESPERADO: Record<string, { valor: string; porque: string }> = {
      tap: {
        valor: "perTest",
        porque:
          `tap-runner filtra por su cuenta y el ajuste le es INERTE (medido el 2026-09-15: con "off" da el ` +
          `mismo resultado, el mismo reloj y el mismo filtrado), así que "perTest" es el valor que DESCRIBE ` +
          `lo que hace — y es lo que queda escrito en cada informe para capacidadDeLaBase y para quien lo lea`,
      },
      command: {
        valor: "off",
        porque:
          `con testRunner "command" Stryker acepta "perTest", lo imprime en el log y lo IGNORA — ` +
          `medido el 2026-09-04 sobre 4 módulos y 409 mutantes: idénticos uno a uno y cero segundos de ahorro`,
      },
    };
    const base = leer("stryker.config.json") as { coverageAnalysis?: string; testRunner?: string };
    const esperado = ESPERADO[String(base.testRunner)];
    assert.ok(
      esperado,
      `testRunner: "${base.testRunner}" no está en esta tabla. Qué significa \`coverageAnalysis\` depende ` +
        `del runner —con "command" es un no-op y con "tap" es la palanca entera—, así que un runner nuevo ` +
        `tiene que declarar aquí el suyo en vez de heredar un candado que no le opina`,
    );
    assert.equal(
      base.coverageAnalysis,
      esperado.valor,
      `coverageAnalysis: "${base.coverageAnalysis}" con testRunner "${base.testRunner}": ${esperado.porque}`,
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
    // Con `tap-runner` el 1 es ESTRUCTURAL: el runner recorre su batería con un
    // `for … await` y lanza `node <fichero>` de uno en uno. Lo único que puede
    // romperlo es colar `--test` SIN `--test-isolation=none`, que devuelve el
    // paralelismo interno de `node --test` dentro de cada worker — y además
    // manda la cobertura a procesos hijos cuyo `stryker-output-<pid>.json`
    // nadie lee, porque el hook lo escribe con SU pid y el runner solo mira el
    // que lanzó.
    assert.equal(
      testConcurrencyDe(plan.node_args),
      1,
      `los node_args del plan son ${JSON.stringify(plan.node_args)}: con --test ahí y sin ` +
        `--test-isolation=none, node arranca un proceso por fichero de test DENTRO de cada worker de ` +
        `Stryker, y los dos paralelismos se multiplican`,
    );
  });

  /** `--test` ENTRA en `node_args` con #597 y trae compañía obligatoria.
   *
   *  Lo que compra: sobre un fichero que muere AL IMPORTARSE —el patrón
   *  `ObjectLiteral → {}` sobre una tabla que se evalúa al cargar el módulo—
   *  `node --test … --test-reporter=tap` emite `not ok 1 - <fichero>`, y con esa
   *  línea `tap-runner` clasifica `Failed` y Stryker cuenta el mutante como
   *  `Killed`. Sin ella el proceso muere antes de la cabecera TAP, el runner no
   *  distingue «el test se cayó porque el mutante lo mató» de «el runner falló»,
   *  y el mutante sale `RuntimeError`: FUERA del denominador. Eran **26** en la
   *  corrida 34878198682 y son lo único que impidió adoptar el runner (#443).
   *
   *  Lo que cuesta si va solo, y es lo que este candado sujeta: `--test` sin
   *  `--test-isolation=none` abre un proceso HIJO por fichero, y ese hijo no
   *  hereda ni el pid que el hook usa para escribir la cobertura ni el tope de
   *  heap del argv. Las dos se apagan, pero NO igual de calladas, y la
   *  diferencia importa (QA de #597, H-3):
   *   · la cobertura se apaga A GRITOS — el padre lee cero, los 63 mutantes de
   *     `contrato-sprite-forge` salen `NoCoverage` y el módulo cae a **0,00 %
   *     contra un suelo de 87**, exit 1. Y el rojo es universal, no una
   *     casualidad de este módulo: los 58 tienen `break` numérico ≥ 31;
   *   · el tope de heap se apaga EN SILENCIO, y ésa es la mitad que este
   *     candado existe para cazar: la flag sigue escrita y no aplica, así que
   *     nada se pone rojo mientras el cortafuegos de memoria no está.
   *
   *  Medido el 2026-09-15 con `--max-old-space-size=16` sobre un test que pide
   *  ~3 GB: directo exit 134 «Reached heap limit» · con `--test` a secas exit 0,
   *  el test SOBREVIVE · con `--test --test-isolation=none` exit 134 otra vez.
   *  Y con el runner real, los 26 vuelven a `Killed` (los 5 de
   *  `contrato-sprite-forge` por `npm run mutacion -- local`, los otros 21 por
   *  huella con `mutate` acotado a su rango, y los 26 reproducidos por QA). */
  it("`--test` está, y solo es admisible acompañado de `--test-isolation=none`", () => {
    // EL CASO QUE ESTE CANDADO TIENE QUE RECHAZAR: `--test` a secas.
    assert.equal(
      correEnElMismoProceso(["--max-old-space-size=1024", "--import", "tsx", "--test", "--test-reporter=tap"]),
      false,
      "`--test` sin `--test-isolation=none` abre un hijo: la cobertura se escribe con el pid del hijo, " +
        "que el runner no lee, y el tope de heap del argv deja de aplicar",
    );
    // Y los que sí valen: sin `--test` (el fichero se ejecuta directo) y con la
    // compañía obligatoria (el fichero corre EN el proceso lanzado).
    assert.equal(correEnElMismoProceso(["--max-old-space-size=1024", "--import", "tsx", "--test-reporter=tap"]), true);
    assert.equal(correEnElMismoProceso(["--import", "tsx", "--test", "--test-isolation=none"]), true);
    assert.equal(correEnElMismoProceso(["--import", "tsx", "--test", "--test-isolation", "none"]), true);
    // Pedir el aislamiento por procesos EXPLÍCITAMENTE es el mismo agujero que
    // no pedirlo: el candado mira lo que hace Node, no lo que se quiso decir.
    assert.equal(correEnElMismoProceso(["--import", "tsx", "--test", "--test-isolation=process"]), false);

    // Y el plan de verdad, que es a quien le toca cumplirlo. Las DOS
    // direcciones, porque quitar `--test` tampoco se nota: el módulo roto medía
    // 51/58 = 87,9 % y su suelo era 87, así que los 26 se fueron del
    // denominador sin poner nada rojo. Lo cazó `comparar`, y solo porque había
    // una corrida con la que comparar.
    assert.ok(
      plan.node_args.includes("--test"),
      `los node_args del plan son ${JSON.stringify(plan.node_args)}: sin --test, un fichero que muere al ` +
        `importarse no emite TAP, tap-runner no distingue esa muerte de un fallo suyo y el mutante sale ` +
        `RuntimeError — fuera del denominador. Eran 26 (#597), y el suelo del módulo no los caza`,
    );
    assert.equal(
      correEnElMismoProceso(plan.node_args),
      true,
      `los node_args del plan son ${JSON.stringify(plan.node_args)}: con --test y sin ` +
        `--test-isolation=none, la cobertura perTest y el tope de heap se apagan sin que nada se ponga rojo`,
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
    const porWorker = testConcurrencyDe(plan.node_args);
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

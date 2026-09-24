/** LA CADENA DE SKINS: las peticiones de `/skin_sprite_sheet` van de una en
 *  una, y al vaciarse la cadena se dice el BALANCE de lo que se restauró de la
 *  librería.
 *
 *  Secuencial porque cada anim son varias llamadas de imagen (una por
 *  dirección) que remote-gen ya paraleliza: encolar personajes en paralelo
 *  desde el cliente solo acumula HTTP colgados de minutos.
 *
 *  El balance es el del carril de restauración del atlas, para los skins: en
 *  desarrollo (`gatesDeImagen` → `restaurar`) cada NPC pregunta por su arte
 *  pagado, y una línea por anim tapaba el registro del jugador. Sale UNA por
 *  tanda, cuando no queda nada en la cadena. Solo cuenta lo que el gestor le
 *  dice (`restaurado`/`sinArte`): lo que se GENERA lo dice el panel de gasto.
 *
 *  Y cuenta PERSONAJES, no anims (#755): el jugador veía «15 sin arte» con
 *  cinco personajes delante, porque cada uno pregunta por tres. El personaje
 *  es el skin (uno por prompt, `skinKey`), así que dos NPC con la misma
 *  descripción son uno, y el jugador también cuenta. Un personaje ya contado
 *  en esta partida no vuelve a salir cuando sus anims lazy (un ataque, la
 *  muerte) preguntan después: el jugador ya sabe cómo va vestido. */
export class CadenaDeSkins {
  private chain: Promise<void> = Promise.resolve();
  private enCadena = 0;
  /** Por personaje, cuántas anims de ESTA tanda se restauraron y cuántas no
   *  tenían arte. */
  private tanda = new Map<string, { restauradas: number; sinArte: number }>();
  /** Personajes que ya salieron en una línea de esta partida. */
  private contados = new Set<string>();

  /** A dónde va la línea de balance (el registro del jugador). */
  anunciar: ((msg: string) => void) | null = null;

  /** Un paso más al final de la cadena. El paso no debe lanzar: sus fallos
   *  son suyos (el gestor los registra); si lanzara, la cadena seguiría igual. */
  encolar(paso: () => Promise<void>): void {
    this.enCadena++;
    this.chain = this.chain.then(async () => {
      try {
        await paso();
      } finally {
        this.enCadena--;
        this.cerrarSiVacia();
      }
    });
  }

  restaurado(personaje: string): void {
    this.apunte(personaje).restauradas++;
  }

  sinArte(personaje: string): void {
    this.apunte(personaje).sinArte++;
  }

  /** Al entrar o reanudar una partida: los personajes vuelven a contarse. */
  olvidarContados(): void {
    this.contados.clear();
  }

  private apunte(personaje: string): { restauradas: number; sinArte: number } {
    let a = this.tanda.get(personaje);
    if (!a) this.tanda.set(personaje, (a = { restauradas: 0, sinArte: 0 }));
    return a;
  }

  private cerrarSiVacia(): void {
    if (this.enCadena > 0) return;
    const recuento = { restaurados: 0, aMedias: 0, sinArte: 0 };
    for (const [personaje, a] of this.tanda) {
      if (this.contados.has(personaje)) continue;
      this.contados.add(personaje);
      if (a.restauradas === 0) recuento.sinArte++;
      else if (a.sinArte === 0) recuento.restaurados++;
      else recuento.aMedias++;
    }
    this.tanda.clear();
    const linea = rotuloDelBalanceDeSkins(recuento);
    if (linea) this.anunciar?.(linea);
  }
}

/** La línea de balance, en personajes. `null` si no hay nada que contar.
 *  «A medias» es el que tenía pagada alguna anim y alguna no. Los términos a
 *  cero se omiten, y la palabra «anim» no sale: es jerga del gestor. */
export function rotuloDelBalanceDeSkins(c: { restaurados: number; aMedias: number; sinArte: number }): string | null {
  if (c.restaurados + c.aMedias + c.sinArte === 0) return null;
  const partes: string[] = [];
  if (c.restaurados > 0) {
    partes.push(`${personajes(c.restaurados)} ${c.restaurados === 1 ? "restaurado" : "restaurados"} de la librería ($0)`);
  }
  if (c.aMedias > 0) partes.push(`${personajes(c.aMedias)} restaurado${c.aMedias === 1 ? "" : "s"} a medias`);
  if (c.sinArte > 0) partes.push(`${personajes(c.sinArte)} sin arte pagado (base y_bot)`);
  return `Skins: ${partes.join(", ")}`;
}

function personajes(n: number): string {
  return `${n} ${n === 1 ? "personaje" : "personajes"}`;
}

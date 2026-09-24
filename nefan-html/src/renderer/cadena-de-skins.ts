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
 *  dice (`restaurado`/`sinArte`): lo que se GENERA lo dice el panel de gasto. */
export class CadenaDeSkins {
  private chain: Promise<void> = Promise.resolve();
  private enCadena = 0;
  private balance = { restaurados: 0, sinArte: 0 };

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

  restaurado(): void {
    this.balance.restaurados++;
  }

  sinArte(): void {
    this.balance.sinArte++;
  }

  private cerrarSiVacia(): void {
    if (this.enCadena > 0) return;
    const b = this.balance;
    this.balance = { restaurados: 0, sinArte: 0 };
    if (b.restaurados + b.sinArte === 0) return;
    this.anunciar?.(
      `Skins: ${b.restaurados} anim(s) restaurada(s) de la librería ($0), ${b.sinArte} sin arte pagado (base y_bot)`,
    );
  }
}

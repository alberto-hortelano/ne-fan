# Cala de Brumaluz — descripción del motor narrativo

*Escenario autorado en voz de motor narrativo, sin formato declarativo: este
documento ES el contrato. La implementación debe serle fiel en composición,
paleta, hora y atmósfera; la técnica es libre.*

## Ambientación

Última luz de un día de otoño en **Brumaluz**, una aldea de pescadores
encajada en una cala en herradura, en la costa occidental de Miravanda. El sol
acaba de hundirse tras la bocana: el cielo pasa del ámbar quemado en el
horizonte a un azul de tinta hacia el cénit, y todo lo que mira al oeste arde
en contraluz. La marea está alta y quieta; el agua devuelve el cielo en
franjas alargadas y mece los reflejos naranjas de los primeros farolillos.
Una bruma baja y salina se arrastra desde la bocana y difumina el faro.
Huele a sal, a brea y a sardinas asándose en alguna lumbre.

## Geografía de la cala (coordenadas en metros, origen en el centro del agua)

- El **agua** ocupa el centro y el oeste (x < 10 aprox.), plana, con oleaje
  mínimo. El nivel del mar es y = 0.
- Al este, una **playa de guijarros** estrecha (x 10..16) que sube en rampa
  suave hasta la **explanada del pueblo** (x 16..46, y ≈ +1.5..+2.5).
- Al norte, un **espigón de piedra** (de x 8, z −14 hacia el oeste hasta
  x −26) que cierra la cala; en su punta, el **faro**.
- Al sur, la ladera sube en dos **bancales** con muretes de piedra seca
  (y +3 y +5.5) hasta perderse en la niebla.

## Elementos (los que la cámara debe poder encontrar)

1. **Faro** en la punta del espigón: torre troncocónica encalada de 11 m con
   dos franjas rojas, linterna acristalada con **luz encendida** — cálida, y
   su reflejo debe cruzar el agua hacia la cámara en la pose p0.
2. **Casa del farero**, adosada a la base del faro: caseta de piedra con
   tejado a un agua y una ventana iluminada.
3. **Espigón**: lomo de piedra gris de 3 m de ancho, y +1.2, con parapeto
   bajo del lado del mar y **tres norays** (bolardos) de hierro.
4. **Muelle de madera** saliendo de la explanada hacia el agua (z ≈ 0,
   de x 16 a x −2): tablones envejecidos sobre pilotes, y +1.0, con
   **dos farolillos de aceite** en postes al borde (luz naranja, halo en la
   bruma) y **cajas de pescado** apiladas junto al arranque.
5. **Tres barcas de pesca** de casco panzudo: dos amarradas al muelle
   (una azul desconchada "La Garza", una verde musgo), meciéndose apenas;
   una tercera varada en la playa, escorada, con el casco rojo óxido al aire.
6. **Redes tendidas** entre dos postes en la playa, con corchos.
7. **Nasas** (cestas de pesca) apiladas junto al muelle, 5 o 6.
8. **Siete casas de pueblo** en la explanada formando un frente irregular
   mirando al mar: dos plantas como mucho, muros encalados o de piedra vista,
   tejados a dos aguas de teja envejecida con distinta pendiente y altura de
   cumbrera; **cuatro o cinco ventanas encendidas** (cálidas, no todas), dos
   chimeneas y **una de ellas humeando** (columna fina que el viento del oeste
   tumba ligeramente hacia tierra).
9. **La taberna "El Congrio"**: la casa más cercana al muelle, con porche de
   madera, un **farol sobre la puerta**, un barril junto a la entrada y un
   cartel colgado (una silueta de pez basta).
10. **Callejón empedrado** que sube desde el muelle entre las casas hacia el
    este, con un **poste de farol** a media cuesta (encendido).
11. **Muretes de piedra seca** rematando los bancales del sur, con una
    **higuera vieja** de copa ancha e inclinada por el viento en el bancal
    bajo, y **tres cipreses** oscuros como agujas en el alto.
12. **Ermita minúscula** en el bancal alto del sur, encalada, con espadaña y
    campana: silueta recortada contra el último ámbar del cielo (pose p2).
13. **Gaviotas**: cuatro o cinco posadas (parapeto del espigón, cumbrera de
    la taberna), no en vuelo.
14. **Dos figuras humanas**: un pescador sentado al borde del muelle con una
    caña, de espaldas; y la tabernera de pie en el porche, recortada por la
    luz de la puerta abierta (interior cálido que se derrama en el suelo).
15. **Bruma baja** sobre el agua de la bocana (oeste), que gana densidad con
    la distancia y come el horizonte; el faro debe verse A TRAVÉS de ella.
16. **Cielo de anochecer**: gradiente ámbar→malva→azul tinta, dos o tres
    **nubes alargadas** oscuras a contraluz con el borde inferior encendido,
    y las **primeras estrellas** arriba (pocas, débiles). Una **luna**
    creciente fina, alta al sureste.
17. El **agua** refleja: la franja del cielo, la luz del faro (camino largo
    vertical roto por el oleaje) y los farolillos del muelle (manchas
    naranjas trémulas). Cerca de la playa, transparencia hacia guijarro.

## Paleta y luz (obligatorias)

- Fuente clave: el **cielo del oeste** (ámbar #e8963c → malva #7a5878 →
  azul tinta #1c2a4a). Nada de sol directo: todo es luz de cielo + puntos
  cálidos artificiales (#ffb15e aprox.) — el contraste cálido/frío es EL tema.
- Sombras y masas en azul-gris frío; los encalados recogen el malva del
  cielo; SOLO arden los huecos iluminados (ventanas, faroles, faro, puerta).
- Niveles: noche temprana legible, no oscuridad — las siluetas de tejados y
  colinas siempre separadas del cielo.

## Poses de cámara (1600×1000, ojo humano salvo indicación)

- **p0 — Postal desde el espigón**: cámara en el espigón a media distancia
  (x −10, z −12, y +2.8) mirando al pueblo (ESE): el frente de casas
  encendidas, el muelle con sus farolillos y sus reflejos, las barcas, la
  ladera con la ermita arriba a la derecha, la luna. El plano hero.
- **p1 — En el muelle**: sobre los tablones (x 8, z 0.5, y +2.6) mirando al
  oeste: el pescador sentado a contraluz, las dos barcas amarradas, y al
  fondo el faro encendido entre la bruma con su reflejo viniendo hacia
  cámara. Los dos farolillos del muelle flanquean el encuadre.
- **p2 — El callejón**: a media cuesta del callejón (x 30, z 6, y +4.2)
  mirando hacia abajo/oeste por entre las casas: el empedrado húmedo con el
  rebote del farol, fachadas en penumbra con ventanas encendidas, y el mar
  y la bocana enmarcados al fondo con la ermita recortada arriba a la izquierda.
- **p3 — La taberna**: tres cuartos frente a "El Congrio" (x 20, z 8, y +2.2)
  mirando NO: el porche con la tabernera a contraluz de la puerta, el farol,
  el barril, el cartel; detrás, el muelle y el espigón con el faro lejano.

## Criterio de éxito

Que cualquiera de las cuatro capturas funcione como pantalla de carga de un
juego comercial: una sola luz-tema (anochecer cálido/frío), escala humana
creíble, profundidad por bruma, y al menos tres puntos donde el ojo quiera
quedarse (faro, ventanas, farolillos).

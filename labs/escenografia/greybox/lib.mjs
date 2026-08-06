// Helpers de greybox — todas las medidas en METROS, origen de cada pieza en su
// BASE (y=0). Convención de mundo: x este (+derecha), z norte NEGATIVO (la
// cámara mira hacia -z), y altura. Cada mesh lleva userData.cat para la pasada
// de segmentación y castShadow/receiveShadow los pone el viewer en clay.
export function makeLib(THREE) {
  const manifest = [];

  function mat(color, rough = 0.92) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough });
  }

  function tag(obj, cat) {
    obj.traverse
      ? obj.traverse((m) => {
          if (m.isMesh) m.userData.cat = cat;
        })
      : (obj.userData.cat = cat);
    return obj;
  }

  /** Caja con origen en la base. */
  function box(w, h, d, color, cat = "prop", rough) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return tag(new THREE.Mesh(g, mat(color, rough)), cat);
  }

  /** Prisma de tejado a dos aguas, cumbrera a lo largo de z (profundidad d). */
  function gable(w, d, h, color, cat = "building") {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return tag(new THREE.Mesh(g, mat(color)), cat);
  }

  /** Pirámide (tejado de torre), base w×w. */
  function pyramid(w, h, color, cat = "building") {
    const g = new THREE.ConeGeometry(w * 0.72, h, 4);
    g.rotateY(Math.PI / 4);
    g.translate(0, h / 2, 0);
    return tag(new THREE.Mesh(g, mat(color)), cat);
  }

  /** Cilindro con origen en la base. */
  function cylinder(r, h, color, cat = "prop", rtop) {
    const g = new THREE.CylinderGeometry(rtop ?? r, r, h, 20);
    g.translate(0, h / 2, 0);
    return tag(new THREE.Mesh(g, mat(color)), cat);
  }

  /**
   * Casa: cuerpo + tejado a dos aguas. ridge: "z" (cumbrera en profundidad,
   * hastial hacia cámara) o "x" (cumbrera lateral, alero hacia cámara).
   */
  function house({
    w, d, h, roofH = 2, x = 0, z = 0, rot = 0,
    wall = 0xb4aa9c, roof = 0x847a6e, ridge = "x", id,
  }) {
    const grp = new THREE.Group();
    grp.add(box(w, h, d, wall, "building"));
    let r;
    if (ridge === "z") {
      r = gable(w, d, roofH, roof);
    } else {
      r = gable(d, w, roofH, roof);
      r.rotation.y = Math.PI / 2;
    }
    r.position.y = h;
    grp.add(r);
    grp.position.set(x, 0, z);
    grp.rotation.y = rot;
    if (id) manifest.push({ id, cat: "building", x, z, w, d, h: h + roofH, rot });
    return grp;
  }

  /** Cinta de suelo (calle/senda) siguiendo una polilínea XZ, y=0.02. */
  function ribbon(points, width, color, cat = "street", y = 0.02) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([px, pz]) => new THREE.Vector3(px, 0, pz)),
    );
    const n = Math.max(24, points.length * 10);
    const pos = [];
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const nx = -tan.z, nz = tan.x; // normal en el plano
      const hw = width / 2;
      pos.push(p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(color, 0.95));
    m.userData.noShadow = true;
    return tag(m, cat);
  }

  /** Suelo base. */
  function ground(size, color, cat = "terrain") {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      mat(color, 0.98),
    );
    m.rotation.x = -Math.PI / 2;
    m.userData.noShadow = true;
    return tag(m, cat);
  }

  /** Sol direccional con sombras configuradas. */
  function sun(color, intensity, pos, targetPos = [0, 0, -40], span = 90) {
    const l = new THREE.DirectionalLight(color, intensity);
    l.position.set(...pos);
    l.target.position.set(...targetPos);
    l.castShadow = true;
    l.shadow.mapSize.set(4096, 4096);
    l.shadow.camera.left = -span;
    l.shadow.camera.right = span;
    l.shadow.camera.top = span;
    l.shadow.camera.bottom = -span;
    l.shadow.camera.near = 1;
    l.shadow.camera.far = 500;
    l.shadow.bias = -0.0006;
    const g = new THREE.Group();
    g.add(l, l.target);
    return g;
  }

  /** Plano de cielo con gradiente vertical (no recibe fog ni sombras). */
  function sky(top, bottom, z = -400, w = 1600, h = 500) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.ShaderMaterial({
        uniforms: {
          top: { value: new THREE.Color(top) },
          bottom: { value: new THREE.Color(bottom) },
        },
        vertexShader:
          "varying float vY; void main(){ vY = uv.y;" +
          " gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "varying float vY; uniform vec3 top; uniform vec3 bottom;" +
          " void main(){ gl_FragColor = vec4(mix(bottom, top, vY), 1.0); }",
        depthWrite: false,
      }),
    );
    m.position.set(0, h / 2 - 60, z);
    m.userData.sky = true;
    return m;
  }

  /** Colinas lejanas: media elipse plana. */
  function hill(w, h, color, x, z, cat = "terrain") {
    const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(w / 2, h, w / 6);
    const m = new THREE.Mesh(g, mat(color, 1));
    m.position.set(x, 0, z);
    m.userData.noShadow = true;
    return tag(m, cat);
  }

  function barrel(x, z, r = 0.42, h = 0.85) {
    const b = cylinder(r, h, 0x8a7a64, "prop");
    b.position.set(x, 0, z);
    return b;
  }

  function crate(x, z, s = 0.9, rot = 0) {
    const c = box(s, s, s, 0x99896f, "prop");
    c.position.set(x, 0, z);
    c.rotation.y = rot;
    return c;
  }

  return {
    manifest, mat, tag, box, gable, pyramid, cylinder, house, ribbon,
    ground, sun, sky, hill, barrel, crate,
  };
}

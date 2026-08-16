class_name AuthTex
extends RefCounted
## Texturas procedurales del bench de autoría (sin assets externos):
## ruido FastNoiseLite coloreado + imágenes dibujadas a mano (tablones,
## tejas, franjas del faro, red, cartel del pez, blob de humo).

static var _rng := RandomNumberGenerator.new()


static func _init_rng(seed_v: int) -> void:
	_rng.seed = seed_v


static func _colorize(gray: Image, dark: Color, light: Color) -> ImageTexture:
	var w := gray.get_width()
	var h := gray.get_height()
	var out := Image.create(w, h, false, Image.FORMAT_RGB8)
	for y in h:
		for x in w:
			var v := gray.get_pixel(x, y).r
			out.set_pixel(x, y, dark.lerp(light, v))
	return ImageTexture.create_from_image(out)


## Ruido celular (guijarros/adoquines) o perlin (encalado, matorral).
static func noise_tex(seed_v: int, freq: float, cellular: bool, dark: Color, light: Color) -> ImageTexture:
	var n := FastNoiseLite.new()
	n.seed = seed_v
	n.frequency = freq
	if cellular:
		n.noise_type = FastNoiseLite.TYPE_CELLULAR
		n.cellular_return_type = FastNoiseLite.RETURN_CELL_VALUE
	else:
		n.noise_type = FastNoiseLite.TYPE_PERLIN
	var img := n.get_image(256, 256, false, false, true)
	return _colorize(img, dark, light)


static func planks(base: Color, seam: Color, vertical: bool) -> ImageTexture:
	_init_rng(101)
	var img := Image.create(256, 256, false, Image.FORMAT_RGB8)
	img.fill(base)
	var n := 7
	for i in n:
		var p := int(float(i) / float(n) * 256.0)
		var strip := int(256.0 / float(n))
		var shade := base.darkened(0.1 + _rng.randf() * 0.25)
		var rect := Rect2i(p, 0, strip, 256) if vertical else Rect2i(0, p, 256, strip)
		img.fill_rect(rect, shade)
		var seam_rect := Rect2i(p, 0, 2, 256) if vertical else Rect2i(0, p, 256, 2)
		img.fill_rect(seam_rect, seam)
		# vetas
		for v in 4:
			var q := p + 4 + _rng.randi_range(0, strip - 8)
			var veta := shade.darkened(0.3)
			var veta_rect := Rect2i(q, 0, 1, 256) if vertical else Rect2i(0, q, 256, 1)
			img.fill_rect(veta_rect, veta)
	return ImageTexture.create_from_image(img)


static func tiles(base: Color) -> ImageTexture:
	_init_rng(202)
	var img := Image.create(256, 256, false, Image.FORMAT_RGB8)
	img.fill(base.darkened(0.45))
	var rows := 9
	var cols := 8
	var cw := 256.0 / float(cols)
	var rh := 256.0 / float(rows)
	for r in rows:
		for c in cols:
			var x0 := int(float(c) * cw + (cw * 0.5 if r % 2 == 1 else 0.0))
			var shade := base.darkened(_rng.randf() * 0.35).lightened(_rng.randf() * 0.1)
			img.fill_rect(Rect2i(x0 % 256, int(float(r) * rh), int(cw) - 2, int(rh) - 2), shade)
	return ImageTexture.create_from_image(img)


static func lighthouse_bands() -> ImageTexture:
	var img := Image.create(8, 256, false, Image.FORMAT_RGB8)
	img.fill(Color("#ddd6cc"))
	img.fill_rect(Rect2i(0, int(256 * 0.30), 8, int(256 * 0.14)), Color("#a83226"))
	img.fill_rect(Rect2i(0, int(256 * 0.62), 8, int(256 * 0.14)), Color("#a83226"))
	return ImageTexture.create_from_image(img)


static func net() -> ImageTexture:
	var img := Image.create(128, 128, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var c := Color(0.11, 0.09, 0.08, 0.85)
	for i in 9:
		var p := int(float(i) / 8.0 * 127.0)
		for x in 128:
			var y1 := (p + x / 2) % 128
			var y2 := (p - x / 2 + 256) % 128
			img.set_pixel(x, y1, c)
			img.set_pixel(x, y2, c)
	return ImageTexture.create_from_image(img)


static func sign_fish() -> ImageTexture:
	var img := Image.create(128, 96, false, Image.FORMAT_RGB8)
	img.fill(Color("#4a3a26"))
	img.fill_rect(Rect2i(0, 0, 128, 4), Color("#2a2014"))
	img.fill_rect(Rect2i(0, 92, 128, 4), Color("#2a2014"))
	img.fill_rect(Rect2i(0, 0, 4, 96), Color("#2a2014"))
	img.fill_rect(Rect2i(124, 0, 4, 96), Color("#2a2014"))
	var fish := Color("#d8cba0")
	for y in 96:
		for x in 128:
			var dx := (float(x) - 56.0) / 30.0
			var dy := (float(y) - 48.0) / 12.0
			if dx * dx + dy * dy < 1.0:
				img.set_pixel(x, y, fish)
			# cola triangular
			if x > 84 and x < 105 and absf(float(y) - 48.0) < (float(x) - 84.0) * 0.9:
				img.set_pixel(x, y, fish)
	return ImageTexture.create_from_image(img)


static func soft_blob(tint: Color) -> ImageTexture:
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		for x in 64:
			var d := Vector2(float(x) - 32.0, float(y) - 32.0).length() / 32.0
			var a := clampf(1.0 - d, 0.0, 1.0)
			a = a * a
			img.set_pixel(x, y, Color(tint.r, tint.g, tint.b, a * tint.a))
	return ImageTexture.create_from_image(img)

/**
 * Encoders for raster formats the canvas can't produce. Output is uncompressed 24-bit RGB (the
 * maps are opaque, so alpha is dropped), or 1-bit for BMP.
 */

export interface Pixels {
	width: number;
	height: number;
	/** RGBA, row-major from the top (as in `ImageData`). */
	data: Uint8ClampedArray;
}

/** Windows BMP (BITMAPINFOHEADER, BI_RGB), rows stored bottom-up and padded to 4 bytes. */
export function encodeBmp({ width, height, data }: Pixels, dpi = 72): Uint8Array<ArrayBuffer> {
	const rowSize = Math.ceil((width * 3) / 4) * 4;
	const pixelBytes = rowSize * height;
	const offset = 14 + 40;
	const out = new Uint8Array(offset + pixelBytes);
	const v = new DataView(out.buffer);
	const ppm = Math.round(dpi / 0.0254);

	out[0] = 0x42; // 'B'
	out[1] = 0x4d; // 'M'
	v.setUint32(2, out.length, true);
	v.setUint32(10, offset, true);
	v.setUint32(14, 40, true);
	v.setInt32(18, width, true);
	v.setInt32(22, height, true); // positive = bottom-up
	v.setUint16(26, 1, true); // planes
	v.setUint16(28, 24, true); // bits per pixel
	v.setUint32(30, 0, true); // BI_RGB
	v.setUint32(34, pixelBytes, true);
	v.setInt32(38, ppm, true);
	v.setInt32(42, ppm, true);

	for (let y = 0; y < height; y++) {
		let o = offset + (height - 1 - y) * rowSize;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			out[o++] = data[i + 2];
			out[o++] = data[i + 1];
			out[o++] = data[i];
		}
	}
	return out;
}

/** Baseline TIFF: little-endian, one uncompressed RGB strip. */
export function encodeTiff({ width, height, data }: Pixels, dpi = 72): Uint8Array<ArrayBuffer> {
	const SHORT = 3;
	const LONG = 4;
	const RATIONAL = 5;
	const entries = 12;
	const ifdOffset = 8;
	const ifdSize = 2 + entries * 12 + 4;
	const bitsOffset = ifdOffset + ifdSize;
	const xResOffset = bitsOffset + 6;
	const yResOffset = xResOffset + 8;
	const pixelOffset = yResOffset + 8;
	const pixelBytes = width * height * 3;

	const out = new Uint8Array(pixelOffset + pixelBytes);
	const v = new DataView(out.buffer);
	out[0] = 0x49; // 'I'
	out[1] = 0x49; // 'I' = little-endian
	v.setUint16(2, 42, true);
	v.setUint32(4, ifdOffset, true);

	// Tags must be in ascending order.
	const tags: [tag: number, type: number, count: number, value: number][] = [
		[256, LONG, 1, width], // ImageWidth
		[257, LONG, 1, height], // ImageLength
		[258, SHORT, 3, bitsOffset], // BitsPerSample -> 8,8,8
		[259, SHORT, 1, 1], // Compression: none
		[262, SHORT, 1, 2], // PhotometricInterpretation: RGB
		[273, LONG, 1, pixelOffset], // StripOffsets
		[277, SHORT, 1, 3], // SamplesPerPixel
		[278, LONG, 1, height], // RowsPerStrip
		[279, LONG, 1, pixelBytes], // StripByteCounts
		[282, RATIONAL, 1, xResOffset], // XResolution
		[283, RATIONAL, 1, yResOffset], // YResolution
		[296, SHORT, 1, 2] // ResolutionUnit: inch
	];
	v.setUint16(ifdOffset, entries, true);
	tags.forEach(([tag, type, count, value], k) => {
		const o = ifdOffset + 2 + k * 12;
		v.setUint16(o, tag, true);
		v.setUint16(o + 2, type, true);
		v.setUint32(o + 4, count, true);
		// Inline SHORT values sit in the first two bytes of the value field.
		if (type === SHORT && count === 1) v.setUint16(o + 8, value, true);
		else v.setUint32(o + 8, value, true);
	});
	v.setUint32(ifdOffset + 2 + entries * 12, 0, true); // no next IFD

	for (let k = 0; k < 3; k++) v.setUint16(bitsOffset + k * 2, 8, true);
	for (const o of [xResOffset, yResOffset]) {
		v.setUint32(o, Math.round(dpi), true);
		v.setUint32(o + 4, 1, true);
	}

	for (let i = 0, o = pixelOffset; i < width * height; i++) {
		out[o++] = data[i * 4];
		out[o++] = data[i * 4 + 1];
		out[o++] = data[i * 4 + 2];
	}
	return out;
}

export type Rgb = [r: number, g: number, b: number];

/** Parse `#rgb` / `#rrggbb`. */
export function hexToRgb(hex: string): Rgb {
	let h = hex.replace('#', '');
	if (h.length === 3) h = [...h].map((c) => c + c).join('');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/**
 * 1-bit BMP with a two-colour palette: index 0 = background, 1 = ink. Each pixel is projected onto
 * the background→ink line; anything at least `threshold` of the way to ink becomes ink. A low
 * threshold keeps anti-aliased hairlines (a 0.5 px line rasterises to ~50% grey) from vanishing.
 */
export function encodeBmp1(
	{ width, height, data }: Pixels,
	background: Rgb,
	ink: Rgb,
	dpi = 72,
	threshold = 0.3
): Uint8Array<ArrayBuffer> {
	const rowSize = Math.ceil(width / 32) * 4;
	const pixelBytes = rowSize * height;
	const offset = 14 + 40 + 8;
	const out = new Uint8Array(offset + pixelBytes);
	const v = new DataView(out.buffer);
	const ppm = Math.round(dpi / 0.0254);

	out[0] = 0x42; // 'B'
	out[1] = 0x4d; // 'M'
	v.setUint32(2, out.length, true);
	v.setUint32(10, offset, true);
	v.setUint32(14, 40, true);
	v.setInt32(18, width, true);
	v.setInt32(22, height, true); // positive = bottom-up
	v.setUint16(26, 1, true); // planes
	v.setUint16(28, 1, true); // bits per pixel
	v.setUint32(30, 0, true); // BI_RGB
	v.setUint32(34, pixelBytes, true);
	v.setInt32(38, ppm, true);
	v.setInt32(42, ppm, true);
	v.setUint32(46, 2, true); // colours used
	v.setUint32(50, 2, true); // important colours
	// Palette entries are B, G, R, 0.
	[background, ink].forEach(([r, g, b], k) => out.set([b, g, r, 0], 54 + k * 4));

	const d: Rgb = [ink[0] - background[0], ink[1] - background[1], ink[2] - background[2]];
	const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
	for (let y = 0; y < height; y++) {
		const row = offset + (height - 1 - y) * rowSize;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const t =
				((data[i] - background[0]) * d[0] +
					(data[i + 1] - background[1]) * d[1] +
					(data[i + 2] - background[2]) * d[2]) /
				len2;
			if (t >= threshold) out[row + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}
	return out;
}

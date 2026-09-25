/** A single DEM tile: a regular lat/lon grid of elevations in metres. */
export interface DemTile {
	id: string;
	name: string;
	/** Bounding box in degrees. */
	west: number;
	south: number;
	east: number;
	north: number;
	/** Grid size (columns = lon, rows = lat). */
	width: number;
	height: number;
	/** Row-major, first row is the northern edge. NaN = no data. */
	data: Float32Array;
	minZ: number;
	maxZ: number;
}

export interface HillshadeOptions {
	/** Integer downsample factor for the preview raster. */
	downsample: number;
	/** Sun azimuth / altitude in degrees. */
	azimuth: number;
	altitude: number;
	/** Vertical exaggeration for shading. */
	zFactor: number;
}

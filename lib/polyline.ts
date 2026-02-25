/* polyline.ts
 * Polyline encode/decode + GeoJSON helpers
 * (Google Encoded Polyline Algorithm Format)
 */

export type LatLng = [lat: number, lng: number];
export type LngLat = [lng: number, lat: number];

export interface GeoJSONLineString {
    type: "LineString";
    coordinates: LngLat[];
}

export interface GeoJSONFeature<G = GeoJSONLineString> {
    type: "Feature";
    geometry: G;
    properties?: Record<string, unknown> | null;
    id?: string | number;
}

export type GeoJSONLineStringInput = GeoJSONLineString | GeoJSONFeature<GeoJSONLineString>;

export interface PolylineModule {
    decode(str: string, precision?: number): LatLng[];
    encode(coordinates: ReadonlyArray<Readonly<LatLng>>, precision?: number): string;
    fromGeoJSON(geojson: GeoJSONLineStringInput, precision?: number): string;
    toGeoJSON(str: string, precision?: number): GeoJSONLineString;
}

/**
 * Google's polyline algorithm uses the same rounding strategy as Python 2,
 * which differs from JS for negative values.
 */
function py2Round(value: number): number {
    return Math.floor(Math.abs(value) + 0.5) * (value >= 0 ? 1 : -1);
}

function encodeDelta(current: number, previous: number, factor: number): string {
    const c = py2Round(current * factor);
    const p = py2Round(previous * factor);

    let coordinate = (c - p) * 2;
    if (coordinate < 0) coordinate = -coordinate - 1;

    let output = "";
    while (coordinate >= 0x20) {
        output += String.fromCharCode((0x20 | (coordinate & 0x1f)) + 63);
        coordinate = Math.floor(coordinate / 32);
    }
    output += String.fromCharCode((coordinate | 0) + 63);
    return output;
}

function flipLatLngToLngLat(coords: ReadonlyArray<Readonly<LatLng>>): LngLat[] {
    const flipped: LngLat[] = [];
    for (let i = 0; i < coords.length; i++) {
        const [lat, lng] = coords[i];
        flipped.push([lng, lat]);
    }
    return flipped;
}

function flipLngLatToLatLng(coords: ReadonlyArray<Readonly<LngLat>>): LatLng[] {
    const flipped: LatLng[] = [];
    for (let i = 0; i < coords.length; i++) {
        const [lng, lat] = coords[i];
        flipped.push([lat, lng]);
    }
    return flipped;
}

function factorForPrecision(precision?: number): number {
    const p = Number.isInteger(precision) ? (precision as number) : 5;
    return Math.pow(10, p);
}

export const polyline: PolylineModule = {
    /**
     * Decodes to a [latitude, longitude] coordinates array.
     * Adapted from Project-OSRM style decoding.
     */
    decode(str: string, precision?: number): LatLng[] {
        let index = 0;
        let lat = 0;
        let lng = 0;

        const coordinates: LatLng[] = [];
        const factor = factorForPrecision(precision);

        while (index < str.length) {
            // latitude
            let shift = 1;
            let result = 0;
            let byte = 0;

            do {
                byte = str.charCodeAt(index++) - 63;
                result += (byte & 0x1f) * shift;
                shift *= 32;
            } while (byte >= 0x20);

            const latitudeChange = (result & 1) ? ((-result - 1) / 2) : (result / 2);

            // longitude
            shift = 1;
            result = 0;

            do {
                byte = str.charCodeAt(index++) - 63;
                result += (byte & 0x1f) * shift;
                shift *= 32;
            } while (byte >= 0x20);

            const longitudeChange = (result & 1) ? ((-result - 1) / 2) : (result / 2);

            lat += latitudeChange;
            lng += longitudeChange;

            coordinates.push([lat / factor, lng / factor]);
        }

        return coordinates;
    },

    /**
     * Encodes the given [latitude, longitude] coordinates array.
     */
    encode(coordinates: ReadonlyArray<Readonly<LatLng>>, precision?: number): string {
        if (!coordinates.length) return "";

        const factor = factorForPrecision(precision);

        let output =
            encodeDelta(coordinates[0][0], 0, factor) +
            encodeDelta(coordinates[0][1], 0, factor);

        for (let i = 1; i < coordinates.length; i++) {
            const a = coordinates[i];
            const b = coordinates[i - 1];
            output += encodeDelta(a[0], b[0], factor);
            output += encodeDelta(a[1], b[1], factor);
        }

        return output;
    },

    /**
     * Encodes a GeoJSON LineString feature/geometry.
     * GeoJSON is [lng, lat], polyline inputs are [lat, lng].
     */
    fromGeoJSON(geojson: GeoJSONLineStringInput, precision?: number): string {
        const geom = geojson?.type === "Feature" ? geojson.geometry : geojson;

        if (!geom || geom.type !== "LineString") {
            throw new Error("Input must be a GeoJSON LineString");
        }

        const latlng = flipLngLatToLatLng(geom.coordinates);
        return polyline.encode(latlng, precision);
    },

    /**
     * Decodes to a GeoJSON LineString geometry.
     */
    toGeoJSON(str: string, precision?: number): GeoJSONLineString {
        const latlng = polyline.decode(str, precision);
        return {
            type: "LineString",
            coordinates: flipLatLngToLngLat(latlng),
        };
    },
};

export default polyline;

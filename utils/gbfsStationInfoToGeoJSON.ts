// gbfsStationInfoToGeoJSON.ts

export interface GbfsStationInformation {
    data: { stations: GbfsStation[] };
    last_updated?: number;
    ttl?: number;
    version?: string;
}

export interface GbfsStation {
    station_id: string;
    short_name: string;
    lat: number;
    lon: number;

    // Everything else (GBFS + vendor extensions)
    [k: string]: unknown;
}

export type GeoJSONPoint = {
    type: "Point";
    coordinates: [number, number]; // [lon, lat]
};

export type GeoJSONFeature<P extends Record<string, unknown> = Record<string, unknown>> = {
    type: "Feature";
    geometry: GeoJSONPoint;
    properties: P;
};

export type GeoJSONFeatureCollection<P extends Record<string, unknown> = Record<string, unknown>> = {
    type: "FeatureCollection";
    features: Array<GeoJSONFeature<P>>;
};

export interface ConvertOptions {
    /** Default: true */
    keepLatLonInProperties?: boolean;

    /** Default: true (sets Feature.id = station_id) */
    setFeatureId?: boolean;

    /** Default: false (stores GBFS meta under properties.__gbfs) */
    includeGbfsMeta?: boolean;

    /** Default: undefined (drop properties keys) */
    dropProperties?: string[];
}

/**
 * Convert GBFS station_information JSON (already parsed/imported) to GeoJSON FeatureCollection.
 */
export function gbfsStationInfoToGeoJSON(
    input: GbfsStationInformation,
    opts: ConvertOptions = {},
): GeoJSONFeatureCollection<Record<string, unknown>> {
    const keepLatLonInProperties = opts.keepLatLonInProperties ?? true;
    const setFeatureId = opts.setFeatureId ?? true;
    const includeGbfsMeta = opts.includeGbfsMeta ?? false;
    const drop = new Set(opts.dropProperties ?? []);

    const stations = input?.data?.stations;
    if (!Array.isArray(stations)) {
        throw new Error("Invalid GBFS: expected input.data.stations to be an array");
    }

    const gbfsMeta =
        includeGbfsMeta
            ? { last_updated: input.last_updated, ttl: input.ttl, version: input.version }
            : undefined;

    return {
        type: "FeatureCollection",
        features: stations.map((s) => {
            if (typeof s?.lat !== "number" || typeof s?.lon !== "number") {
                throw new Error(`Invalid station coords for station_id=${String((s as any)?.station_id)}`);
            }

            const properties: Record<string, unknown> = { ...s };

            // Optionally remove lat/lon from properties (still used for geometry)
            if (!keepLatLonInProperties) {
                delete properties.lat;
                delete properties.lon;
            }

            // Optionally drop arbitrary keys
            for (const k of drop) delete properties[k];

            // Optionally include meta
            if (includeGbfsMeta) {
                (properties as any).__gbfs = gbfsMeta;
            }

            const feature: any = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [s.lon, s.lat] as [number, number] },
                properties,
            };

            if (setFeatureId) feature.id = s.station_id;

            return feature as GeoJSONFeature<Record<string, unknown>>;
        }),
    };
}

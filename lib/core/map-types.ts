export type StyleLayer = { id: string; type: string; 'source-layer'?: string };

export type LiveWxMap = {
    getLayer: (id: string) => unknown;
    getSource: (id: string) => unknown;
    addSource: (id: string, source: object) => void;
    addLayer: (layer: object, beforeId?: string) => void;
    removeLayer: (id: string) => void;
    removeSource: (id: string) => void;
    getStyle?: () => { layers?: StyleLayer[] };
    setPaintProperty?: (id: string, name: string, value: unknown) => void;
    setLayoutProperty?: (id: string, name: string, value: unknown) => void;
    getZoom?: () => number;
    getCenter?: () => { lat: number; lng: number };
    flyTo?: (options: { center: [number, number]; zoom?: number }) => void;
    getBounds?: () => {
        getWest: () => number;
        getEast: () => number;
        getSouth: () => number;
        getNorth: () => number;
    };
    on: (type: string, layerOrHandler: unknown, handler?: unknown) => void;
    off: (type: string, layerOrHandler: unknown, handler?: unknown) => void;
    once?: (type: string, handler: () => void) => void;
    isStyleLoaded?: () => boolean;
    queryRenderedFeatures?: (point: unknown, options?: object) => unknown[];
    addControl?: (control: object, position?: string) => void;
    removeControl?: (control: object) => void;
    getContainer?: () => HTMLElement;
    getCanvas?: () => HTMLCanvasElement;
    getCanvasContainer?: () => HTMLElement;
    project?: (lngLat: [number, number] | { lng: number; lat: number }) => { x: number; y: number };
    moveLayer?: (id: string, beforeId?: string) => void;
    hasImage?: (id: string) => boolean;
    addImage?: (
        id: string,
        image: ImageData | { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
        options?: { sdf?: boolean; pixelRatio?: number },
    ) => void;
    removeImage?: (id: string) => void;
};

export const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
export const DEV_ORIGIN: [number, number] = [172.60685, -43.45389];
export const DEV_DEST: [number, number] = [172.60697, -43.52097];

export type RoutingProvider = "valhalla" | "mapbox";
export type CameraMode = "following" | "overview";
export type Orientation = "north" | "heading";
export const ZOOM_LEVEL = 16;

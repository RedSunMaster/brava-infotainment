declare module "*.css";

declare module "*?url" {
	const url: string;
	export default url;
}

declare module "*.glb" {
	const url: string;
	export default url;
}
declare module "*.webp" {
	const url: string;
	export default url;
}
declare module "*.webm" {
	const url: string;
	export default url;
}
declare module "*.jpg" {
	const url: string;
	export default url;
}
declare module "*.svg" {
	import React from "react";
	const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
	export default ReactComponent;
	export { ReactComponent };
}

declare namespace NodeJS {
	interface ProcessEnv {
		MAPBOX_TOKEN: string;
		SPOTIFY_CLIENT_ID: string;
	}
}

// Exposed by src/preload.ts
interface Window {
	electronSpotify?: {
		openAuth: (url: string) => void;
		onCallback: (
			cb: (payload: { code: string | null; error: string | null }) => void,
		) => () => void;
	};
}

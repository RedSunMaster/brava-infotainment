declare module "*.css";

// Add this line so TypeScript accepts the import
declare module "*.glb" {
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
		MAPBOX_STYLE_DAY: string;
		MAPBOX_STYLE_DAWN: string;
		MAPBOX_STYLE_DUSK: string;
		MAPBOX_STYLE_NIGHT: string;
	}
}

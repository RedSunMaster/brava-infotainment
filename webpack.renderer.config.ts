import { ProgressPlugin, type Configuration } from "webpack";
import { rules } from "./webpack.rules";
import { envDefinePlugin } from "./webpack.plugins"; // ✅ import DefinePlugin

rules.push({ test: /\.css$/, use: ["style-loader", "css-loader"] });
rules.push({ test: /\.(glb|gltf)$/, type: "asset/resource" });
rules.push({ test: /\.(jpg|jpeg|png)$/, type: "asset/resource" });

export const rendererConfig: Configuration = {
	target: "electron-renderer",
	cache: { type: "filesystem", buildDependencies: { config: [__filename] } },
	module: { rules },
	plugins: [new ProgressPlugin(), envDefinePlugin],
	resolve: { extensions: [".js", ".ts", ".jsx", ".tsx", ".css"] },
	optimization: {
		splitChunks: {
			chunks: "all",
			cacheGroups: {
				three: {
					test: /[\\/]node_modules[\\/]three/,
					name: "vendor-three",
					priority: 20,
				},
				mui: {
					test: /[\\/]node_modules[\\/]@mui/,
					name: "vendor-mui",
					priority: 20,
				},
				mapbox: {
					test: /[\\/]node_modules[\\/]mapbox-gl/,
					name: "vendor-mapbox",
					priority: 20,
				},
			},
		},
	},
};

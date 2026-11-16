import type { ModuleOptions } from "webpack";

export const rules: Required<ModuleOptions>["rules"] = [
	// Add support for native node modules
	{
		// We're specifying native_modules in the test because the asset relocator loader generates a
		// "fake" .node file which is really a cjs file.
		test: /native_modules[/\\].+\.node$/,
		use: "node-loader",
	},
	// webpack.rules.ts
	{
		test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
		// Files imported with ?url are emitted untouched (see the rule below).
		resourceQuery: { not: [/url/] },
		parser: { amd: false },
		exclude: [
			/node_modules[/\\]mapbox-gl/,
			/node_modules[/\\]three/,
			/node_modules[/\\]@mui/,
			/node_modules[/\\]@emotion/,
		],
		use: {
			loader: "@vercel/webpack-asset-relocator-loader",
			options: { outputAssetBase: "native_modules" },
		},
	},
	{
		test: /\.tsx?$/,
		exclude: /(node_modules|\.webpack)/,
		use: {
			loader: "ts-loader",
			options: {
				transpileOnly: true,
			},
		},
	},
	// `import url from "./file.js?url"` emits the file as-is and returns its URL.
	// Used for the Kokoro voice worker and its prebuilt browser bundle, which
	// must not be re-bundled for the Electron renderer target.
	{
		resourceQuery: /url/,
		type: "asset/resource",
		generator: { filename: "[name].[hash][ext]" },
	},
	{
		test: /\.svg$/,
		use: [
			{
				loader: "@svgr/webpack",
				options: {
					svgoConfig: {
						plugins: [{ name: "removeViewBox", active: false }],
					},
				},
			},
		],
	},
];

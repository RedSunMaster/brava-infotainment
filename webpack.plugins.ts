import { DefinePlugin } from "webpack";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";

const envPath = path.resolve(__dirname, ".env");
if (!fs.existsSync(envPath)) {
	throw new Error(`[webpack] .env file not found at: ${envPath}`);
}
dotenv.config({ path: envPath });

const required = [
	"MAPBOX_TOKEN",
	"MAPBOX_STYLE_DAY",
	"MAPBOX_STYLE_DAWN",
	"MAPBOX_STYLE_DUSK",
	"MAPBOX_STYLE_NIGHT",
] as const;

for (const key of required) {
	if (!process.env[key]) {
		throw new Error(
			`[webpack] Missing required env var: ${key} — check your .env file`,
		);
	}
}

// ✅ Exported separately so renderer can use it without ForkTsChecker
export const envDefinePlugin = new DefinePlugin({
	"process.env.MAPBOX_TOKEN": JSON.stringify(process.env.MAPBOX_TOKEN),
	"process.env.MAPBOX_STYLE_DAY": JSON.stringify(process.env.MAPBOX_STYLE_DAY),
	"process.env.MAPBOX_STYLE_DAWN": JSON.stringify(
		process.env.MAPBOX_STYLE_DAWN,
	),
	"process.env.MAPBOX_STYLE_DUSK": JSON.stringify(
		process.env.MAPBOX_STYLE_DUSK,
	),
	"process.env.MAPBOX_STYLE_NIGHT": JSON.stringify(
		process.env.MAPBOX_STYLE_NIGHT,
	),
});

export const plugins = [
	new ForkTsCheckerWebpackPlugin({ logger: "webpack-infrastructure" }),
	envDefinePlugin,
];

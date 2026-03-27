import { createConnection } from "net";

export async function GET() {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			const client = createConnection({ port: 2947, host: "localhost" });

			client.on("connect", () => {
				client.write('?WATCH={"enable":true,"json":true}\n');
			});

			let buffer = "";
			client.on("data", (chunk) => {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					try {
						const msg = JSON.parse(line);
						if (msg.class === "TPV") {
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({
										lat: msg.lat ?? null,
										lon: msg.lon ?? null,
										speed: msg.speed ?? 0,
										track: msg.track ?? null, // heading in degrees
										mode: msg.mode ?? 0, // 0=no data, 1=no fix, 2=2D, 3=3D
									})}\n\n`,
								),
							);
						}
					} catch {
						// Do Nothing
					}
				}
			});

			client.on("error", () => {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify({ error: true })}\n\n`),
				);
				controller.close();
			});
			client.on("close", () => controller.close());
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

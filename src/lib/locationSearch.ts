export type Coordinates = [number, number];

export interface LocationResult {
	id: string;
	name: string;
	address: string;
	coords: Coordinates | null;
	kind: string;
	source: "mapbox" | "photon" | "searchbox";
	distanceMeters?: number;
	sessionToken?: string;
}

export interface BusinessSuggestion {
	mapbox_id: string;
	name: string;
	full_address?: string;
	place_formatted?: string;
	poi_category?: string[];
	distance?: number;
}

export function businessResults(
	suggestions: BusinessSuggestion[],
	sessionToken: string,
): LocationResult[] {
	return suggestions.map((item): LocationResult => ({
		id: item.mapbox_id,
		name: item.name,
		address: item.full_address ?? item.place_formatted ?? "New Zealand",
		coords: null,
		kind: item.poi_category?.[0] ?? "Business",
		source: "searchbox",
		distanceMeters: item.distance,
		sessionToken,
	}));
}

export function broadenBusinessQuery(query: string): string | null {
	const words = query.trim().split(/\s+/);
	return words.length >= 3 && words.length <= 6 && !/^\d/.test(query.trim())
		? [words[0], ...words.slice(2)].join(" ")
		: null;
}

export function resultDistanceKm(
	item: LocationResult,
	origin: Coordinates,
): number | null {
	return item.coords
		? distanceKm(origin, item.coords)
		: Number.isFinite(item.distanceMeters)
			? item.distanceMeters / 1000
			: null;
}

export async function resolveLocation(
	item: LocationResult,
	token: string,
	signal: AbortSignal,
): Promise<Coordinates> {
	if (item.coords) return item.coords;
	if (item.source !== "searchbox" || !item.sessionToken)
		throw new Error("This destination has no usable location.");
	const params = new URLSearchParams({
		access_token: token,
		session_token: item.sessionToken,
	});
	const response = await fetch(
		`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(item.id)}?${params}`,
		{
			signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
		},
	);
	if (!response.ok)
		throw new Error("Could not locate this business. Try again.");
	const data: {
		features?: {
			geometry: { coordinates: Coordinates };
			properties?: {
				coordinates?: {
					routable_points?: {
						name: string;
						longitude: number;
						latitude: number;
					}[];
				};
			};
		}[];
	} = await response.json();
	const feature = data.features?.[0];
	const access = feature?.properties?.coordinates?.routable_points?.find(
		(point) => point.name === "default",
	);
	const coords: Coordinates = access
		? [access.longitude, access.latitude]
		: feature?.geometry.coordinates;
	if (!coords || !validCoordinates(coords))
		throw new Error("This business has no usable location.");
	return coords;
}

export interface GeocodingResponse {
	features?: {
		id?: string;
		geometry: { coordinates: Coordinates };
		properties: {
			mapbox_id?: string;
			name: string;
			full_address?: string;
			place_formatted?: string;
			feature_type?: string;
			coordinates?: {
				routable_points?: {
					name: string;
					longitude: number;
					latitude: number;
				}[];
			};
		};
	}[];
}

export interface PhotonResponse {
	features?: {
		geometry: { coordinates: Coordinates };
		properties: {
			osm_id?: number;
			osm_type?: string;
			osm_key?: string;
			osm_value?: string;
			name?: string;
			street?: string;
			housenumber?: string;
			city?: string;
			district?: string;
			county?: string;
			state?: string;
			countrycode?: string;
		};
	}[];
}

export function validCoordinates(coords: Coordinates): boolean {
	return (
		Array.isArray(coords) &&
		coords.length === 2 &&
		coords.every(Number.isFinite) &&
		Math.abs(coords[0]) <= 180 &&
		Math.abs(coords[1]) <= 90
	);
}

export function distanceKm(from: Coordinates, to: Coordinates): number {
	const rad = Math.PI / 180;
	const a =
		Math.sin(((to[1] - from[1]) * rad) / 2) ** 2 +
		Math.cos(from[1] * rad) *
			Math.cos(to[1] * rad) *
			Math.sin(((to[0] - from[0]) * rad) / 2) ** 2;
	return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function mapboxResults(data: GeocodingResponse): LocationResult[] {
	return (data.features ?? []).flatMap(({ id, geometry, properties: p }) => {
		const access = p.coordinates?.routable_points?.find(
			(point) => point.name === "default",
		);
		const coords: Coordinates = access
			? [access.longitude, access.latitude]
			: geometry.coordinates;
		if (!validCoordinates(coords) || !p.name) return [];
		return [
			{
				id: `mapbox:${p.mapbox_id ?? id ?? p.name}`,
				name: p.name,
				address: p.place_formatted ?? p.full_address ?? "New Zealand",
				coords,
				kind:
					p.feature_type === "address"
						? "Address"
						: p.feature_type === "street"
							? "Street"
							: "Place",
				source: "mapbox" as const,
			},
		];
	});
}

export function photonResults(data: PhotonResponse): LocationResult[] {
	return (data.features ?? []).flatMap(({ geometry, properties: p }) => {
		if (
			p.countrycode?.toUpperCase() !== "NZ" ||
			!validCoordinates(geometry.coordinates)
		)
			return [];
		const street = [p.housenumber, p.street].filter(Boolean).join(" ");
		const name = p.name ?? street;
		if (!name) return [];
		const address = [
			...new Set(
				[
					street !== name ? street : "",
					p.district,
					p.city ?? p.county,
					p.state,
				].filter(Boolean),
			),
		].join(", ");
		return [
			{
				id: `photon:${p.osm_type}:${p.osm_id}`,
				name,
				address: address || "New Zealand",
				coords: geometry.coordinates,
				kind: p.osm_value?.replace(/_/g, " ") ?? "Place",
				source: "photon" as const,
			},
		];
	});
}

export function mergeResults(
	addresses: LocationResult[],
	places: LocationResult[],
	query: string,
): LocationResult[] {
	const ordered = /^\s*\d/.test(query)
		? [...addresses, ...places]
		: [...places, ...addresses];
	const normalize = (text: string) =>
		text
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/\brd\b/g, "road")
			.replace(/\bst\b/g, "street")
			.replace(/[^a-z0-9]/g, "");
	const words = query
		.split(/\s+/)
		.filter((word) => word.length > 1 || /^\d+$/.test(word))
		.map(normalize);
	const scored = ordered
		.map((item, index) => {
			const label = normalize(`${item.name} ${item.address}`);
			const labelWords = `${item.name} ${item.address}`
				.split(/\s+/)
				.map(normalize);
			const coverage = words.length
				? words.filter(
						(word) =>
							label.includes(word) ||
							labelWords.some((candidate) => closeSpelling(word, candidate)),
					).length / words.length
				: 1;
			const incidental = [
				"bus stop",
				"platform",
				"cycleway",
				"footway",
			].includes(item.kind);
			return {
				item,
				index,
				coverage,
				score:
					coverage -
					(incidental ? 0.25 : 0) +
					(item.distanceMeters != null && item.distanceMeters < 50000 ? 1 : 0),
			};
		})
		.filter((item) => item.coverage >= 0.65)
		.sort((a, b) => b.score - a.score || a.index - b.index);
	return scored
		.map((entry) => entry.item)
		.filter(
			(item, index, matches) =>
				!matches
					.slice(0, index)
					.some(
						(previous) =>
							previous.id === item.id ||
							(previous.coords &&
								item.coords &&
								previous.name.toLocaleLowerCase() ===
									item.name.toLocaleLowerCase() &&
								distanceKm(previous.coords, item.coords) < 0.15),
					),
		)
		.slice(0, 8);
}

function closeSpelling(a: string, b: string): boolean {
	if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 2)
		return false;
	let row = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(
				next[j - 1] + 1,
				row[j] + 1,
				row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		row = next;
	}
	return row[b.length] <= (a.length >= 8 ? 2 : 1);
}

export function searchUrls(
	query: string,
	position: Coordinates,
	token: string,
): { address: string; places: string } {
	const address = new URLSearchParams({
		q: query.trim(),
		country: "nz",
		proximity: position.join(","),
		language: "en",
		limit: "5",
		types: "address,street,place,locality,neighborhood",
		access_token: token,
	});
	const places = new URLSearchParams({
		q: query.trim(),
		countrycode: "NZ",
		lon: String(position[0]),
		lat: String(position[1]),
		lang: "en",
		limit: "5",
	});
	return {
		address: `https://api.mapbox.com/search/geocode/v6/forward?${address}`,
		places: `https://photon.komoot.io/api/?${places}`,
	};
}

export async function searchLocations(
	query: string,
	position: Coordinates,
	token: string,
	signal: AbortSignal,
	sessionToken = crypto.randomUUID(),
): Promise<{ results: LocationResult[]; warning: string | null }> {
	const urls = searchUrls(query, position, token);
	const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
	async function request<T>(url: string): Promise<T> {
		const response = await fetch(url, { signal: requestSignal });
		if (!response.ok) throw new Error("Search service unavailable.");
		return response.json();
	}
	async function businesses(): Promise<LocationResult[]> {
		async function suggest(
			text: string,
			nearby = false,
		): Promise<BusinessSuggestion[]> {
			const params = new URLSearchParams({
				q: text,
				country: "nz",
				proximity: position.join(","),
				types: "poi",
				limit: "10",
				session_token: sessionToken,
				access_token: token,
			});
			if (nearby) {
				const lngRadius = 50 / (111 * Math.cos((position[1] * Math.PI) / 180));
				params.set(
					"bbox",
					[
						position[0] - lngRadius,
						position[1] - 0.45,
						position[0] + lngRadius,
						position[1] + 0.45,
					].join(","),
				);
			}
			const data = await request<{ suggestions?: BusinessSuggestion[] }>(
				`https://api.mapbox.com/search/searchbox/v1/suggest?${params}`,
			);
			return data.suggestions ?? [];
		}
		try {
			const full = await suggest(query);
			const broad = broadenBusinessQuery(query);
			const extra =
				broad &&
				full.filter((item) => item.distance != null && item.distance < 50000)
					.length < 2
					? await suggest(broad, true).catch((): BusinessSuggestion[] => [])
					: [];
			const categories = new Set(
				full.flatMap((item) => item.poi_category?.slice(0, 1) ?? []),
			);
			const related = extra.filter(
				(item) =>
					!categories.size ||
					!item.poi_category?.length ||
					item.poi_category.some((category) => categories.has(category)),
			);
			return businessResults([...full, ...related], sessionToken).sort(
				(a, b) =>
					(a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
			);
		} catch {
			return photonResults(await request<PhotonResponse>(urls.places));
		}
	}
	const [addresses, places] = await Promise.allSettled([
		request<GeocodingResponse>(urls.address),
		businesses(),
	]);
	if (signal.aborted) throw new DOMException("Search cancelled", "AbortError");
	if (addresses.status === "rejected" && places.status === "rejected")
		throw new Error(
			"Search could not connect. Check your internet and try again.",
		);
	return {
		results: mergeResults(
			addresses.status === "fulfilled" ? mapboxResults(addresses.value) : [],
			places.status === "fulfilled" ? places.value : [],
			query,
		),
		warning:
			addresses.status === "rejected"
				? "Address search is unavailable. Showing places only."
				: places.status === "rejected"
					? "Business search is unavailable. Showing addresses only."
					: null,
	};
}

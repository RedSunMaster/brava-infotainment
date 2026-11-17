export type Coordinates = [number, number];
export interface PlaceDetails { address?: string; category?: string; phone?: string; website?: string; hours?: string; accessibility?: string; photo?: string; mapboxId?: string }
export function placeDetails(properties: any): PlaceDetails {
	const metadata = properties?.metadata ?? {};
	const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
	const periods = Array.isArray(metadata.open_hours?.periods) ? metadata.open_hours.periods : [];
	const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
	const time = (value: unknown) => typeof value === "string" && /^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
	const hours = periods.flatMap((period: any) => {
		const start = time(period.open?.time), end = time(period.close?.time);
		const day = days[period.open?.day];
		const endDay = days[period.close?.day];
		return day && start && end && endDay ? [`${day} ${start}-${end}`] : [];
	}).join("; ");
	const photos = Array.isArray(properties?.photos) ? properties.photos : [];
	const photo = photos.find((item: any) => typeof item?.url === "string" && /^https:\/\//i.test(item.url))?.url;
	const attributes = properties?.attributes ?? {};
	return { address: text(properties?.full_address) ?? text(properties?.place_formatted) ?? text(properties?.address), category: text(properties?.primary_category) ?? (Array.isArray(properties?.poi_category) ? text(properties.poi_category[0]) : undefined), phone: text(properties?.phone) ?? text(metadata.phone), website: text(properties?.website) ?? text(metadata.website), hours: text(properties?.opening_hours) ?? (hours || undefined), accessibility: attributes.accommodation_wheelchair_accessible_entrance === true ? "Wheelchair accessible entrance" : metadata.wheelchair_accessible === true ? "Wheelchair accessible" : undefined, photo, mapboxId: text(properties?.mapbox_id) };
}

/** Map labels are often shorter than search names ("New World" vs "New World Northwood"). */
export function sameBusinessName(a: string, b: string): boolean {
	const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
	const [x, y] = [normalize(a), normalize(b)];
	return x.length >= 3 && y.length >= 3 && (x === y || x.includes(y) || y.includes(x));
}

export async function fetchPlaceDetails(id: string, token: string, signal: AbortSignal): Promise<PlaceDetails> {
	const response = await fetch(`https://api.mapbox.com/places/v1/details/retrieve/${encodeURIComponent(id)}?${new URLSearchParams({ access_token: token })}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
	if (!response.ok) throw new Error("Business details unavailable.");
	return placeDetails(await response.json());
}
export interface LocationResult {
	id: string;
	name: string;
	address: string;
	coords: Coordinates | null;
	buildingCoords?: Coordinates;
	kind: string;
	source: "mapbox" | "photon" | "searchbox";
	distanceMeters?: number;
	/** Extra driving time to visit this place on the way to the destination. */
	detourSeconds?: number | null;
	sessionToken?: string;
	details?: PlaceDetails;
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

const squash = (text: string) =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]/g, "");

export function uniqueSuggestions(items: BusinessSuggestion[]): BusinessSuggestion[] {
	const seen = new Set<string>();
	return items.filter((item) => !seen.has(item.mapbox_id) && !!seen.add(item.mapbox_id));
}

/**
 * Other spellings of a business the query almost certainly means, taken from
 * Photon results whose name matches once spaces and punctuation are ignored
 * ("pbtech" → "PB Tech"). Never returns the query's own spelling.
 */
export async function spellingVariants(
	query: string,
	photon: Promise<PhotonResponse>,
	max = 2,
): Promise<string[]> {
	const key = squash(query);
	if (key.length < 4) return [];
	const typed = query.trim().toLowerCase();
	const names = new Map<string, string>();
	// Letter/digit joins are a common typo: "mitre10" → "mitre 10".
	const split = query.trim().replace(/([a-z])(\d)/gi, "$1 $2").replace(/(\d)([a-z])/gi, "$1 $2");
	if (split.toLowerCase() !== typed) names.set(`${squash(split)}#split`, split);
	try {
		for (const item of photonResults(await photon)) {
			const itemKey = squash(item.name);
			if (itemKey.length >= 3 && itemKey.includes(key) && item.name.toLowerCase() !== typed && !names.has(itemKey))
				names.set(itemKey, item.name);
		}
	} catch {
		return [];
	}
	return [...names.values()].slice(0, max);
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
): Promise<{ coords: Coordinates; buildingCoords: Coordinates; details?: PlaceDetails }> {
	if (item.coords) {
		let details = item.details;
		if (details?.mapboxId) {
			try { const rich = await fetchPlaceDetails(details.mapboxId, token, signal); details = { ...details, ...Object.fromEntries(Object.entries(rich).filter(([, value]) => value != null)) }; }
			catch { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); }
		}
		return { coords: item.coords, buildingCoords: item.buildingCoords && validCoordinates(item.buildingCoords) ? item.buildingCoords : item.coords, ...(details ? { details } : {}) };
	}
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
				metadata?: any;
				full_address?: string;
				place_formatted?: string;
				poi_category?: string[];
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
	const center = feature?.geometry.coordinates;
	const basic = placeDetails(feature?.properties);
	let details = basic;
	try {
		const rich = await fetchPlaceDetails(item.id, token, signal);
		details = Object.fromEntries(Object.entries({ ...basic, ...Object.fromEntries(Object.entries(rich).filter(([, value]) => value != null)) }).filter(([, value]) => value != null));
	} catch { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); }
	return { coords, buildingCoords: center && validCoordinates(center) ? center : coords, details };
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
				buildingCoords: validCoordinates(geometry.coordinates) ? geometry.coordinates : coords,
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
	const words = query.replace(/\b(\d+)\/(\d+)\b/g, "$1 $2")
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
			// Prefer the place the query names over businesses that merely contain
			// it: "Christchurch Airport" should rank the airport above
			// "Avis Christchurch Airport". Kept below the nearby bonus so a
			// distant exact match never outranks a local one.
			const phrase = words.join("");
			const name = normalize(item.name);
			const nameMatch = name === phrase ? 0.4 : name.startsWith(phrase) ? 0.2 : 0;
			const kind = normalize(item.kind);
			const kindMatch = words.some(
				(word) => word.length >= 4 && kind.includes(word),
			)
				? 0.3
				: 0;
			const extraWords = item.name
				.split(/\s+/)
				.map(normalize)
				.filter(
					(candidate) =>
						candidate &&
						!words.some(
							(word) =>
								candidate.includes(word) || closeSpelling(word, candidate),
						),
				).length;
			return {
				item,
				index,
				coverage,
				score:
					coverage +
					nameMatch +
					kindMatch -
					Math.min(0.3, extraWords * 0.1) -
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
	async function request<T>(url: string, signal = requestSignal): Promise<T> {
		const response = await fetch(url, { signal });
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
			// Mapbox matches whole words, so "pbtech", "newworld" or "jbhifi" miss
			// the stores called "PB Tech", "New World" and "JB Hi-Fi". Photon
			// tolerates the missing spaces, so use it only to learn the spelling
			// and then search Mapbox again to get real, nearby, detailed results.
			const nearbyCount = [...full, ...extra].filter(
				(item) => item.distance != null && item.distance < 50000,
			).length;
			const respelled =
				nearbyCount < 2
					? await spellingVariants(query, request<PhotonResponse>(urls.places, AbortSignal.any([requestSignal, AbortSignal.timeout(2500)])))
					: [];
			const respelledResults = (
				await Promise.all(
					respelled.map((name) =>
						suggest(name).catch((): BusinessSuggestion[] => []),
					),
				)
			).flat();
			const categories = new Set(
				full.flatMap((item) => item.poi_category?.slice(0, 1) ?? []),
			);
			const related = extra.filter(
				(item) =>
					!categories.size ||
					!item.poi_category?.length ||
					item.poi_category.some((category) => categories.has(category)),
			);
			// Keep the provider's relevance order. Sorting by distance here used
			// to push the place a query names (a mall, an airport) below every
			// nearer shop that merely contains its name; mergeResults still
			// favours nearby results over distant ones.
			return businessResults(
				uniqueSuggestions([...full, ...respelledResults, ...related]),
				sessionToken,
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

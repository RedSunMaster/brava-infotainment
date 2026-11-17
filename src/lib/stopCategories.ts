/** Quick stop categories offered along a route; ids are Mapbox Search Box categories. */
export const STOP_CATEGORIES = [
	{ id: "gas_station", label: "Fuel" },
	{ id: "charging_station", label: "Charging" },
	{ id: "food_and_drink", label: "Food" },
	{ id: "parking", label: "Parking" },
] as const;
export type StopCategoryId = (typeof STOP_CATEGORIES)[number]["id"];
export const stopCategoryLabel = (id: string | null | undefined) => STOP_CATEGORIES.find(category => category.id === id)?.label;

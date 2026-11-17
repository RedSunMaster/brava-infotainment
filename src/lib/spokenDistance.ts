/** How far ahead a turn is, in words that sound natural and come from a small set (so the clips can be reused). */
export function spokenDistance(metres: number): string {
	const rounded = metres < 1000 ? roundMetres(metres) : roundKilometres(metres / 1000);
	return rounded < 1000
		? `In ${rounded} metres,`
		: `In ${rounded / 1000} ${rounded === 1000 ? "kilometre" : "kilometres"},`;
}

function roundMetres(metres: number): number {
	if (metres < 150) return Math.max(50, Math.round(metres / 10) * 10);
	if (metres < 500) return Math.round(metres / 50) * 50;
	return Math.min(900, Math.round(metres / 100) * 100);
}

function roundKilometres(km: number): number {
	if (km < 10) return Math.round(km * 2) * 500; // 1, 1.5, 2 … in metres
	return Math.round(km) * 1000;
}

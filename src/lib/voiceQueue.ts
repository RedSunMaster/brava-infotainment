/**
 * Speech jobs waiting for the voice model, which can only make one clip at a time.
 * Lower priority numbers go first; equal priorities keep their order. The phrase being
 * spoken right now jumps ahead of background preparation of later instructions.
 */
export class VoiceQueue<T> {
	private jobs: { item: T; priority: number; order: number }[] = [];
	private counter = 0;

	get size(): number {
		return this.jobs.length;
	}

	push(item: T, priority: number): void {
		this.jobs.push({ item, priority, order: this.counter++ });
	}

	/** Raises the priority of a waiting job (never lowers it). Returns whether it was found. */
	promote(matches: (item: T) => boolean, priority: number): boolean {
		const job = this.jobs.find(entry => matches(entry.item));
		if (!job) return false;
		job.priority = Math.min(job.priority, priority);
		return true;
	}

	next(): T | undefined {
		if (!this.jobs.length) return undefined;
		let best = 0;
		for (let i = 1; i < this.jobs.length; i++) {
			const [a, b] = [this.jobs[i], this.jobs[best]];
			if (a.priority < b.priority || (a.priority === b.priority && a.order < b.order)) best = i;
		}
		return this.jobs.splice(best, 1)[0].item;
	}

	clear(): void {
		this.jobs = [];
	}
}

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { type CameraMode, type Orientation } from "../constants";

export function useCameraMode(mapRef: React.RefObject<mapboxgl.Map | null>) {
	const [cameraMode, setCameraMode] = useState<CameraMode>("following");
	const [orientation, setOrientation] = useState<Orientation>("heading");
	const followingRef = useRef<CameraMode>("following");
	const orientationRef = useRef<Orientation>("heading");

	function setMode(mode: CameraMode) {
		setCameraMode(mode);
		followingRef.current = mode;
	}

	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;
		const canvas = map.getCanvas();

		const onDrag = () => setMode("overview");
		const onWheel = () => setMode("overview");
		map.on("dragstart", onDrag);
		canvas.addEventListener("wheel", onWheel, { passive: true });
		return () => {
			map.off("dragstart", onDrag);
			canvas.removeEventListener("wheel", onWheel);
		};
	}, [mapRef.current]);

	function showOverview(coords: [number, number][]) {
		if (!mapRef.current || coords.length === 0) return;
		setMode("overview");
		const bounds = coords.reduce(
			(b, c) => b.extend(c),
			new mapboxgl.LngLatBounds(coords[0], coords[0]),
		);
		mapRef.current.fitBounds(bounds, {
			padding: { top: 80, bottom: 80, left: 60, right: 60 },
			pitch: 0,
			bearing: 0,
			duration: 800,
			maxZoom: 14,
		});
	}

	// Just re-enable following — the render loop's jumpTo takes over next frame.
	function resumeFollowing() {
		setMode("following");
	}

	function toggleOrientation(currentBearing: number) {
		const mapBearing = mapRef.current?.getBearing() ?? 0;
		const isNorth = orientationRef.current === "north";

		// If already north-locked but map has drifted, snap north first
		if (isNorth && Math.abs(mapBearing) > 1) {
			mapRef.current!.easeTo({ bearing: 0, pitch: 0, duration: 500 });
			return;
		}

		const next: Orientation = isNorth ? "heading" : "north";
		orientationRef.current = next;
		setOrientation(next);

		// In overview, animate manually. In following, render loop applies it next frame.
		if (followingRef.current !== "following") {
			mapRef.current!.easeTo({
				bearing: next === "north" ? 0 : currentBearing,
				pitch: next === "north" ? 0 : 45,
				duration: 500,
			});
		}
	}

	return {
		cameraMode,
		orientation,
		followingRef, // consumed by usePositionPuck render loop
		orientationRef, // consumed by usePositionPuck render loop
		showOverview,
		resumeFollowing,
		toggleOrientation,
	};
}

import React from "react";
import { Button, type ButtonProps } from "@mui/material";

export default function DriveButton({ children, sx, ...props }: ButtonProps) {
	return <Button {...props} sx={[{
		minWidth: "var(--car-target, 112px)", minHeight: "var(--car-target, 112px)",
		fontSize: "clamp(20px, 2.8vw, 30px)", fontWeight: 700, borderRadius: 2,
		textTransform: "none", touchAction: "manipulation", lineHeight: 1.2,
		"& .MuiSvgIcon-root": { fontSize: "clamp(32px, 4vw, 44px)" },
		"&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 },
	}, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</Button>;
}

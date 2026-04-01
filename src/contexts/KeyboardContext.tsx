import React, {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
	ReactNode,
} from "react";
import InAppKeyboard from "../components/InAppKeyboard";

interface KeyboardContextValue {
	showKeyboard: (onEnter?: () => void) => void;
	hideKeyboard: () => void;
	isVisible: boolean;
}

const KeyboardContext = createContext<KeyboardContextValue>({
	showKeyboard: () => {},
	hideKeyboard: () => {},
	isVisible: false,
});

export function KeyboardProvider({ children }: { children: ReactNode }) {
	const [enterHandler, setEnterHandler] = useState<{ fn?: () => void }>({});
	const [visible, setVisible] = useState(false);
	const targetRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
	// Timestamp of last open — backdrop ignores events within 300ms of this
	const openedAtRef = useRef<number>(0);

	const showKeyboard = useCallback((onEnter?: () => void) => {
		const el = document.activeElement;
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			targetRef.current = el;
		}
		openedAtRef.current = Date.now();
		setEnterHandler({ fn: onEnter });
		setVisible(true);
	}, []);

	const hideKeyboard = useCallback(() => {
		setVisible(false);
		setEnterHandler({});
		// Do NOT blur here — blurring programmatically causes the input to re-fire
		// onFocus which immediately re-opens the keyboard in a loop.
		targetRef.current = null;
	}, []);

	return (
		<KeyboardContext.Provider
			value={{ showKeyboard, hideKeyboard, isVisible: visible }}
		>
			{children}
			{visible && (
				<InAppKeyboard
					targetRef={targetRef}
					openedAtRef={openedAtRef}
					onEnter={enterHandler.fn}
					onClose={hideKeyboard}
				/>
			)}
		</KeyboardContext.Provider>
	);
}

export function useKeyboard() {
	return useContext(KeyboardContext);
}

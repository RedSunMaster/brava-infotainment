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
	// Capture the focused input at the moment the keyboard opens so fast
	// keypresses never lose the target due to a stale document.activeElement.
	const targetRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

	const showKeyboard = useCallback((onEnter?: () => void) => {
		const el = document.activeElement;
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			targetRef.current = el;
		}
		setEnterHandler({ fn: onEnter });
		setVisible(true);
	}, []);

	const hideKeyboard = useCallback(() => {
		setVisible(false);
		setEnterHandler({});
		targetRef.current?.blur();
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

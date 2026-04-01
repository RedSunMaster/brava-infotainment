import React, {
	createContext,
	useCallback,
	useContext,
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

	const showKeyboard = useCallback((onEnter?: () => void) => {
		setEnterHandler({ fn: onEnter });
		setVisible(true);
	}, []);

	const hideKeyboard = useCallback(() => {
		setVisible(false);
		setEnterHandler({});
		(document.activeElement as HTMLElement)?.blur();
	}, []);

	return (
		<KeyboardContext.Provider
			value={{ showKeyboard, hideKeyboard, isVisible: visible }}
		>
			{children}
			{visible && (
				<InAppKeyboard onEnter={enterHandler.fn} onClose={hideKeyboard} />
			)}
		</KeyboardContext.Provider>
	);
}

export function useKeyboard() {
	return useContext(KeyboardContext);
}

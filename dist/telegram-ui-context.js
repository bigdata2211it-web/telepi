const passthroughText = (text) => text;
const plainTextTheme = {
    fg(_color, text) {
        return text;
    },
    bg(_color, text) {
        return text;
    },
    bold: passthroughText,
    italic: passthroughText,
    underline: passthroughText,
    inverse: passthroughText,
    strikethrough: passthroughText,
    getFgAnsi() {
        return "";
    },
    getBgAnsi() {
        return "";
    },
    getColorMode() {
        return "truecolor";
    },
    getThinkingBorderColor() {
        return passthroughText;
    },
    getBashModeBorderColor() {
        return passthroughText;
    },
};
function unsupported(method) {
    throw new Error(`TelePi does not yet support extension UI method '${method}'.`);
}
export function createTelegramUIContext(options) {
    return {
        async select(title, choices, dialogOptions) {
            if (!options.select) {
                unsupported("select");
            }
            return options.select(title, choices, dialogOptions);
        },
        async confirm(title, message, dialogOptions) {
            if (!options.confirm) {
                unsupported("confirm");
            }
            return options.confirm(title, message, dialogOptions);
        },
        async input(title, placeholder, dialogOptions) {
            if (!options.input) {
                unsupported("input");
            }
            return options.input(title, placeholder, dialogOptions);
        },
        notify(message, type) {
            options.notify(message, type);
        },
        onTerminalInput() {
            return () => { };
        },
        setStatus() { },
        setWorkingMessage() { },
        setWorkingIndicator() { },
        setHiddenThinkingLabel() { },
        setWidget() { },
        setFooter() { },
        setHeader() { },
        setTitle() { },
        async custom() {
            unsupported("custom");
        },
        pasteToEditor() { },
        setEditorText() { },
        getEditorText() {
            return "";
        },
        async editor() {
            unsupported("editor");
        },
        addAutocompleteProvider() { },
        setEditorComponent() { },
        // Pi exposes ctx.ui.theme in degraded UI modes like RPC. TelePi does not render ANSI,
        // so we provide a plain-text shim instead of the interactive terminal Theme instance.
        theme: plainTextTheme,
        getAllThemes() {
            return [];
        },
        getTheme() {
            return undefined;
        },
        setTheme() {
            return { success: false, error: "TelePi does not support theme switching through extension UI." };
        },
        getToolsExpanded() {
            return false;
        },
        setToolsExpanded() { },
    };
}

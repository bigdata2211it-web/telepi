import { getPiSessionContextKey } from "../pi-session.js";
export function createBotChatState() {
    const processingContexts = new Set();
    const switchingContexts = new Set();
    const transcribingContexts = new Set();
    const lastPrompts = new Map();
    const stagedInputs = new Map();
    const getContextKey = (target) => getPiSessionContextKey(target);
    return {
        isLocallyBusy(target) {
            const contextKey = getContextKey(target);
            return (processingContexts.has(contextKey) ||
                switchingContexts.has(contextKey) ||
                transcribingContexts.has(contextKey));
        },
        beginProcessing(target, promptText) {
            const contextKey = getContextKey(target);
            processingContexts.add(contextKey);
            lastPrompts.set(contextKey, promptText);
        },
        endProcessing(target) {
            processingContexts.delete(getContextKey(target));
        },
        beginSwitching(target) {
            switchingContexts.add(getContextKey(target));
        },
        endSwitching(target) {
            switchingContexts.delete(getContextKey(target));
        },
        beginTranscribing(target) {
            transcribingContexts.add(getContextKey(target));
        },
        endTranscribing(target) {
            transcribingContexts.delete(getContextKey(target));
        },
        getLastPrompt(target) {
            return lastPrompts.get(getContextKey(target));
        },
        clearPromptMemory(target) {
            lastPrompts.delete(getContextKey(target));
        },
        // Universal staged input (voice key, mirror, etc.)
        setStagedInput(target, data) {
            stagedInputs.set(getContextKey(target), data);
        },
        consumeStagedInput(target) {
            const key = getContextKey(target);
            const data = stagedInputs.get(key);
            if (data) stagedInputs.delete(key);
            return data;
        },
        hasStagedInput(target) {
            return stagedInputs.has(getContextKey(target));
        },
        // Voice-specific aliases (backwards compat)
        setPendingVoiceKey(target, backend) {
            this.setStagedInput(target, { dialog: "voice-key", step: "key", backend });
        },
        consumePendingVoiceKey(target) {
            const data = this.consumeStagedInput(target);
            if (data && data.dialog === "voice-key") return data.backend;
            return undefined;
        },
        hasPendingVoiceKey(target) {
            const data = stagedInputs.get(getContextKey(target));
            return data && data.dialog === "voice-key";
        },
    };
}

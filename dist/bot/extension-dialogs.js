import { InlineKeyboard } from "grammy";
import { renderDialogPanel, trimLine } from "./message-rendering.js";
export function createExtensionDialogManager(deps) {
    const pendingDialogs = new Map();
    const dialogContextKeys = new Map();
    let extensionDialogCounter = 0;
    const nextExtensionDialogId = () => {
        extensionDialogCounter += 1;
        return extensionDialogCounter.toString(36);
    };
    const setPending = (contextKey, pendingDialog) => {
        pendingDialogs.set(contextKey, pendingDialog);
        dialogContextKeys.set(pendingDialog.dialogId, contextKey);
    };
    const clearPending = (contextKey) => {
        const pendingDialog = pendingDialogs.get(contextKey);
        if (!pendingDialog) {
            return undefined;
        }
        pendingDialogs.delete(contextKey);
        dialogContextKeys.delete(pendingDialog.dialogId);
        if (pendingDialog.timeoutId) {
            clearTimeout(pendingDialog.timeoutId);
        }
        pendingDialog.abortCleanup?.();
        return pendingDialog;
    };
    const finalizePending = async (target, pendingDialog, rendered) => {
        if (!pendingDialog) {
            return;
        }
        await deps.editMessage(target, pendingDialog.messageId, rendered.text, {
            fallbackText: rendered.fallbackText,
            parseMode: rendered.parseMode,
            replyMarkup: undefined,
        });
    };
    const resolveCancelled = (pendingDialog) => {
        switch (pendingDialog.kind) {
            case "confirm":
                pendingDialog.resolve(false);
                return;
            case "select":
            case "input":
                pendingDialog.resolve(undefined);
                return;
        }
    };
    const createDialogTimeout = (contextKey, target, pendingDialog, onTimeout, timeoutMs) => {
        const delay = timeoutMs ?? deps.defaultTimeoutMs;
        return setTimeout(() => {
            if (pendingDialogs.get(contextKey)?.dialogId !== pendingDialog.dialogId) {
                return;
            }
            clearPending(contextKey);
            void finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, ["Dialog timed out."], "⏰")).catch((error) => {
                console.error("Failed to finalize timed-out extension dialog", error);
            });
            onTimeout();
        }, delay);
    };
    const getPending = (target) => pendingDialogs.get(deps.getContextKey(target));
    const getPendingForResolution = (target, dialogId) => {
        const dialogContextKey = dialogContextKeys.get(dialogId);
        if (dialogContextKey) {
            const pendingDialog = pendingDialogs.get(dialogContextKey);
            if (pendingDialog?.dialogId === dialogId) {
                return { contextKey: dialogContextKey, pendingDialog };
            }
            dialogContextKeys.delete(dialogId);
        }
        const contextKey = deps.getContextKey(target);
        const pendingDialog = pendingDialogs.get(contextKey);
        if (!pendingDialog || pendingDialog.dialogId !== dialogId) {
            return undefined;
        }
        return { contextKey, pendingDialog };
    };
    const matchesPendingMessage = (pendingDialog, messageId) => messageId === undefined || pendingDialog.messageId === messageId;
    return {
        hasPending(target) {
            return pendingDialogs.has(deps.getContextKey(target));
        },
        getPendingKind(target) {
            return getPending(target)?.kind;
        },
        async openSelect(target, title, options, dialogOptions) {
            const contextKey = deps.getContextKey(target);
            if (pendingDialogs.has(contextKey)) {
                throw new Error("TelePi already has a pending extension dialog for this chat/topic.");
            }
            const dialogId = nextExtensionDialogId();
            const keyboard = new InlineKeyboard();
            for (const [index, option] of options.entries()) {
                keyboard.text(`${index + 1}. ${trimLine(option, 44)}`, `ui_sel_${dialogId}_${index}`).row();
            }
            keyboard.text("✖️ Cancel", `ui_x_${dialogId}`).row();
            const rendered = renderDialogPanel(title, [
                `${options.length} option${options.length === 1 ? "" : "s"} available.`,
                "Use the buttons below.",
            ], "🧭");
            const message = await deps.sendTextMessage(target, rendered.text, {
                parseMode: rendered.parseMode,
                fallbackText: rendered.fallbackText,
                replyMarkup: keyboard,
            });
            return await new Promise((resolve) => {
                const pendingDialog = {
                    kind: "select",
                    dialogId,
                    messageId: message.message_id,
                    title,
                    options,
                    resolve,
                };
                if (dialogOptions?.signal) {
                    const onAbort = () => {
                        clearPending(contextKey);
                        void finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, ["Dialog cancelled."], "⛔"));
                        resolve(undefined);
                    };
                    dialogOptions.signal.addEventListener("abort", onAbort, { once: true });
                    pendingDialog.abortCleanup = () => dialogOptions.signal?.removeEventListener("abort", onAbort);
                }
                pendingDialog.timeoutId = createDialogTimeout(contextKey, target, pendingDialog, () => resolve(undefined), dialogOptions?.timeout);
                setPending(contextKey, pendingDialog);
            });
        },
        async openConfirm(target, title, message, dialogOptions) {
            const contextKey = deps.getContextKey(target);
            if (pendingDialogs.has(contextKey)) {
                throw new Error("TelePi already has a pending extension dialog for this chat/topic.");
            }
            const dialogId = nextExtensionDialogId();
            const rendered = renderDialogPanel(title, [message, "Choose Yes or No below."], "⚠️");
            const telegramMessage = await deps.sendTextMessage(target, rendered.text, {
                parseMode: rendered.parseMode,
                fallbackText: rendered.fallbackText,
                replyMarkup: new InlineKeyboard()
                    .text("✅ Yes", `ui_cfm_${dialogId}_yes`)
                    .text("✖️ No", `ui_cfm_${dialogId}_no`)
                    .row(),
            });
            return await new Promise((resolve) => {
                const pendingDialog = {
                    kind: "confirm",
                    dialogId,
                    messageId: telegramMessage.message_id,
                    title,
                    message,
                    resolve,
                };
                if (dialogOptions?.signal) {
                    const onAbort = () => {
                        clearPending(contextKey);
                        void finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, ["Dialog cancelled."], "⛔"));
                        resolve(false);
                    };
                    dialogOptions.signal.addEventListener("abort", onAbort, { once: true });
                    pendingDialog.abortCleanup = () => dialogOptions.signal?.removeEventListener("abort", onAbort);
                }
                pendingDialog.timeoutId = createDialogTimeout(contextKey, target, pendingDialog, () => resolve(false), dialogOptions?.timeout);
                setPending(contextKey, pendingDialog);
            });
        },
        async openInput(target, title, placeholder, dialogOptions) {
            const contextKey = deps.getContextKey(target);
            if (pendingDialogs.has(contextKey)) {
                throw new Error("TelePi already has a pending extension dialog for this chat/topic.");
            }
            const dialogId = nextExtensionDialogId();
            const rendered = renderDialogPanel(title, [placeholder ?? "Reply in chat below.", placeholder ? "Reply in chat below." : ""].filter((line) => line.length > 0), "✍️");
            const telegramMessage = await deps.sendTextMessage(target, rendered.text, {
                parseMode: rendered.parseMode,
                fallbackText: rendered.fallbackText,
                replyMarkup: new InlineKeyboard().text("✖️ Cancel", `ui_x_${dialogId}`).row(),
            });
            return await new Promise((resolve) => {
                const pendingDialog = {
                    kind: "input",
                    dialogId,
                    messageId: telegramMessage.message_id,
                    title,
                    placeholder,
                    resolve,
                };
                if (dialogOptions?.signal) {
                    const onAbort = () => {
                        clearPending(contextKey);
                        void finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, ["Input cancelled."], "⛔"));
                        resolve(undefined);
                    };
                    dialogOptions.signal.addEventListener("abort", onAbort, { once: true });
                    pendingDialog.abortCleanup = () => dialogOptions.signal?.removeEventListener("abort", onAbort);
                }
                pendingDialog.timeoutId = createDialogTimeout(contextKey, target, pendingDialog, () => resolve(undefined), dialogOptions?.timeout);
                setPending(contextKey, pendingDialog);
            });
        },
        async consumeInput(target, userText) {
            const contextKey = deps.getContextKey(target);
            const pendingDialog = pendingDialogs.get(contextKey);
            if (!pendingDialog || pendingDialog.kind !== "input") {
                return false;
            }
            clearPending(contextKey);
            try {
                await finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, [`Received: ${userText}`], "✅"));
            }
            finally {
                pendingDialog.resolve(userText);
            }
            return true;
        },
        async cancelPending(target) {
            const contextKey = deps.getContextKey(target);
            const pendingDialog = clearPending(contextKey);
            if (!pendingDialog) {
                return false;
            }
            resolveCancelled(pendingDialog);
            await finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, ["Dialog cancelled."], "⛔"));
            return true;
        },
        async resolveSelect(target, dialogId, messageId, optionIndex) {
            const resolvedPending = getPendingForResolution(target, dialogId);
            if (!resolvedPending) {
                return { callbackText: "Dialog expired" };
            }
            const pendingDialog = resolvedPending.pendingDialog;
            if (pendingDialog.kind !== "select" || !matchesPendingMessage(pendingDialog, messageId)) {
                return { callbackText: "Dialog expired" };
            }
            const selected = pendingDialog.options[optionIndex];
            if (!selected) {
                return { callbackText: "Option expired" };
            }
            clearPending(resolvedPending.contextKey);
            return {
                callbackText: `Selected ${trimLine(selected, 32)}`,
                afterAnswer: async () => {
                    try {
                        await finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, [`Selected: ${selected}`], "✅"));
                    }
                    finally {
                        pendingDialog.resolve(selected);
                    }
                },
            };
        },
        async resolveConfirm(target, dialogId, messageId, confirmed) {
            const resolvedPending = getPendingForResolution(target, dialogId);
            if (!resolvedPending) {
                return { callbackText: "Dialog expired" };
            }
            const pendingDialog = resolvedPending.pendingDialog;
            if (pendingDialog.kind !== "confirm" || !matchesPendingMessage(pendingDialog, messageId)) {
                return { callbackText: "Dialog expired" };
            }
            clearPending(resolvedPending.contextKey);
            return {
                callbackText: confirmed ? "Confirmed" : "Cancelled",
                afterAnswer: async () => {
                    try {
                        await finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, [confirmed ? "Confirmed." : "Cancelled."], confirmed ? "✅" : "⛔"));
                    }
                    finally {
                        pendingDialog.resolve(confirmed);
                    }
                },
            };
        },
        async resolveCancel(target, dialogId, messageId) {
            const resolvedPending = getPendingForResolution(target, dialogId);
            if (!resolvedPending) {
                return { callbackText: "Dialog expired" };
            }
            const pendingDialog = resolvedPending.pendingDialog;
            if (!matchesPendingMessage(pendingDialog, messageId)) {
                return { callbackText: "Dialog expired" };
            }
            clearPending(resolvedPending.contextKey);
            return {
                callbackText: "Cancelled",
                afterAnswer: async () => {
                    try {
                        await finalizePending(target, pendingDialog, renderDialogPanel(pendingDialog.title, ["Dialog cancelled."], "⛔"));
                    }
                    finally {
                        resolveCancelled(pendingDialog);
                    }
                },
            };
        },
    };
}

import {} from "grammy";
import { escapeHTML } from "../../format.js";
import {} from "../keyboard.js";
import { renderFailedText, renderPrefixedError, renderSessionInfoPlain, renderSessionInfoHTML } from "../message-rendering.js";
function matchModel(model, query) {
    const q = query.toLowerCase();
    return model.provider.toLowerCase().includes(q)
        || model.id.toLowerCase().includes(q)
        || (model.name && model.name.toLowerCase().includes(q))
        || `${model.provider}/${model.id}`.toLowerCase().includes(q);
}

export function createModelCommandHandlers(deps) {
    const { getContextKey, getExistingSession, getOrCreateSession, isBusy, refreshChatScopedCommands, pendingModelPicks, pendingModelButtons, pendingModelExtraButtons, buildKeyboard, safeReply, safeEditMessage, surfaceStartupErrorDiagnostics, } = deps;
    const renderModelPicker = async (ctx, target, piSession, options) => {
        const contextKey = getContextKey(target);
        const showAll = options?.showAll ?? false;
        const messageId = options?.messageId;
        const filter = options?.filter?.trim();
        const models = await piSession.listModels(showAll);
        if (models.length === 0) {
            const message = "No models available.";
            if (messageId) {
                await safeEditMessage(target, messageId, escapeHTML(message), { fallbackText: message });
            }
            else {
                await safeReply(ctx, escapeHTML(message), { fallbackText: message }, target);
            }
            return;
        }
        const filteredModels = filter ? models.filter((m) => matchModel(m, filter)) : models;
        if (filteredModels.length === 0 && filter) {
            const msg = `No models match "${filter}". Showing all.`;
            const fallback = `No models match "${filter}". Showing all.`;
            if (messageId) {
                await safeEditMessage(target, messageId, escapeHTML(msg), { fallbackText: msg });
            }
            else {
                await safeReply(ctx, escapeHTML(msg), { fallbackText: msg }, target);
            }
            pendingModelPicks.set(contextKey, models);
            const buttons = models.map((model, index) => {
                const modelRef = `${model.provider}/${model.id}`;
                const nameSuffix = model.name && model.name !== model.id ? ` · ${model.name}` : "";
                const thinkingSuffix = model.thinkingLevel ? ` : ${model.thinkingLevel}` : "";
                return {
                    label: `${model.current ? "✅ " : ""}${modelRef}${nameSuffix}${thinkingSuffix}`,
                    callbackData: `model_${index}`,
                };
            });
            pendingModelButtons.set(contextKey, buttons);
            let extraBtns = [];
            if (!showAll) {
                const allModels = await piSession.listModels(true);
                if (allModels.length > models.length) {
                    extraBtns = [{ label: "Show all models", callbackData: "model_show_all" }];
                }
            }
            pendingModelExtraButtons.set(contextKey, extraBtns);
            const info = piSession.getInfo();
            const currentModelText = info.model ? `Current: ${info.model}` : "No model selected";
            const scopeHint = extraBtns.length > 0 ? "Showing the current Pi model scope." : undefined;
            const html = ["<b>Select a model</b>", escapeHTML(currentModelText), scopeHint ? `<i>${escapeHTML(scopeHint)}</i>` : undefined]
                .filter((line) => line !== undefined)
                .join("\n");
            const fallbackText2 = ["Select a model", currentModelText, scopeHint]
                .filter((line) => line !== undefined)
                .join("\n");
            const replyMarkup = buildKeyboard(buttons, 0, "model", extraBtns);
            if (messageId) {
                await safeEditMessage(target, messageId, html, { fallbackText: fallbackText2, replyMarkup });
            }
            else {
                await safeReply(ctx, html, { fallbackText: fallbackText2, replyMarkup }, target);
            }
            return;
        }
        const displayModels = filter ? filteredModels : models;
        pendingModelPicks.set(contextKey, displayModels);
        const modelButtons = displayModels.map((model, index) => {
            const modelRef = `${model.provider}/${model.id}`;
            const nameSuffix = model.name && model.name !== model.id ? ` · ${model.name}` : "";
            const thinkingSuffix = model.thinkingLevel ? ` : ${model.thinkingLevel}` : "";
            return {
                label: `${model.current ? "✅ " : ""}${modelRef}${nameSuffix}${thinkingSuffix}`,
                callbackData: `model_${index}`,
            };
        });
        pendingModelButtons.set(contextKey, modelButtons);
        let extraButtons = [];
        if (!showAll) {
            const allModels = await piSession.listModels(true);
            if (allModels.length > displayModels.length) {
                extraButtons = [{ label: "Show all models", callbackData: "model_show_all" }];
            }
        }
        if (filter) {
            extraButtons.unshift({ label: `🔍 "${filter}"`, callbackData: "model_show_all" });
            extraButtons.push({ label: "❌ Clear filter", callbackData: "model_clear_filter" });
        }
        pendingModelExtraButtons.set(contextKey, extraButtons);
        const info = piSession.getInfo();
        const currentModelText = info.model ? `Current: ${info.model}` : "No model selected";
        const filterText = filter ? `Filter: "${escapeHTML(filter)}"` : undefined;
        const scopeHint = extraButtons.length > 0 && !filter ? "Showing the current Pi model scope." : undefined;
        const html = ["<b>Select a model</b>", escapeHTML(currentModelText), filterText ? `<i>${filterText}</i>` : undefined, scopeHint ? `<i>${escapeHTML(scopeHint)}</i>` : undefined]
            .filter((line) => line !== undefined)
            .join("\n");
        const fallbackText = ["Select a model", currentModelText, filterText, scopeHint]
            .filter((line) => line !== undefined)
            .join("\n");
        const replyMarkup = buildKeyboard(modelButtons, 0, "model", extraButtons);
        if (messageId) {
            await safeEditMessage(target, messageId, html, { fallbackText, replyMarkup });
            return;
        }
        await safeReply(ctx, html, { fallbackText, replyMarkup }, target);
    };
    const handleModelCommand = async (ctx, target) => {
        const existing = getExistingSession(target);
        const hadActiveSession = existing?.hasActiveSession() === true;
        const piSession = await getOrCreateSession(target);
        if (!piSession.hasActiveSession()) {
            try {
                await piSession.newSession();
            }
            catch (error) {
                const failure = renderPrefixedError("Failed to create session", error);
                await safeReply(ctx, failure.text, {
                    fallbackText: failure.fallbackText,
                    parseMode: failure.parseMode,
                }, target);
                return;
            }
        }
        if (!hadActiveSession) {
            await surfaceStartupErrorDiagnostics(ctx, target, piSession.getInfo());
        }
        await refreshChatScopedCommands(target, piSession);

        const match = ctx.match?.trim();
        if (match) {
            // Если есть "/" — переключаем модель напрямую
            if (match.includes("/")) {
                const parts = match.split("/");
                const provider = parts[0].trim();
                const modelId = parts.slice(1).join("/").split(":")[0].trim();
                const thinkingLevel = parts.slice(1).join("/").split(":")[1]?.trim();
                if (provider && modelId) {
                    try {
                        const modelRef = await piSession.setModel(provider, modelId, thinkingLevel);
                        await safeReply(ctx, escapeHTML(`✅ Switched to ${modelRef}`), {
                            fallbackText: `Switched to ${modelRef}`,
                        }, target);
                        return;
                    }
                    catch (error) {
                        const failure = renderFailedText(error);
                        await safeReply(ctx, failure.text, {
                            fallbackText: failure.fallbackText,
                            parseMode: failure.parseMode,
                        }, target);
                        return;
                    }
                }
            }

            // Без "/" — показываем picker с фильтрацией по тексту
            await renderModelPicker(ctx, target, piSession, { filter: match });
            return;
        }

        // Без аргумента — показываем picker
        await renderModelPicker(ctx, target, piSession);
    };
    return {
        renderModelPicker,
        handleModelCommand,
    };
}

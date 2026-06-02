import { InlineKeyboard } from "grammy";
import { formatError } from "../errors.js";
import { appendWithCap, buildStreamingPreview, formatToolSummaryLine, isMessageNotModifiedError, renderExtensionError, renderExtensionNotice, renderPromptFailure, renderToolEndMessage, renderToolStartMessage, renderMarkdownChunkWithinLimit, splitMarkdownForTelegram, TOOL_OUTPUT_PREVIEW_LIMIT, } from "./message-rendering.js";
import { safeEditMessage, safeReply, sendChatAction, sendTextMessage, } from "./telegram-transport.js";
import { createTelegramUIContext } from "../telegram-ui-context.js";
import { maybeSendMedia } from "../media-sender.js";
async function runPromptFlow(deps, ctx, target, userText, preloadedSlashCommands, images) {
    const { bot, toolVerbosity, editDebounceMs, typingIntervalMs, ensureActiveSession, syncChatScopedCommands, refreshChatScopedCommands, extensionDialogs, } = deps;
    const piSession = await ensureActiveSession(ctx, target);
    if (!piSession) {
        return;
    }
    const slashCommands = preloadedSlashCommands;
    if (slashCommands) {
        void syncChatScopedCommands(target, slashCommands).catch((error) => {
            console.error("Failed to sync chat-scoped Telegram commands", error);
        });
    }
    else {
        void refreshChatScopedCommands(target, piSession);
    }
    const abortKeyboard = new InlineKeyboard().text("⏹ Abort", "pi_abort");
    const toolStates = new Map();
    const toolCounts = new Map();
    let accumulatedText = "";
    let responseMessageId;
    let responseMessagePromise;
    let lastRenderedText = "";
    let lastEditAt = 0;
    let flushTimer;
    let isFlushing = false;
    let flushPending = false;
    let finalized = false;
    const typingInterval = setInterval(() => {
        void sendChatAction(bot.api, target, "typing").catch(() => { });
    }, typingIntervalMs);
    void sendChatAction(bot.api, target, "typing").catch(() => { });
    const stopTyping = () => {
        clearInterval(typingInterval);
    };
    const clearFlushTimer = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = undefined;
        }
    };
    const renderPreview = () => {
        const previewText = buildStreamingPreview(accumulatedText);
        return renderMarkdownChunkWithinLimit(previewText);
    };
    const buildFinalResponseText = (text, modelName) => {
        let result = text.trim();
        if (toolVerbosity === "summary") {
            const summaryLine = formatToolSummaryLine(toolCounts);
            if (summaryLine) {
                result = result ? `${result}\n\n${summaryLine}` : summaryLine;
            }
        }
        if (modelName) {
            result += `\n\n🤖 ${modelName}`;
        }
        return result;
    };
    const ensureResponseMessage = async () => {
        if (responseMessageId) {
            return;
        }
        if (responseMessagePromise) {
            await responseMessagePromise;
            return;
        }
        responseMessagePromise = (async () => {
            stopTyping();
            const preview = renderPreview();
            const message = await sendTextMessage(bot.api, target, preview.text, {
                parseMode: preview.parseMode,
                fallbackText: preview.fallbackText,
                replyMarkup: abortKeyboard,
            });
            responseMessageId = message.message_id;
            lastRenderedText = preview.text;
            lastEditAt = Date.now();
        })();
        try {
            await responseMessagePromise;
        }
        finally {
            responseMessagePromise = undefined;
        }
    };
    const flushResponse = async (force = false) => {
        if (!accumulatedText) {
            return;
        }
        if (!responseMessageId) {
            await ensureResponseMessage();
            return;
        }
        if (isFlushing) {
            flushPending = true;
            return;
        }
        const now = Date.now();
        if (!force && now - lastEditAt < editDebounceMs) {
            return;
        }
        const nextText = renderPreview();
        if (nextText.text === lastRenderedText) {
            return;
        }
        isFlushing = true;
        try {
            await safeEditMessage(bot, target, responseMessageId, nextText.text, {
                parseMode: nextText.parseMode,
                fallbackText: nextText.fallbackText,
                replyMarkup: abortKeyboard,
            });
            lastRenderedText = nextText.text;
            lastEditAt = Date.now();
        }
        finally {
            isFlushing = false;
            if (flushPending) {
                flushPending = false;
                scheduleFlush();
            }
        }
    };
    const scheduleFlush = () => {
        if (flushTimer || finalized) {
            return;
        }
        const delay = Math.max(0, editDebounceMs - (Date.now() - lastEditAt));
        flushTimer = setTimeout(() => {
            flushTimer = undefined;
            void flushResponse().catch((error) => {
                console.error("Failed to update Telegram response message", error);
            });
        }, delay);
    };
    const removeAbortKeyboard = async () => {
        if (!responseMessageId) {
            return;
        }
        try {
            await bot.api.editMessageReplyMarkup(target.chatId, responseMessageId, {
                reply_markup: new InlineKeyboard(),
            });
        }
        catch (error) {
            if (!isMessageNotModifiedError(error)) {
                console.error("Failed to clear Abort button", error);
            }
        }
    };
    const deliverRenderedChunks = async (chunks) => {
        if (chunks.length === 0) {
            return;
        }
        const [firstChunk, ...remainingChunks] = chunks;
        if (responseMessageId) {
            await safeEditMessage(bot, target, responseMessageId, firstChunk.text, {
                parseMode: firstChunk.parseMode,
                fallbackText: firstChunk.fallbackText,
            });
            await removeAbortKeyboard();
        }
        else {
            const message = await sendTextMessage(bot.api, target, firstChunk.text, {
                parseMode: firstChunk.parseMode,
                fallbackText: firstChunk.fallbackText,
            });
            responseMessageId = message.message_id;
        }
        for (const chunk of remainingChunks) {
            await sendTextMessage(bot.api, target, chunk.text, {
                parseMode: chunk.parseMode,
                fallbackText: chunk.fallbackText,
            });
        }
    };
    const finalizeResponse = async () => {
        if (finalized) {
            return;
        }
        finalized = true;
        stopTyping();
        clearFlushTimer();
        if (responseMessagePromise) {
            try {
                await responseMessagePromise;
            }
            catch {
                // If the initial send failed, we will fall back to sending the final response below.
            }
        }
        const modelName = piSession.getInfo().model;
        const finalText = buildFinalResponseText(accumulatedText, modelName);
        if (!finalText) {
            const html = "<b>✅ Done</b>";
            const plainText = "✅ Done";
            if (responseMessageId) {
                await safeEditMessage(bot, target, responseMessageId, html, { fallbackText: plainText });
                await removeAbortKeyboard();
            }
            else {
                await safeReply(ctx, html, { fallbackText: plainText }, target);
            }
            return;
        }
        await deliverRenderedChunks(splitMarkdownForTelegram(finalText));
        // Send media if response contains media URLs
        maybeSendMedia(ctx, target, finalText, responseMessageId, bot).catch(err => {
            console.error("maybeSendMedia error:", err);
        });
    };
    await piSession.bindExtensions({
        commandContextActions: {
            waitForIdle: async () => {
                await piSession.getSession().agent.waitForIdle();
            },
            newSession: async (options) => {
                const result = await piSession.newSession(options);
                return { cancelled: !result.created };
            },
            fork: async (entryId, forkOptions) => piSession.fork(entryId, forkOptions),
            navigateTree: async (targetId, navOptions) => {
                const result = await piSession.navigateTree(targetId, navOptions);
                return { cancelled: result.cancelled };
            },
            switchSession: async (sessionPath, switchOptions) => {
                const result = await piSession.switchSession(sessionPath, switchOptions);
                return { cancelled: result.cancelled };
            },
            reload: async () => {
                await piSession.reload();
            },
        },
        uiContext: createTelegramUIContext({
            notify: (message, type) => {
                const rendered = renderExtensionNotice(message, type);
                void sendTextMessage(bot.api, target, rendered.text, {
                    parseMode: rendered.parseMode,
                    fallbackText: rendered.fallbackText,
                }).catch((error) => {
                    console.error("Failed to send extension notification", error);
                });
            },
            select: (title, choices, dialogOptions) => extensionDialogs.openSelect(target, title, choices, dialogOptions),
            confirm: (title, message, dialogOptions) => extensionDialogs.openConfirm(target, title, message, dialogOptions),
            input: (title, placeholder, dialogOptions) => extensionDialogs.openInput(target, title, placeholder, dialogOptions),
        }),
        onError: (error) => {
            const rendered = renderExtensionError(error.extensionPath, error.event, error.error);
            void sendTextMessage(bot.api, target, rendered.text, {
                parseMode: rendered.parseMode,
                fallbackText: rendered.fallbackText,
            }).catch((sendError) => {
                console.error("Failed to send extension error", sendError);
            });
        },
    });
    const unsubscribe = piSession.subscribe({
        onTextDelta: (delta) => {
            accumulatedText += delta;
            if (!responseMessageId) {
                void ensureResponseMessage()
                    .then(() => {
                    scheduleFlush();
                })
                    .catch((error) => {
                    console.error("Failed to send initial Telegram response message", error);
                });
                return;
            }
            scheduleFlush();
        },
        onToolStart: (toolName, toolCallId) => {
            if (toolVerbosity === "summary") {
                toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
                return;
            }
            if (toolVerbosity === "none") {
                return;
            }
            toolStates.set(toolCallId, { toolName, partialResult: "" });
            if (toolVerbosity !== "all") {
                return;
            }
            const messageText = renderToolStartMessage(toolName);
            void (async () => {
                const message = await sendTextMessage(bot.api, target, messageText.text, {
                    parseMode: messageText.parseMode,
                    fallbackText: messageText.fallbackText,
                });
                const state = toolStates.get(toolCallId);
                if (!state) {
                    return;
                }
                state.messageId = message.message_id;
                if (state.finalStatus) {
                    await safeEditMessage(bot, target, state.messageId, state.finalStatus.text, {
                        parseMode: state.finalStatus.parseMode,
                        fallbackText: state.finalStatus.fallbackText,
                    });
                }
            })().catch((error) => {
                console.error(`Failed to send tool start message for ${toolName}`, error);
            });
        },
        onToolUpdate: (toolCallId, partialResult) => {
            if (toolVerbosity === "none" || toolVerbosity === "summary") {
                return;
            }
            const state = toolStates.get(toolCallId);
            if (!state || !partialResult) {
                return;
            }
            state.partialResult = appendWithCap(state.partialResult, partialResult, TOOL_OUTPUT_PREVIEW_LIMIT);
        },
        onToolEnd: (toolCallId, isError) => {
            if (toolVerbosity === "none" || toolVerbosity === "summary") {
                return;
            }
            const state = toolStates.get(toolCallId);
            if (!state) {
                return;
            }
            state.finalStatus = renderToolEndMessage(state.toolName, state.partialResult, isError);
            if (toolVerbosity === "errors-only") {
                if (!isError) {
                    return;
                }
                void sendTextMessage(bot.api, target, state.finalStatus.text, {
                    parseMode: state.finalStatus.parseMode,
                    fallbackText: state.finalStatus.fallbackText,
                }).catch((error) => {
                    console.error(`Failed to send tool error message for ${state.toolName}`, error);
                });
                return;
            }
            if (!state.messageId) {
                return;
            }
            void safeEditMessage(bot, target, state.messageId, state.finalStatus.text, {
                parseMode: state.finalStatus.parseMode,
                fallbackText: state.finalStatus.fallbackText,
            }).catch((error) => {
                console.error(`Failed to update tool message for ${state.toolName}`, error);
            });
        },
        onAgentEnd: () => {
            void finalizeResponse().catch((error) => {
                console.error("Failed to finalize Telegram response message", error);
            });
        },
    });
    try {
        if (images && images.length > 0) {
            await piSession.prompt(userText, images);
        }
        else {
            await piSession.prompt(userText);
        }
        await finalizeResponse();
    }
    catch (error) {
        stopTyping();
        clearFlushTimer();
        if (responseMessagePromise) {
            try {
                await responseMessagePromise;
            }
            catch {
                // Ignore; we will send an error message below.
            }
        }
        if (finalized) {
            console.error("Pi prompt error after finalization:", formatError(error));
        }
        else {
            finalized = true;
            const modelName = piSession.getInfo().model;
            const combinedText = buildFinalResponseText(renderPromptFailure(accumulatedText, error), modelName);
            const chunks = splitMarkdownForTelegram(combinedText);
            try {
                await deliverRenderedChunks(chunks);
            }
            catch (telegramError) {
                console.error("Failed to send error message to Telegram:", telegramError);
            }
        }
    }
    finally {
        stopTyping();
        clearFlushTimer();
        unsubscribe();
    }
}
export function createPromptHandler(options) {
    const { isBusy, taskRunner, sendBusyReply, ...promptFlowDeps } = options;
    return async (ctx, target, userText, preloadedSlashCommands, images) => {
        if (isBusy(target)) {
            await sendBusyReply(ctx);
            return false;
        }
        const result = taskRunner.tryStartPrompt(target, userText, () => runPromptFlow(promptFlowDeps, ctx, target, userText, preloadedSlashCommands, images));
        if (result === "busy") {
            await sendBusyReply(ctx);
            return false;
        }
        return true;
    };
}

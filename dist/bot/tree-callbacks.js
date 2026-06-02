import { InlineKeyboard } from "grammy";
import { escapeHTML } from "../format.js";
import { renderBranchConfirmation, renderTree, truncateText, } from "../tree.js";
import { renderFailedText, stripHtml } from "./message-rendering.js";
export function registerTreeCallbacks(deps) {
    const { bot, getTelegramTarget, getContextKey, getExistingSession, isBusy, beginSwitching, endSwitching, pendingTreeViews, pendingTreeNavs, pendingBranchButtons, setPendingTreeView, clearPendingTreeView, buildTreeKeyboard, buildKeyboard, collectLabelsMap, safeReply, safeEditMessage, } = deps;
    const updateNavigationResult = async (ctx, target, messageId, entryId, result, options) => {
        if (result.cancelled) {
            const html = escapeHTML("Navigation cancelled.");
            if (messageId) {
                await safeEditMessage(target, messageId, html, { fallbackText: "Navigation cancelled." });
            }
            else {
                await safeReply(ctx, "Navigation cancelled.", { fallbackText: "Navigation cancelled.", parseMode: undefined }, target);
            }
            return;
        }
        let html = `<b>✅ Navigated to</b> <code>${escapeHTML(entryId.slice(0, 8))}</code>`;
        let plain = `✅ Navigated to ${entryId.slice(0, 8)}`;
        if (options?.summarize) {
            html += "\n📝 Branch summary saved.";
            plain += "\n📝 Branch summary saved.";
        }
        if (result.editorText) {
            html += `\n\nRe-submit: <i>${escapeHTML(truncateText(result.editorText, 200))}</i>`;
            plain += `\n\nRe-submit: ${truncateText(result.editorText, 200)}`;
        }
        html += "\n\nSend your next message to create a new branch from this point.";
        plain += "\n\nSend your next message to create a new branch from this point.";
        if (messageId) {
            await safeEditMessage(target, messageId, html, { fallbackText: plain });
            return;
        }
        await safeReply(ctx, html, { fallbackText: plain }, target);
    };
    const handleTreeNavigation = async (ctx, target, entryId, options) => {
        const messageId = ctx.callbackQuery?.message?.message_id;
        const contextKey = getContextKey(target);
        const piSession = getExistingSession(target);
        if (isBusy(target)) {
            await ctx.answerCallbackQuery({ text: "Wait for the current prompt to finish" });
            return;
        }
        const pendingId = pendingTreeNavs.get(contextKey);
        if (pendingId !== entryId || !piSession) {
            await ctx.answerCallbackQuery({ text: options?.expiredText ?? "Confirmation expired. Use /branch again." });
            return;
        }
        await ctx.answerCallbackQuery({ text: options?.busyText ?? "Navigating..." });
        pendingTreeNavs.delete(contextKey);
        pendingBranchButtons.delete(contextKey);
        clearPendingTreeView(contextKey);
        beginSwitching(target);
        try {
            const result = options?.summarize
                ? await piSession.navigateTree(entryId, { summarize: true })
                : await piSession.navigateTree(entryId);
            await updateNavigationResult(ctx, target, messageId, entryId, result, options);
        }
        catch (error) {
            const failure = renderFailedText(error);
            if (messageId) {
                await safeEditMessage(target, messageId, failure.text, {
                    fallbackText: failure.fallbackText,
                    parseMode: failure.parseMode,
                });
            }
            else {
                await safeReply(ctx, failure.text, {
                    fallbackText: failure.fallbackText,
                    parseMode: failure.parseMode,
                }, target);
            }
        }
        finally {
            endSwitching(target);
        }
    };
    bot.callbackQuery(/^tree_page_(\d+)$/, async (ctx) => {
        const target = getTelegramTarget(ctx);
        const messageId = ctx.callbackQuery?.message?.message_id;
        const page = Number.parseInt(ctx.match?.[1] ?? "", 10);
        if (!target || !messageId || Number.isNaN(page)) {
            await ctx.answerCallbackQuery();
            return;
        }
        const contextKey = getContextKey(target);
        const pendingTreeView = pendingTreeViews.get(contextKey);
        if (!pendingTreeView) {
            await ctx.answerCallbackQuery({ text: "Expired, run /tree again" });
            return;
        }
        if (isBusy(target)) {
            await ctx.answerCallbackQuery({ text: "Wait for the current prompt to finish" });
            return;
        }
        const piSession = getExistingSession(target);
        if (!piSession?.hasActiveSession()) {
            await ctx.answerCallbackQuery({ text: "No active session" });
            return;
        }
        const result = renderTree(piSession.getTree(), piSession.getLeafId(), {
            mode: pendingTreeView.mode,
            page,
        });
        await ctx.answerCallbackQuery();
        await safeEditMessage(target, messageId, result.text, {
            fallbackText: stripHtml(result.text),
            replyMarkup: result.buttons.length > 0 ? buildTreeKeyboard(result.buttons) : undefined,
        });
    });
    bot.callbackQuery(/^tree_nav_(.+)$/, async (ctx) => {
        const target = getTelegramTarget(ctx);
        const messageId = ctx.callbackQuery?.message?.message_id;
        const entryId = ctx.match?.[1];
        if (!target || !entryId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const contextKey = getContextKey(target);
        const piSession = getExistingSession(target);
        if (isBusy(target)) {
            await ctx.answerCallbackQuery({ text: "Wait for the current prompt to finish" });
            return;
        }
        if (!piSession?.hasActiveSession()) {
            await ctx.answerCallbackQuery({ text: "No active session" });
            return;
        }
        const entry = piSession.getEntry(entryId);
        if (!entry) {
            await ctx.answerCallbackQuery({ text: "Entry not found" });
            return;
        }
        const leafId = piSession.getLeafId();
        if (entry.id === leafId) {
            await ctx.answerCallbackQuery({ text: "Already at this point" });
            return;
        }
        await ctx.answerCallbackQuery({ text: "Loading..." });
        const confirmation = renderBranchConfirmation(entry, piSession.getChildren(entry.id), leafId, collectLabelsMap(piSession));
        pendingTreeNavs.set(contextKey, entry.id);
        pendingBranchButtons.set(contextKey, confirmation.buttons);
        const keyboard = buildKeyboard(confirmation.buttons, 0, "branch");
        if (messageId) {
            await safeEditMessage(target, messageId, confirmation.text, {
                fallbackText: stripHtml(confirmation.text),
                replyMarkup: keyboard,
            });
        }
        else {
            await safeReply(ctx, confirmation.text, {
                fallbackText: stripHtml(confirmation.text),
                replyMarkup: keyboard,
            }, target);
        }
    });
    bot.callbackQuery(/^tree_go_(.+)$/, async (ctx) => {
        const target = getTelegramTarget(ctx);
        const entryId = ctx.match?.[1];
        if (!target || !entryId) {
            await ctx.answerCallbackQuery();
            return;
        }
        await handleTreeNavigation(ctx, target, entryId);
    });
    bot.callbackQuery(/^tree_sum_(.+)$/, async (ctx) => {
        const target = getTelegramTarget(ctx);
        const entryId = ctx.match?.[1];
        if (!target || !entryId) {
            await ctx.answerCallbackQuery();
            return;
        }
        await handleTreeNavigation(ctx, target, entryId, {
            summarize: true,
            busyText: "Navigating with summary...",
        });
    });
    bot.callbackQuery("tree_cancel", async (ctx) => {
        const target = getTelegramTarget(ctx);
        if (target) {
            const contextKey = getContextKey(target);
            pendingTreeNavs.delete(contextKey);
            pendingBranchButtons.delete(contextKey);
            clearPendingTreeView(contextKey);
        }
        await ctx.answerCallbackQuery({ text: "Cancelled" });
        const messageId = ctx.callbackQuery?.message?.message_id;
        if (target && messageId) {
            await safeEditMessage(target, messageId, escapeHTML("Navigation cancelled."), {
                fallbackText: "Navigation cancelled.",
            });
        }
    });
    bot.callbackQuery(/^tree_mode_(.+)$/, async (ctx) => {
        const target = getTelegramTarget(ctx);
        const messageId = ctx.callbackQuery?.message?.message_id;
        const mode = ctx.match?.[1];
        if (!target || !messageId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const contextKey = getContextKey(target);
        const pendingTreeView = pendingTreeViews.get(contextKey);
        if (!pendingTreeView) {
            await ctx.answerCallbackQuery({ text: "Expired, run /tree again" });
            return;
        }
        if (isBusy(target)) {
            await ctx.answerCallbackQuery({ text: "Wait for the current prompt to finish" });
            return;
        }
        const piSession = getExistingSession(target);
        if (!piSession?.hasActiveSession()) {
            await ctx.answerCallbackQuery({ text: "No active session" });
            return;
        }
        await ctx.answerCallbackQuery();
        let filterMode = "default";
        if (mode === "all") {
            filterMode = "all-with-buttons";
        }
        else if (mode === "user") {
            filterMode = "user-only";
        }
        const result = renderTree(piSession.getTree(), piSession.getLeafId(), { mode: filterMode });
        const keyboard = result.buttons.length > 0 ? buildTreeKeyboard(result.buttons) : undefined;
        if (keyboard) {
            setPendingTreeView(contextKey, filterMode);
        }
        else {
            clearPendingTreeView(contextKey);
        }
        await safeEditMessage(target, messageId, result.text, {
            fallbackText: stripHtml(result.text),
            replyMarkup: keyboard,
        });
    });
}

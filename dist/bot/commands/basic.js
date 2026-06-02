import { escapeHTML } from "../../format.js";
import { renderFailedText, renderHelpHTML, renderHelpPlain, renderPrefixedError, renderSessionInfoHTML, renderSessionInfoPlain, renderVoiceSupportHTML, renderVoiceSupportPlain } from "../message-rendering.js";
export function createBasicCommandHandlers(deps) {
    const { sessionRegistry, getExistingSession, getOrCreateSession, refreshChatScopedCommands, openCommandPicker, handleUserPrompt, getLastPrompt, extensionDialogs, getVoiceBackendStatus, safeReply, } = deps;
    const handleStartCommand = async (ctx, target) => {
        const piSession = await getOrCreateSession(target);
        await refreshChatScopedCommands(target, piSession);
        const info = piSession.getInfo();
        let voiceStatus = { backends: [] };
        try {
            voiceStatus = (await getVoiceBackendStatus()) ?? { backends: [] };
        }
        catch {
            // Keep /start working even if backend probing fails.
        }
        const voiceInfoPlain = renderVoiceSupportPlain(voiceStatus.backends, voiceStatus.warning);
        const voiceInfoHTML = renderVoiceSupportHTML(voiceStatus.backends, voiceStatus.warning);
        const plainText = [
            "TelePi is ready.",
            "",
            "Each Telegram chat/topic gets its own Pi session.",
            "Send any text message to continue the current Pi session from Telegram.",
            "Send a voice message or audio file to transcribe it into a Pi prompt.",
            "Use /help to see all commands. Use /retry to resend the last prompt in this chat/topic.",
            voiceInfoPlain,
            "",
            renderSessionInfoPlain(info),
        ].join("\n");
        const html = [
            "<b>TelePi is ready.</b>",
            "",
            "Each Telegram chat/topic gets its own Pi session.",
            "Send any text message to continue the current Pi session from Telegram.",
            "Send a voice message or audio file to transcribe it into a Pi prompt.",
            "Use <code>/help</code> to see all commands. Use <code>/retry</code> to resend the last prompt in this chat/topic.",
            voiceInfoHTML,
            "",
            renderSessionInfoHTML(info),
        ].join("\n");
        await safeReply(ctx, html, { fallbackText: plainText }, target);
    };
    const handleHelpCommand = async (ctx, target) => {
        const info = sessionRegistry.getInfo(target);
        await safeReply(ctx, renderHelpHTML(info), {
            fallbackText: renderHelpPlain(info),
        }, target);
    };
    const handleCommandsCommand = async (ctx, target) => {
        await openCommandPicker(ctx, target);
    };
    const handleAbortCommand = async (ctx, target) => {
        await extensionDialogs.cancelPending(target);
        const piSession = getExistingSession(target);
        if (!piSession?.hasActiveSession()) {
            await safeReply(ctx, escapeHTML("No active session to abort."), {
                fallbackText: "No active session to abort.",
            }, target);
            return;
        }
        try {
            await piSession.abort();
            await safeReply(ctx, escapeHTML("Aborted current operation"), {
                fallbackText: "Aborted current operation",
            }, target);
        }
        catch (error) {
            const failure = renderFailedText(error);
            await safeReply(ctx, failure.text, {
                fallbackText: failure.fallbackText,
                parseMode: failure.parseMode,
            }, target);
        }
    };
    const handleSessionCommand = async (ctx, target) => {
        const info = sessionRegistry.getInfo(target);
        await safeReply(ctx, renderSessionInfoHTML(info), {
            fallbackText: renderSessionInfoPlain(info),
        }, target);
    };
    const handleRetryCommand = async (ctx, target) => {
        const lastPrompt = getLastPrompt(target);
        if (!lastPrompt) {
            await safeReply(ctx, escapeHTML("Nothing to retry yet in this chat/topic."), {
                fallbackText: "Nothing to retry yet in this chat/topic.",
            }, target);
            return;
        }
        await handleUserPrompt(ctx, target, lastPrompt);
    };
    return {
        handleStartCommand,
        handleHelpCommand,
        handleCommandsCommand,
        handleAbortCommand,
        handleSessionCommand,
        handleRetryCommand,
    };
}

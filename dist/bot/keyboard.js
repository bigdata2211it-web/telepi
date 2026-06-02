import { InlineKeyboard } from "grammy";
import { NOOP_PAGE_CALLBACK_DATA } from "../callback-data.js";
export const KEYBOARD_PAGE_SIZE = 6;
export { NOOP_PAGE_CALLBACK_DATA };
export function paginateKeyboard(items, page, prefix) {
    const totalPages = Math.max(1, Math.ceil(items.length / KEYBOARD_PAGE_SIZE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * KEYBOARD_PAGE_SIZE;
    const pageItems = items.slice(start, start + KEYBOARD_PAGE_SIZE);
    const keyboard = new InlineKeyboard();
    for (const item of pageItems) {
        keyboard.text(item.label, item.callbackData).row();
    }
    if (totalPages > 1) {
        if (safePage > 0) {
            keyboard.text("◀️ Prev", `${prefix}_page_${safePage - 1}`);
        }
        keyboard.text(`${safePage + 1}/${totalPages}`, NOOP_PAGE_CALLBACK_DATA);
        if (safePage < totalPages - 1) {
            keyboard.text("Next ▶️", `${prefix}_page_${safePage + 1}`);
        }
        keyboard.row();
    }
    return {
        keyboard,
    };
}
export function appendKeyboardItems(keyboard, items) {
    for (const item of items) {
        keyboard.text(item.label, item.callbackData).row();
    }
    return keyboard;
}

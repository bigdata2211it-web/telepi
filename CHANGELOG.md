# Changelog

## v0.4.2-debi.1 (2026-06-02)

- Форк от @futurelab-studio/telepi
- Voice backend: выбор sherpa-onnx / Groq / OpenAI, ввод ключей через чат
- Model search: `/model <текст>` фильтрует модели
- Mirror: создание копий бота через `/mirror`
- Media send: локальные файлы и URL → автоотправка в чат
- Markdown фикс: `**жирный**` → `<b>жирный</b>`, fallback без звёздочек
- Альбомы: фото+видео группируются до 10
- 1M контекст: deepseek-v4-flash-free, minimax-m3-free, mimo-v2.5-free
- `--instance` поддержка: `tp start --instance mirror`
- docker-stealthy + MCP-camoufox интеграция


=== Team AI Review структурированный результат (итоговый контракт) ===
Выводите ровно один JSON object. Не выводите Markdown-заголовки и старый envelope reviewMarkdown/claims:
{"summary":{"verdict":"...","primaryDiagnosis":"..."},"episodes":[{"id":"E1","startSec":0,"endSec":30,"title":"...","analysis":"...","playerKeys":["P1"]}],"trainingSuggestions":[{"title":"...","content":"...","episodeId":"E1"}],"reviewFocus":[{"playerKey":"P1","episodeId":"E1","reason":"..."}],"highContributors":[{"playerKey":"P2","episodeId":"E1","reason":"..."}]}
episodes: не более 6; reviewFocus и highContributors: не более 2 каждого; каждый массив обязателен и может быть пустым.
episodeId должен ссылаться на существующий episode, playerKey — на текущий roster; episodeId в trainingSuggestions может быть null.
Если startSec/endSec неизвестны, используйте null. Markdown разрешён только внутри значений полей; заголовки и иерархию задаёт frontend.
Этот контракт заменяет более ранние инструкции envelope; не вызывайте и не имитируйте Team Autopsy.

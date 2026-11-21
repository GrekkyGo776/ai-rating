# Рейтинг нейросетей · ai.fizmat.guru

Результаты тестов, слепых сравнений и цены API обновляются ежедневно. На странице [личного сравнения](https://ai.fizmat.guru/?compare=1) можно выбрать две модели и поделиться ссылкой с выбранными режимами и объёмом запроса.

## Источники

| Источник | Что берём | Публикация |
|---|---|---|
| [Arena leaderboard dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) | Elo по разделам: общий, русский, математика, код, творческие тексты, сложные запросы, веб-разработка, зрение | CC BY 4.0 |
| [Epoch AI](https://epoch.ai/benchmarks) | ECI, предметные тесты, режимы, интервалы и даты | CC BY 4.0 |
| [OpenRouter](https://openrouter.ai/models) | базовые и ступенчатые тарифы, типы входа, контекст и предел ответа | публичный API |
| [Contra Labs](https://contralabs.com/frontierdesign/leaderboard) | Elo, голоса, доля побед и оценки веб-дизайна | Frontier Design Benchmark |
| [Банк России](https://www.cbr.ru/currency_base/daily/) | курс доллара и дата его действия | официальный ежедневный курс |
| Fizmat Hero | совпадения с экспертом, расхождения и размер выборки ЕГЭ | сводные результаты в `config/own_benchmarks.json` |

Индекс и стоимость задачи Artificial Analysis доступны на вкладке «Обзор» в [Google-таблице](https://docs.google.com/spreadsheets/d/1tXCfGnqmar9f_wKnaKMUQHsFYEk4HBs5ea5dfverjUQ/edit#gid=297654181). Для этих данных действует отдельное подключение. [Условия Artificial Analysis](https://artificialanalysiscdn.com/legal/ProDataPlatformTerms.pdf)

## Как устроено

- `scripts/build_data.py` — скачивает источники в `data/cache/*.json` (если источник не ответил, остаётся вчерашний кэш)
  и сводит их в `site/data/models.json`; снимок мест пишет в `site/data/history.json` (для стрелок ▲▼).
- `config/aliases.json` — ручные пары названий, если модели из разных источников не сошлись сами.
- В период «Вышли за» входят подтверждённые релизы. Первое наблюдение в Arena, дата версии в названии и день добавления в OpenRouter хранятся в отдельных полях.
- Фактическая цена проверки ЕГЭ появляется после измерения расходов на том же наборе работ. Калькулятор базовых токенов и стоимость средней задачи индекса AA отвечают на другие вопросы.
- `site/` — статический сайт без сборки (HTML, CSS, JS), шрифты свои (как на fizmat.guru).
- `.github/workflows/update.yml` — каждый день в 09:05 МСК пересобирает данные и коммитит их.

## Локально

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/build_data.py          # скачать и свести
.venv/bin/python scripts/build_data.py --offline # только свести из кэша
python3 -m http.server -d site 4330             # http://localhost:4330
```

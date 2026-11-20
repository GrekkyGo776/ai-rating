# Рейтинг нейросетей · ai.fizmat.guru

Публичный сайт: какая модель ИИ сильнее по тестам, какую выбирают люди вслепую и сколько она стоит.
Только открытые данные, обновление каждый день.

## Источники

| Источник | Что берём | Лицензия |
|---|---|---|
| [Arena leaderboard dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) | Elo по разделам: общий, русский, математика, код, творческие тексты, сложные запросы, веб-разработка, зрение | CC BY 4.0 |
| [Epoch AI](https://epoch.ai/benchmarks) | индекс возможностей ECI, дата выхода, открытые веса, страна | CC BY 4.0 |
| [OpenRouter](https://openrouter.ai/models) | цены за 1 млн токенов, контекст | публичный API |

Данные Artificial Analysis здесь **не используются**: их бесплатный API разрешает только личное использование
(Data Platform Terms v1.1, §2.3–2.5), а открытый рейтинг на их данных запрещён без письменного согласия.

## Как устроено

- `scripts/build_data.py` — скачивает источники в `data/cache/*.json` (если источник не ответил, остаётся вчерашний кэш)
  и сводит их в `site/data/models.json`; снимок мест пишет в `site/data/history.json` (для стрелок ▲▼).
- `config/aliases.json` — ручные пары названий, если модели из разных источников не сошлись сами.
- `site/` — статический сайт без сборки (HTML, CSS, JS), шрифты свои (как на fizmat.guru).
- `.github/workflows/update.yml` — каждый день в 09:05 МСК пересобирает данные и коммитит их.

## Локально

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/build_data.py          # скачать и свести
.venv/bin/python scripts/build_data.py --offline # только свести из кэша
python3 -m http.server -d site 4330             # http://localhost:4330
```

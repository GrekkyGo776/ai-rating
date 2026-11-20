#!/usr/bin/env bash
# Настройка ai.fizmat.guru на Selectel VDS (135.106.164.135). Запуск с мака:
#   /Users/gregory/ai-rating/deploy/setup-vds.sh
# 1. Клонирует публичный репозиторий в /var/www/ai-rating (или обновляет).
# 2. Ставит cron: раз в час git pull — так на сайт приходят данные, которые каждое утро собирает GitHub Actions.
# 3. Блок Caddy (deploy/caddy-ai-rating.conf) ставит служба ai-rating-caddy-wait: она ждёт, пока 10 минут подряд
#    не будет уроков и учеников на досках (проверка Fizmat Hero: /opt/tetrad/scripts/deploy-guard.ts check),
#    и только тогда делает reload — reload Caddy на секунду рвёт соединения досок. Ждёт до 12 часов, итог — в Telegram.
#    Что происходит: ssh … journalctl -u ai-rating-caddy-wait -f
set -euo pipefail
HOST=root@135.106.164.135
KEY=~/.ssh/tetrad_selectel_ed25519
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
scp -q -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$ROOT/deploy/caddy-ai-rating.conf" "$ROOT/deploy/caddy-wait.sh" "$HOST:/tmp/"
"${SSH[@]}" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
if [ -d /var/www/ai-rating/.git ]; then
  git -C /var/www/ai-rating pull --ff-only -q
else
  git clone -q https://github.com/GrekkyGo776/ai-rating.git /var/www/ai-rating
fi
echo "17 * * * * root git -C /var/www/ai-rating pull --ff-only -q >/var/log/ai-rating-pull.log 2>&1" > /etc/cron.d/ai-rating
install -m 0644 /tmp/caddy-ai-rating.conf /etc/caddy/ai-rating.conf
install -m 0755 /tmp/caddy-wait.sh /usr/local/sbin/ai-rating-caddy-wait
rm -f /tmp/caddy-ai-rating.conf /tmp/caddy-wait.sh
if grep -q '# >>> ai-rating' /etc/caddy/Caddyfile; then
  echo "✓ Блок Caddy уже стоит — перезагрузка не нужна"
else
  systemctl reset-failed ai-rating-caddy-wait >/dev/null 2>&1 || true
  systemd-run --quiet --collect --unit=ai-rating-caddy-wait --description="ai.fizmat.guru: включить в Caddy, когда никого нет" \
    /usr/local/sbin/ai-rating-caddy-wait
  echo "✓ Служба ai-rating-caddy-wait ждёт тихого окна (journalctl -u ai-rating-caddy-wait -f)"
fi
REMOTE

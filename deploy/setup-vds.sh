#!/usr/bin/env bash
# Разовая настройка ai.fizmat.guru на Selectel VDS (135.106.164.135). Запускать с мака:
#   /Users/gregory/ai-rating/deploy/setup-vds.sh
# Что делает:
#   1. клонирует публичный репозиторий в /var/www/ai-rating (или обновляет его);
#   2. ставит cron: раз в час git pull — так на сайт попадают данные, которые
#      каждое утро собирает GitHub Actions;
#   3. добавляет в Caddy блок ai.fizmat.guru между метками и делает мягкий reload
#      (без перезапуска: Fizmat Hero и другие сайты не прерываются).
# Перед запуском: проверить, что сейчас нет урока. Тестовый адрес работает сразу,
# ai.fizmat.guru — после DNS-записи A ai → 135.106.164.135 в Porkbun.
set -euo pipefail
HOST=root@135.106.164.135
KEY=~/.ssh/tetrad_selectel_ed25519
REPO=https://github.com/GrekkyGo776/ai-rating.git

ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$HOST" bash -s <<REMOTE
set -euo pipefail
if [ -d /var/www/ai-rating/.git ]; then
  git -C /var/www/ai-rating pull --ff-only -q
else
  git clone -q --depth 50 $REPO /var/www/ai-rating
fi
cat > /etc/cron.d/ai-rating <<'CRON'
17 * * * * root git -C /var/www/ai-rating pull --ff-only -q >/var/log/ai-rating-pull.log 2>&1
CRON
CF=/etc/caddy/Caddyfile
if ! grep -q '# >>> ai-rating' \$CF; then
  backup=\$CF.bak-ai-rating-\$(date +%F-%H%M)
  cp \$CF \$backup
  cat >> \$CF <<'CADDY'

# >>> ai-rating
ai.fizmat.guru, ai-rating.135-106-164-135.sslip.io {
	root * /var/www/ai-rating/site
	encode zstd gzip
	@data path /data/*
	header @data Cache-Control "no-cache"
	@fonts path /assets/fonts/*
	header @fonts Cache-Control "public, max-age=2592000, immutable"
	@code path /assets/css/* /assets/js/*
	header @code Cache-Control "public, max-age=3600"
	file_server
}
# <<< ai-rating
CADDY
  # проверка с теми же переменными, что у службы caddy; при ошибке — откат
  envs=\$(systemctl show caddy -p EnvironmentFiles --value | grep -o '/[^ ]*' || true)
  if ! ( set -a; for f in \$envs; do [ -r "\$f" ] && . "\$f"; done; set +a
         caddy validate --config \$CF --adapter caddyfile >/tmp/caddy-validate.log 2>&1 ); then
    tail -3 /tmp/caddy-validate.log
    cat \$backup > \$CF
    echo "✗ Caddy не принял конфигурацию — вернул прежнюю"; exit 1
  fi
  systemctl reload caddy
fi
echo "готово: https://ai-rating.135-106-164-135.sslip.io (и https://ai.fizmat.guru после DNS)"
REMOTE

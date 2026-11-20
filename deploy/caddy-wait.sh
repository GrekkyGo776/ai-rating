#!/usr/bin/env bash
# Живёт на сервере (/usr/local/sbin/ai-rating-caddy-wait), запускается службой ai-rating-caddy-wait.
# Ждёт, пока 10 минут подряд никто не занимается в Fizmat Hero, потом добавляет блок ai-rating в Caddyfile,
# проверяет конфигурацию (при ошибке — откат) и делает reload. Итог — в Telegram через deploy-guard.ts notify.
# FORCE=1 — не ждать тишины (только по прямому слову Григория: reload на секунду рвёт соединения досок).
set -uo pipefail
CF=/etc/caddy/Caddyfile
BLOCK=/etc/caddy/ai-rating.conf
QUIET_SEC=${QUIET_SEC:-600}; [ "${FORCE:-}" = 1 ] && QUIET_SEC=0; POLL_SEC=${POLL_SEC:-30}; MAX_WAIT_SEC=${MAX_WAIT_SEC:-43200}
guard() { (cd /opt/tetrad && node --import tsx scripts/deploy-guard.ts "$@"); }
notify() { echo "→ $1"; guard notify "$1" >/dev/null 2>&1 || echo "⚠ в Telegram не ушло"; }
started=$(date +%s); quiet_since=""
while :; do
  now=$(date +%s)
  if grep -q '# >>> ai-rating' "$CF"; then echo "Блок уже стоит"; exit 0; fi
  if [ "${FORCE:-}" = 1 ] || guard check >/dev/null 2>&1; then
    [ -z "$quiet_since" ] && { quiet_since=$now; echo "$(TZ=Europe/Moscow date +%H:%M) никого нет — жду ещё $((QUIET_SEC/60)) мин"; }
    if [ $((now - quiet_since)) -ge "$QUIET_SEC" ]; then break; fi
  else
    [ -n "$quiet_since" ] && echo "$(TZ=Europe/Moscow date +%H:%M) снова занимаются — жду дальше"
    quiet_since=""
  fi
  if [ $((now - started)) -ge "$MAX_WAIT_SEC" ]; then
    notify "⏸ ai.fizmat.guru не включил: 12 часов не было тихого окна. Запусти deploy/setup-vds.sh ещё раз."
    exit 1
  fi
  sleep "$POLL_SEC"
done
backup="$CF.bak-ai-rating-$(date +%F-%H%M)"
cp "$CF" "$backup"
{ printf '\n'; cat "$BLOCK"; } >> "$CF"
envs=$(systemctl show caddy -p EnvironmentFiles --value | grep -o '/[^ ]*' || true)
if ! ( set -a; for f in $envs; do [ -r "$f" ] && . "$f"; done; set +a
       caddy validate --config "$CF" --adapter caddyfile >/tmp/ai-rating-validate.log 2>&1 ); then
  cat "$backup" > "$CF"
  notify "✗ ai.fizmat.guru: Caddy не принял блок, вернул прежний Caddyfile. $(tail -1 /tmp/ai-rating-validate.log)"
  exit 1
fi
systemctl reload caddy
notify "✓ Сайт «Рейтинг нейросетей» включён в $(TZ=Europe/Moscow date +%H:%M): https://ai.fizmat.guru (пока DNS не готов — https://ai-rating.135-106-164-135.sslip.io)"

#!/usr/bin/env bash
set -euo pipefail
cd /opt/visao-cidadao
# Recusa sobrescrever alterações que surgiram depois da auditoria.
printf '%s\n' '0c6d2f441e00af04860086b72454d32cd009cd3f15369c002cdf911180e06db9  index.js' 'fff5d80bfbed075b0b05ad267c4e1e5d0e2f5d480fe1213b4536a566e845d2b0  painel.html' | sha256sum --check
node --check releases/auditoria-20260918/index.js
backup="/opt/visao-cidadao/backups/auditoria-20260918-$(date +%H%M%S)"
install -d -m 700 "$backup"
for arquivo in index.js painel.html agendamentos.json historicos.json contatos.json pausados.json propostas-agendamento.json lista-espera-novo-progresso.json lista-espera-retornos.json controle-ia.json; do
  if [ -f "$arquivo" ]; then cp -p -- "$arquivo" "$backup/"; fi
done
install -m 600 releases/auditoria-20260918/index.js index.js
install -m 600 releases/auditoria-20260918/painel.html painel.html
node --check index.js
pm2 restart visao-cidadao --time >/dev/null
printf 'Publicado. Backup: %s\n' "$backup"
sha256sum index.js painel.html

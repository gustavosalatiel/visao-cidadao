#!/usr/bin/env bash
# Deploy do bot de agendamento (Visao Cidadao) na VPS.
# Faz backup antes, confere a sintaxe no servidor e so reinicia se tudo deu certo.
# Uso: bash deploy-vps.sh
set -euo pipefail

CHAVE="$HOME/.ssh/id_ed25519"
ALVO="root@72.61.134.7"
LOCAL="$(cd "$(dirname "$0")" && pwd)"
SSH="ssh -i $CHAVE -o ConnectTimeout=20 $ALVO"

echo "==> 0/6  rodando os testes locais antes de subir"
( cd "$LOCAL" && npm test >/dev/null 2>&1 ) || { echo "!! teste falhou, nada foi enviado"; exit 1; }
echo "    testes ok"

echo "==> 1/6  procurando a pasta deste bot na VPS"
# A VPS hospeda mais de um bot: o certo e o que tem Bela Vista do Caracol no config.
REMOTO=$($SSH 'for d in /root/*/ /root /opt/*/ /home/*/*/ ; do [ -f "$d/index.js" ] && [ -f "$d/config.js" ] && grep -q "Bela Vista do Caracol" "$d/config.js" 2>/dev/null && echo "${d%/}" && break; done' | head -1)
if [ -z "$REMOTO" ]; then
  echo "!! nao achei a pasta com Bela Vista do Caracol no config.js."
  echo "   Liste as pastas com:  ssh -i $CHAVE $ALVO \"ls -la /root /opt /home\""
  exit 1
fi
echo "    pasta: $REMOTO"

echo "==> 2/6  conferindo se o restart apaga a sessao do WhatsApp"
if $SSH "grep -qs 'LIMPAR_AUTH=1' $REMOTO/.env" ; then
  echo "!! LIMPAR_AUTH=1 esta no .env da VPS: reiniciar apaga a sessao e o bot"
  echo "   vai pedir pareamento de novo. Tire essa linha antes de continuar."
  exit 1
fi
echo "    ok, sessao preservada"

echo "==> 3/6  backup do que esta rodando hoje"
CARIMBO=$(date +%Y%m%d-%H%M%S)
$SSH "mkdir -p $REMOTO/backup-$CARIMBO && cp $REMOTO/index.js $REMOTO/config.js $REMOTO/painel.html $REMOTO/backup-$CARIMBO/ 2>/dev/null || cp $REMOTO/index.js $REMOTO/config.js $REMOTO/backup-$CARIMBO/"
echo "    backup em $REMOTO/backup-$CARIMBO"

echo "==> 4/6  enviando index.js, config.js e painel.html"
scp -i "$CHAVE" "$LOCAL/index.js" "$LOCAL/config.js" "$LOCAL/painel.html" "$ALVO:$REMOTO/"

echo "==> 5/6  conferindo a sintaxe no servidor"
$SSH "cd $REMOTO && node --check index.js && node --check config.js"
echo "    sintaxe valida"

echo "==> 6/6  reiniciando o bot"
if $SSH "command -v pm2 >/dev/null && pm2 describe visao-cidadao >/dev/null 2>&1"; then
  $SSH "pm2 restart visao-cidadao && pm2 describe visao-cidadao"
else
  $SSH "systemctl restart visao-cidadao"
fi

echo
echo "Pronto. Para voltar atras:"
echo "  ssh -i $CHAVE $ALVO \"cp $REMOTO/backup-$CARIMBO/* $REMOTO/ && pm2 restart visao-cidadao\""

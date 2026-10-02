#!/usr/bin/env bash
# Deploy do bot 1 (Visao Cidadao: Placas, lista reserva) na VPS.
# Faz backup antes, confere a sintaxe no servidor e so reinicia se tudo deu certo.
# Uso: bash deploy-vps.sh
#
# A VPS (desde 01/10/2026) hospeda 3 bots:
#   /opt/visao-cidadao    pm2 visao-cidadao    porta 8080  <- este deploy
#   /opt/visao-cidadao-2  clinica              porta 8081  (nunca mexer)
#   /opt/visao-cidadao-3                       porta 8082  (nunca mexer)
set -euo pipefail

CHAVE="$HOME/.ssh/id_ed25519"
ALVO="root@179.236.233.9"
REMOTO="/opt/visao-cidadao"
PROCESSO="visao-cidadao"
PORTA=8080
LOCAL="$(cd "$(dirname "$0")" && pwd)"
SSH="ssh -i $CHAVE -o ConnectTimeout=20 $ALVO"

echo "==> 0/7  rodando os testes locais antes de subir"
( cd "$LOCAL" && npm test >/dev/null 2>&1 ) || { echo "!! teste falhou, nada foi enviado"; exit 1; }
echo "    testes ok"

echo "==> 1/7  conferindo que $PROCESSO roda de $REMOTO"
# Pasta fixa: com 3 bots na mesma VPS, procurar a pasta poderia subir o codigo no bot errado.
CWD=$($SSH "pm2 jlist" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s.slice(s.indexOf("["))).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.pm_cwd:"")})' "$PROCESSO")
if [ "${CWD%/}" != "$REMOTO" ]; then
  echo "!! o processo $PROCESSO roda de '${CWD:-nao encontrado}', esperado $REMOTO. Nada foi enviado."
  exit 1
fi
echo "    ok"

echo "==> 2/7  conferindo se o restart apaga a sessao do WhatsApp"
if $SSH "grep -qs 'LIMPAR_AUTH=1' $REMOTO/.env" ; then
  echo "!! LIMPAR_AUTH=1 esta no .env da VPS: reiniciar apaga a sessao e o bot"
  echo "   vai pedir pareamento de novo. Tire essa linha antes de continuar."
  exit 1
fi
echo "    ok, sessao preservada"

echo "==> 3/7  conferindo se alguem editou o codigo direto no servidor"
# O servidor deve ter exatamente o que foi commitado. Se diferir, alguem mexeu la:
# para nao apagar essa mudanca, o deploy para. FORCAR=1 ignora esta checagem.
for arq in index.js config.js painel.html; do
  LOCAL_HASH=$(cd "$LOCAL" && git show "HEAD:$arq" | sha256sum | cut -d' ' -f1)
  REMOTO_HASH=$($SSH "sha256sum $REMOTO/$arq 2>/dev/null | cut -d' ' -f1")
  if [ "$LOCAL_HASH" != "$REMOTO_HASH" ] && [ "${FORCAR:-0}" != "1" ]; then
    echo "!! $arq no servidor difere do ultimo commit. Confira antes (ou rode com FORCAR=1)."
    exit 1
  fi
done
echo "    ok"

echo "==> 4/7  backup do que esta rodando hoje"
CARIMBO=$(date +%Y%m%d-%H%M%S)
$SSH "mkdir -p $REMOTO/backup-$CARIMBO && cp $REMOTO/index.js $REMOTO/config.js $REMOTO/painel.html $REMOTO/backup-$CARIMBO/"
echo "    backup em $REMOTO/backup-$CARIMBO"

echo "==> 5/7  enviando index.js, config.js e painel.html"
scp -i "$CHAVE" "$LOCAL/index.js" "$LOCAL/config.js" "$LOCAL/painel.html" "$ALVO:$REMOTO/"

echo "==> 6/7  conferindo a sintaxe no servidor"
if ! $SSH "cd $REMOTO && node --check index.js && node --check config.js"; then
  echo "!! sintaxe invalida no servidor: restaurando o backup, bot NAO foi reiniciado"
  $SSH "cp $REMOTO/backup-$CARIMBO/* $REMOTO/"
  exit 1
fi
echo "    sintaxe valida"

echo "==> 7/7  reiniciando SOMENTE o $PROCESSO"
$SSH "pm2 restart $PROCESSO --update-env >/dev/null && pm2 save >/dev/null"
sleep 20
$SSH "pm2 jlist" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s.slice(s.indexOf("["))))console.log("    "+p.name+": "+p.pm2_env.status+" (reinicios: "+p.pm2_env.restart_time+")")})'
CODIGO=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORTA/" || true)
echo "    painel na porta $PORTA respondeu HTTP $CODIGO"

echo
echo "Pronto. Para voltar atras:"
echo "  ssh -i $CHAVE $ALVO \"cp $REMOTO/backup-$CARIMBO/* $REMOTO/ && pm2 restart $PROCESSO --update-env\""

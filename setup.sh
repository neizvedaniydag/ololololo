#!/bin/bash
set -e

C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_BLUE='\033[0;34m'
C_YELLOW='\033[1;33m'

function echoc {
    echo -e "${2}${1}${C_RESET}"
}

function error_exit {
    echoc "ОШИБКА: ${1}" $C_RED
    exit 1
}

clear
echoc "=================================================================" $C_BLUE
echoc " ГАРАНТИРОВАННАЯ УСТАНОВКА (NGINX ВСЕГДА ЗАПУЩЕН) " $C_YELLOW
echoc "=================================================================" $C_BLUE
echo

# ============ ШАГ 0-9: УСТАНОВКА И НАСТРОЙКА ============
echoc "0-9. Подготовка системы..." $C_BLUE
sudo apt update -qq
sudo apt install -y curl git dnsutils openssl ca-certificates 2>&1 | tail -2

if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh 2>&1 | tail -3
    rm get-docker.sh
    sudo systemctl start docker
    sudo systemctl enable docker
fi

DC="docker compose"
if ! docker compose version &> /dev/null 2>&1; then
    sudo mkdir -p /usr/local/lib/docker/cli-plugins/
    sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose 2>&1 | tail -1
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

sudo systemctl stop nginx apache2 2>/dev/null || true
sudo systemctl disable nginx apache2 2>/dev/null || true

if command -v ufw &> /dev/null && sudo ufw status | grep -q "active"; then
    sudo ufw allow 80/tcp 443/tcp 2>/dev/null || true
fi

$DC down --remove-orphans 2>/dev/null || true
docker system prune -f 2>/dev/null || true

if [ -f "docker-compose.yml" ]; then
    sed -i '/^version:/d' docker-compose.yml 2>/dev/null || true
    if ! grep -q "restart: always" docker-compose.yml; then
        sed -i '/  web:/a\    restart: always' docker-compose.yml
        sed -i '/  nginx:/a\    restart: always' docker-compose.yml
    fi
fi

echoc "   ✓ Система готова" $C_GREEN
echo

# ============ ШАГ 10: СБОР ДАННЫХ ============
echoc "10. Сбор данных..." $C_BLUE
read -p "   Домен: " DOMAIN
[ -z "$DOMAIN" ] && error_exit "Домен пустой"
read -p "   Email: " EMAIL
[ -z "$EMAIL" ] && error_exit "Email пустой"
read -p "   API-ключ GigaChat: " GIGACHAT_CREDENTIALS
[ -z "$GIGACHAT_CREDENTIALS" ] && error_exit "API-ключ пустой"
echoc "   ✓ Данные собраны" $C_GREEN
echo

# ============ ШАГ 11: КОНФИГУРАЦИЯ ============
echoc "11. Создание конфигурации..." $C_BLUE
SECRET_KEY=$(openssl rand -hex 32)
cat > .env <<EOL
FLASK_SECRET_KEY=${SECRET_KEY}
GIGACHAT_CREDENTIALS=${GIGACHAT_CREDENTIALS}
FLASK_APP=app.py
EOL
sed -i 's/[[:space:]]*$//' .env

mkdir -p nginx
cat > nginx/production.conf <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    location /static {
        alias /app/static;
        expires 7d;
    }
    
    location / {
        proxy_pass http://web:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

if [ -f "education_platform/education_platform/app.py" ]; then
    sed -i "s|'sqlite:///instance/education_platform.db'|'sqlite:////app/instance/education_platform.db'|g" education_platform/education_platform/app.py
    sed -i "s|\"sqlite:///instance/education_platform.db\"|\"sqlite:////app/instance/education_platform.db\"|g" education_platform/education_platform/app.py
fi
echoc "   ✓ Конфигурация готова" $C_GREEN
echo

# ============ ШАГ 12: ЗАПУСК (HTTP) ============
echoc "12. Запуск сервисов..." $C_BLUE
$DC up -d --build --remove-orphans 2>&1 | grep -E "Started|Created" || true
sleep 5

if $DC ps | grep web | grep -q "Up" && $DC ps | grep nginx | grep -q "Up"; then
    echoc "   ✓ Сайт работает: http://${DOMAIN}" $C_GREEN
else
    echoc "   ⚠ Проблема запуска!" $C_RED
    $DC ps
    error_exit "Контейнеры не запустились"
fi
echo

# ============ ШАГ 13: SSL (С ГАРАНТИЕЙ ВОЗВРАТА NGINX) ============
echoc "13. Попытка получить SSL..." $C_BLUE
echoc "   → Остановка nginx..." $C_YELLOW
$DC stop nginx

SSL_SUCCESS=false

# ВАЖНО: Запускаем certbot с timeout и в фоне
echoc "   → Запрос SSL (максимум 60 секунд)..." $C_YELLOW
timeout 60 $DC run --rm -p 80:80 --entrypoint "\
  certbot certonly --standalone \
    --email $EMAIL \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --agree-tos \
    --non-interactive \
    --force-renewal" certbot > /tmp/certbot.log 2>&1 && SSL_OUTPUT=$(cat /tmp/certbot.log) || SSL_OUTPUT=$(cat /tmp/certbot.log)

# ГАРАНТИЯ: Убиваем certbot если он еще жив
docker kill $(docker ps -q --filter "ancestor=certbot/certbot") 2>/dev/null || true

# ГАРАНТИЯ: ВСЕГДА запускаем nginx обратно
echoc "   → ЗАПУСК NGINX (в любом случае)..." $C_YELLOW
$DC start nginx
sleep 3

# Проверка SSL
if echo "$SSL_OUTPUT" | grep -q "Successfully received certificate"; then
    echoc "   ✓ SSL получен!" $C_GREEN
    
    if docker run --rm -v ololololo_certbot_certs:/certs alpine ls /certs/live/${DOMAIN}/fullchain.pem 2>/dev/null; then
        cat > nginx/production.conf <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location /static {
        alias /app/static;
        expires 7d;
    }
    location / {
        proxy_pass http://web:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
        $DC restart nginx
        SSL_SUCCESS=true
    fi
elif echo "$SSL_OUTPUT" | grep -q "too many certificates"; then
    echoc "   ⚠ Лимит Let's Encrypt (5/неделя)" $C_RED
    echoc "   → Работаем по HTTP" $C_YELLOW
else
    echoc "   ⚠ SSL не получен" $C_YELLOW
fi

# ФИНАЛЬНАЯ ПРОВЕРКА NGINX
if ! $DC ps | grep nginx | grep -q "Up"; then
    echoc "   ⚠ Nginx упал! Перезапускаем..." $C_RED
    $DC restart nginx
    sleep 2
fi
echo

# ============ ШАГ 14: ПРОВЕРКА ============
echoc "14. Финальная проверка..." $C_BLUE
$DC ps
echo

KEY_CHECK=$($DC exec web sh -c 'echo $GIGACHAT_CREDENTIALS' 2>/dev/null | head -c 20)
[ ! -z "$KEY_CHECK" ] && echoc "   ✓ API ключ OK" $C_GREEN
echo

# ============ ШАГ 15: CRON ============
echoc "15. Автозапуск..." $C_BLUE
CRON1="*/5 * * * * cd $(pwd) && docker compose ps | grep -q 'Up' || docker compose up -d >> /var/log/docker-check.log 2>&1"
(crontab -l 2>/dev/null | grep -v "docker-check"; echo "$CRON1") | crontab -
echoc "   ✓ Настроен" $C_GREEN
echo

# ============ ЗАВЕРШЕНИЕ ============
echoc "=================================================================" $C_BLUE
echoc " ✓✓✓ САЙТ РАБОТАЕТ! ✓✓✓ " $C_GREEN
echoc "=================================================================" $C_BLUE
echo

if [ "$SSL_SUCCESS" = true ]; then
    echoc "🌐 Сайт: https://${DOMAIN}" $C_GREEN
else
    echoc "🌐 Сайт: http://${DOMAIN}" $C_YELLOW
    echoc "💡 Для HTTPS: Cloudflare или подождите 24ч" $C_RESET
fi

echoc "🔄 Автозапуск: ВКЛ" $C_GREEN
echo

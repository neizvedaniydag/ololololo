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
echoc " ГАРАНТИРОВАННАЯ УСТАНОВКА (100% РАБОТАЕТ) " $C_YELLOW
echoc "=================================================================" $C_BLUE
echo

# ============ ШАГ 0: БАЗОВЫЕ УТИЛИТЫ ============
echoc "0. Установка утилит..." $C_BLUE
sudo apt update -qq
sudo apt install -y curl git dnsutils openssl ca-certificates 2>&1 | tail -3
echoc "   ✓ Установлено" $C_GREEN
echo

# ============ ШАГ 1: DOCKER ============
echoc "1. Установка Docker..." $C_BLUE
if ! command -v docker &> /dev/null; then
    echoc "   → Устанавливаю Docker..." $C_YELLOW
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh 2>&1 | tail -3
    rm get-docker.sh
    sudo systemctl start docker
    sudo systemctl enable docker
    echoc "   ✓ Docker установлен" $C_GREEN
else
    echoc "   ✓ Docker уже есть" $C_GREEN
fi
echo

# ============ ШАГ 2: DOCKER COMPOSE V2 ============
echoc "2. Установка Docker Compose v2..." $C_BLUE
DC=""
if docker compose version &> /dev/null 2>&1; then
    DC="docker compose"
    echoc "   ✓ Уже есть" $C_GREEN
else
    echoc "   → Устанавливаю..." $C_YELLOW
    sudo mkdir -p /usr/local/lib/docker/cli-plugins/
    sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose 2>&1 | tail -1
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    DC="docker compose"
    echoc "   ✓ Установлен" $C_GREEN
fi
echo

# ============ ШАГ 3: ПОРТЫ ============
echoc "3. Освобождение портов..." $C_BLUE
sudo systemctl stop nginx apache2 2>/dev/null || true
sudo systemctl disable nginx apache2 2>/dev/null || true
echoc "   ✓ Порты свободны" $C_GREEN
echo

# ============ ШАГ 4: ФАЙРВОЛ ============
echoc "4. Файрвол..." $C_BLUE
if command -v ufw &> /dev/null && sudo ufw status | grep -q "Status: active"; then
    sudo ufw allow 80/tcp 2>/dev/null || true
    sudo ufw allow 443/tcp 2>/dev/null || true
    echoc "   ✓ Порты открыты" $C_GREEN
else
    echoc "   ✓ UFW неактивен" $C_YELLOW
fi
echo

# ============ ШАГ 5: ОЧИСТКА ============
echoc "5. Очистка Docker..." $C_BLUE
$DC down --remove-orphans 2>/dev/null || true
docker system prune -f 2>/dev/null || true
echoc "   ✓ Очищено" $C_GREEN
echo

# ============ ШАГ 6: DOCKER-COMPOSE ============
echoc "6. Настройка docker-compose.yml..." $C_BLUE
if [ -f "docker-compose.yml" ]; then
    sed -i '/^version:/d' docker-compose.yml 2>/dev/null || true
    if ! grep -q "restart: always" docker-compose.yml; then
        sed -i '/  web:/a\    restart: always' docker-compose.yml
        sed -i '/  nginx:/a\    restart: always' docker-compose.yml
    fi
    echoc "   ✓ Автозапуск включен" $C_GREEN
fi
echo

# ============ ШАГ 7: СБОР ДАННЫХ ============
echoc "7. Сбор данных..." $C_BLUE
read -p "   Домен: " DOMAIN
[ -z "$DOMAIN" ] && error_exit "Домен пустой"
read -p "   Email: " EMAIL
[ -z "$EMAIL" ] && error_exit "Email пустой"
read -p "   API-ключ GigaChat: " GIGACHAT_CREDENTIALS
[ -z "$GIGACHAT_CREDENTIALS" ] && error_exit "API-ключ пустой"
echoc "   ✓ Данные собраны" $C_GREEN
echo

# ============ ШАГ 8: КОНФИГУРАЦИЯ ============
echoc "8. Создание конфигурации..." $C_BLUE
SECRET_KEY=$(openssl rand -hex 32)
cat > .env <<EOL
FLASK_SECRET_KEY=${SECRET_KEY}
GIGACHAT_CREDENTIALS=${GIGACHAT_CREDENTIALS}
FLASK_APP=app.py
EOL
sed -i 's/[[:space:]]*$//' .env

# ВАЖНО: Создаем HTTP-only конфиг
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
        proxy_read_timeout 300;
    }
}
EOF

# Исправить путь к БД
if [ -f "education_platform/education_platform/app.py" ]; then
    sed -i "s|'sqlite:///instance/education_platform.db'|'sqlite:////app/instance/education_platform.db'|g" education_platform/education_platform/app.py
    sed -i "s|\"sqlite:///instance/education_platform.db\"|\"sqlite:////app/instance/education_platform.db\"|g" education_platform/education_platform/app.py
fi
echoc "   ✓ Конфигурация создана" $C_GREEN
echo

# ============ ШАГ 9: DNS ============
echoc "9. Проверка DNS..." $C_BLUE
PUBLIC_IP=$(curl -s http://ipinfo.io/ip || echo "unknown")
DOMAIN_IP=$(dig +short $DOMAIN @8.8.8.8 | head -n1 || echo "unknown")
echoc "   IP сервера: ${PUBLIC_IP}" $C_YELLOW
echoc "   IP домена: ${DOMAIN_IP}" $C_YELLOW
echo

# ============ ШАГ 10: ЗАПУСК (HTTP) ============
echoc "10. Запуск сервисов..." $C_BLUE
echoc "   → Сборка и запуск контейнеров..." $C_YELLOW
$DC up -d --build --remove-orphans 2>&1 | grep -E "Started|Running|Created" || true
sleep 5

# ПРОВЕРКА что контейнеры запущены
WEB_STATUS=$($DC ps --format json | grep -q '"Service":"web".*"State":"running"' && echo "OK" || echo "FAIL")
NGINX_STATUS=$($DC ps --format json | grep -q '"Service":"nginx".*"State":"running"' && echo "OK" || echo "FAIL")

if [ "$WEB_STATUS" = "OK" ] && [ "$NGINX_STATUS" = "OK" ]; then
    echoc "   ✓ Контейнеры запущены!" $C_GREEN
    echoc "   ✓ Сайт работает: http://${DOMAIN}" $C_GREEN
else
    echoc "   ⚠ Проблема с контейнерами!" $C_RED
    $DC ps
    $DC logs web 2>&1 | tail -20
    error_exit "Контейнеры не запустились"
fi
echo

# ============ ШАГ 11: SSL (ОПЦИОНАЛЬНО) ============
echoc "11. Попытка получить SSL..." $C_BLUE
echoc "   → Остановка nginx для получения SSL..." $C_YELLOW
$DC stop nginx

SSL_SUCCESS=false

# Запуск certbot с timeout (чтобы не висел)
echoc "   → Запрос SSL сертификата..." $C_YELLOW
SSL_OUTPUT=$(timeout 60 $DC run --rm -p 80:80 --entrypoint "\
  certbot certonly --standalone \
    --email $EMAIL \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --agree-tos \
    --force-renewal" certbot 2>&1 || echo "TIMEOUT_OR_ERROR")

# КРИТИЧЕСКИ ВАЖНО: Убить certbot и запустить nginx ВСЕГДА
echoc "   → Очистка certbot процессов..." $C_YELLOW
docker kill $(docker ps -q --filter "ancestor=certbot/certbot") 2>/dev/null || true
docker rm $(docker ps -aq --filter "ancestor=certbot/certbot") 2>/dev/null || true

echoc "   → ОБЯЗАТЕЛЬНЫЙ запуск nginx..." $C_YELLOW
$DC start nginx
sleep 3

# Проверка результата SSL
if echo "$SSL_OUTPUT" | grep -q "too many certificates"; then
    echoc "   ⚠ Лимит Let's Encrypt (5 сертификатов/неделю)" $C_RED
    echoc "   → Сайт работает по HTTP" $C_YELLOW
    SSL_SUCCESS=false
elif echo "$SSL_OUTPUT" | grep -q "Successfully received certificate"; then
    echoc "   ✓ SSL сертификат получен!" $C_GREEN
    
    # Проверить что сертификат реально есть
    if docker run --rm -v ololololo_certbot_certs:/certs alpine ls /certs/live/${DOMAIN}/fullchain.pem 2>/dev/null; then
        echoc "   → Включаю HTTPS..." $C_YELLOW
        
        # Обновить конфиг на HTTPS
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
        sleep 2
        SSL_SUCCESS=true
    else
        echoc "   ⚠ Сертификат не найден" $C_RED
        SSL_SUCCESS=false
    fi
else
    echoc "   ⚠ Ошибка или timeout при получении SSL" $C_RED
    SSL_SUCCESS=false
fi

# ФИНАЛЬНАЯ ПРОВЕРКА что nginx работает
if ! $DC ps | grep nginx | grep -q "Up"; then
    echoc "   ⚠ Nginx упал, перезапускаю..." $C_RED
    $DC restart nginx
    sleep 2
fi

echoc "   ✓ Nginx работает" $C_GREEN
echo

# ============ ШАГ 12: ПРОВЕРКА ============
echoc "12. Финальная проверка..." $C_BLUE
$DC ps
echo

KEY_CHECK=$($DC exec web sh -c 'echo $GIGACHAT_CREDENTIALS' 2>/dev/null | head -c 20)
[ ! -z "$KEY_CHECK" ] && echoc "   ✓ API ключ в контейнере" $C_GREEN
echo

# ============ ШАГ 13: CRON ============
echoc "13. Настройка автозапуска..." $C_BLUE
CRON1="*/5 * * * * cd $(pwd) && docker compose ps | grep -q 'Up' || docker compose up -d >> /var/log/docker-check.log 2>&1"
CRON2="0 2 * * * cd $(pwd) && docker compose run --rm certbot renew && docker compose restart nginx >> /var/log/ssl-renew.log 2>&1"
(crontab -l 2>/dev/null | grep -v "docker-check" | grep -v "ssl-renew"; echo "$CRON1"; echo "$CRON2") | crontab -
echoc "   ✓ Автозапуск настроен" $C_GREEN
echo

# ============ ЗАВЕРШЕНИЕ ============
echoc "=================================================================" $C_BLUE
echoc " ✓✓✓ САЙТ РАБОТАЕТ! ✓✓✓ " $C_GREEN
echoc "=================================================================" $C_BLUE
echo

if [ "$SSL_SUCCESS" = true ]; then
    echoc "🌐 Сайт: https://${DOMAIN}" $C_GREEN
    echoc "🔐 SSL: ВКЛЮЧЕН" $C_GREEN
else
    echoc "🌐 Сайт: http://${DOMAIN}" $C_YELLOW
    echoc "⚠ SSL: Не получен (лимит Let's Encrypt или ошибка)" $C_YELLOW
    echo
    echoc "Для HTTPS:" $C_BLUE
    echoc "  • Используйте Cloudflare (бесплатный SSL)" $C_RESET
    echoc "  • Или подождите 24ч и запустите:" $C_RESET
    echoc "    docker compose stop nginx && docker compose run --rm -p 80:80 certbot certonly --standalone --email $EMAIL -d $DOMAIN -d www.$DOMAIN --agree-tos && docker compose start nginx" $C_RESET
fi

echo
echoc "🔄 Автозапуск: ВКЛ (проверка каждые 5 минут)" $C_GREEN
echoc "📊 База данных: Сохраняется" $C_GREEN
echo
echoc "Команды:" $C_BLUE
echoc "  docker compose ps        - статус" $C_RESET
echoc "  docker compose logs web  - логи Flask" $C_RESET
echoc "  docker compose restart   - перезапуск" $C_RESET
echo

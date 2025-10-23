#!/bin/bash
set -e # Немедленно выходить, если команда завершилась с ошибкой

# ANSI цвета для красивого вывода
C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_BLUE='\033[0;34m'
C_YELLOW='\033[1;33m'

# Функция для вывода сообщений
function echoc {
    echo -e "${2}${1}${C_RESET}"
}

# Функция для вывода ошибок и выхода
function error_exit {
    echoc "ОШИБКА: ${1}" $C_RED
    exit 1
}

clear
echoc "=================================================================" $C_BLUE
echoc " Мастер установки образовательной платформы (v2.0) " $C_YELLOW
echoc "=================================================================" $C_BLUE
echo

# --- Проверка зависимостей ---
echoc "1. Проверка системных зависимостей..." $C_BLUE
if ! command -v docker &> /dev/null; then
    error_exit "Docker не найден. Пожалуйста, установите Docker перед запуском."
fi
if ! command -v docker-compose &> /dev/null; then
    error_exit "Docker Compose не найден. Пожалуйста, установите Docker Compose."
fi
echoc "   Docker и Docker Compose найдены." $C_GREEN
echo

# --- Очистка предыдущих запусков ---
echoc "--> Производим полную очистку от предыдущих неудачных запусков..." $C_YELLOW
docker-compose down --remove-orphans -v &>/dev/null || true
echoc "   Очистка завершена." $C_GREEN
echo

# --- Сбор данных от пользователя ---
echoc "2. Сбор необходимой информации..." $C_BLUE
read -p "   Введите ваш домен (например, my-site.ru): " DOMAIN
if [ -z "$DOMAIN" ]; then
    error_exit "Домен не может быть пустым."
fi

read -p "   Введите ваш email (для уведомлений Let's Encrypt): " EMAIL
if [ -z "$EMAIL" ]; then
    error_exit "Email не может быть пустым."
fi

read -s -p "   Введите ваш API-ключ GigaChat (ввод скрыт для безопасности): " GIGACHAT_CREDENTIALS
echo
if [ -z "$GIGACHAT_CREDENTIALS" ]; then
    error_exit "API-ключ GigaChat не может быть пустым."
fi
echo

# --- Генерация файлов конфигурации ---
echoc "3. Генерация файлов конфигурации..." $C_BLUE
echoc "   - Создание файла .env..." $C_GREEN
SECRET_KEY=$(openssl rand -hex 32)
cat > .env <<EOL
FLASK_SECRET_KEY=${SECRET_KEY}
GIGACHAT_CREDENTIALS=${GIGACHAT_CREDENTIALS}
FLASK_APP=app.py
EOL

echoc "   - Создание nginx/production.conf из шаблона..." $C_GREEN
sed "s/%%DOMAIN%%/${DOMAIN}/g" nginx/nginx.conf.template > nginx/production.conf
echoc "   Файлы успешно созданы." $C_GREEN
echo

# --- Проверка DNS ---
echoc "4. Проверка DNS-записей для домена $DOMAIN..." $C_BLUE
PUBLIC_IP=$(curl -s http://ipinfo.io/ip)
DOMAIN_IP=$(dig +short $DOMAIN @8.8.8.8)

echoc "   - IP вашего сервера: ${PUBLIC_IP}" $C_YELLOW
echoc "   - IP, на который указывает домен ${DOMAIN}: ${DOMAIN_IP}" $C_YELLOW

if [ "$PUBLIC_IP" != "$DOMAIN_IP" ]; then
    echoc "   ВНИМАНИЕ: IP-адреса не совпадают!" $C_RED
    read -p "   Certbot, скорее всего, не сможет выпустить сертификат. Хотите продолжить? (y/N) " decision
    if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
        error_exit "Установка прервана. Пожалуйста, обновите А-запись для вашего домена, чтобы она указывала на ${PUBLIC_IP}."
    fi
else
    echoc "   DNS-записи в порядке." $C_GREEN
fi
echo

# --- Получение SSL сертификата ---
echoc "5. Получение SSL-сертификата от Let's Encrypt..." $C_BLUE

echoc "   - Создание временного сертификата..." $C_GREEN
docker-compose run --rm --entrypoint "\
  sh -c 'mkdir -p /etc/letsencrypt/live/${DOMAIN} && \
  openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
    -subj /CN=localhost'" certbot

echoc "   - Запуск Nginx..." $C_GREEN
docker-compose up --force-recreate -d nginx

echoc "   - Удаление временного сертификата..." $C_GREEN
docker-compose run --rm --entrypoint "rm -Rf /etc/letsencrypt/live/${DOMAIN}" certbot

echoc "   - Запрос настоящего сертификата..." $C_GREEN
docker-compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    --email $EMAIL \
    -d $DOMAIN -d www.$DOMAIN \
    --rsa-key-size 4096 \
    --agree-tos \
    --force-renewal" certbot

echoc "   - Перезагрузка Nginx с новым сертификатом..." $C_GREEN
docker-compose exec nginx nginx -s reload
echo

# --- Финальный запуск ---
echoc "6. Запуск всех сервисов проекта..." $C_BLUE
docker-compose up -d --remove-orphans
echo

echoc "=================================================================" $C_BLUE
echoc " УСТАНОВКА УСПЕШНО ЗАВЕРШЕНА! " $C_GREEN
echoc "=================================================================" $C_BLUE
echoc "Ваш сайт должен быть доступен по адресу: https://${DOMAIN}" $C_YELLOW
echo
echoc "ВАЖНО: Добавьте задачу в cron для автоматического обновления сертификата." $C_YELLOW
echoc "Выполните 'crontab -e' и добавьте следующую строку:" $C_RESET
echoc "0 1,13 * * * cd $(pwd) && docker-compose run --rm certbot renew && docker-compose exec nginx nginx -s reload" $C_GREEN
echo

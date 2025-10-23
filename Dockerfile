# Используем официальный образ Python
FROM python:3.11-slim

# Устанавливаем рабочую директорию внутри контейнера
WORKDIR /app

# Копируем файл с зависимостями и устанавливаем их
# Это делается отдельным шагом для использования кэширования Docker
COPY education_platform/education_platform/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь код приложения
COPY ./education_platform/education_platform .

# Устанавливаем Gunicorn для запуска приложения в production
RUN pip install gunicorn

# Открываем порт, на котором будет работать Gunicorn
EXPOSE 5000

# Команда для запуска приложения
# Gunicorn будет "связующим звеном" между Nginx и вашим Flask-приложением
# 'app:app' означает: в файле 'app.py' найти объект с именем 'app'
CMD ["gunicorn", "--workers", "4", "--bind", "0.0.0.0:5000", "app:app"]

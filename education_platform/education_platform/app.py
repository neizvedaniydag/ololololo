from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_bcrypt import Bcrypt
from gigachat import GigaChat
from models import db, User, TestResult, PhysicalEducationResult, Schedule, Homework
import json
import os

# Загрузка тем из JSON
def load_subjects_topics():
    json_path = os.path.join(os.path.dirname(__file__), 'data', 'subjects_topics.json')
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)

SUBJECTS_TOPICS = load_subjects_topics()
app = Flask(__name__)

# Загружаем конфигурацию из переменных окружения
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'a_default_secret_key_for_development')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///instance/education_platform.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['GIGACHAT_CREDENTIALS'] = os.environ.get('GIGACHAT_CREDENTIALS')

# Инициализация
db.init_app(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Создание БД
with app.app_context():
    db.create_all()




@app.route('/api/subjects-topics')
def get_subjects_topics():
    return jsonify(SUBJECTS_TOPICS)


# РЕГИСТРАЦИЯ
@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')

        if User.query.filter_by(email=email).first():
            flash('Email уже используется', 'error')
            return redirect(url_for('register'))

        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
        user = User(username=username, email=email, password=hashed_password)
        db.session.add(user)
        db.session.commit()

        flash('Регистрация успешна', 'success')
        return redirect(url_for('login'))

    return render_template('register.html')

# ВХОД
@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        user = User.query.filter_by(email=email).first()

        if user and bcrypt.check_password_hash(user.password, password):
            login_user(user)
            return redirect(url_for('dashboard'))
        else:
            flash('Неверный email или пароль', 'error')

    return render_template('login.html')

# ВЫХОД
@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

# ГЛАВНАЯ
@app.route('/')
@login_required
def dashboard():
    tests = TestResult.query.filter_by(user_id=current_user.id).order_by(TestResult.created_at.desc()).limit(10).all()
    pe_results = PhysicalEducationResult.query.filter_by(user_id=current_user.id).order_by(PhysicalEducationResult.created_at.desc()).limit(10).all()
    return render_template('dashboard.html', tests=tests, pe_results=pe_results)

# ГЕНЕРАТОР ТЕСТОВ - СТРАНИЦА
@app.route('/tests')
@login_required
def tests():
    user_tests = TestResult.query.filter_by(user_id=current_user.id).order_by(TestResult.created_at.desc()).all()
    return render_template('tests.html', tests=user_tests)

@app.route('/privacy-policy')
def privacy_policy():
    return render_template('privacy_policy.html')


# API ГЕНЕРАЦИИ ТЕСТА
@app.route('/api/generate-test', methods=['POST'])
@login_required
def api_generate_test():
    data = request.json
    subject = data.get('subject')
    topic = data.get('topic')
    custom_text = data.get('custom_text', '')
    num_questions = data.get('num_questions', 10)

    try:
        with GigaChat(
            credentials=app.config['GIGACHAT_CREDENTIALS'],
            verify_ssl_certs=False,
            scope="GIGACHAT_API_PERS",
            temperature=0.3
        ) as giga:

            # ЕДИНЫЙ ПРОМПТ с четкими инструкциями
            if custom_text:
                prompt = f"""Ты - эксперт по созданию тестов. Создай тест из {num_questions} вопросов по тексту:

{custom_text}

ВАЖНО:
- correct - это ИНДЕКС от 0 до 3
- 0 = первый вариант, 1 = второй, 2 = третий, 3 = четвертый
- В explanation первым делом укажи какой вариант правильный

ПРИМЕР ПРАВИЛЬНОГО JSON:
{{
  "questions": [
    {{
      "question": "Какая планета ближайшая к Солнцу?",
      "options": ["Меркурий", "Венера", "Земля", "Марс"],
      "correct": 0,
      "explanation": "Правильный ответ - Меркурий (первый вариант). Меркурий находится ближе всего к Солнцу на расстоянии 58 млн км. Венера - вторая планета. Земля - третья. Марс - четвертая."
    }}
  ]
}}

Верни ТОЛЬКО JSON без пояснений:"""
            else:
                prompt = f"""Создай тест: предмет "{subject}", тема "{topic}", {num_questions} вопросов.

СТРОГИЙ ФОРМАТ:
- correct = индекс 0-3 (0-первый, 1-второй, 2-третий, 3-четвертый)
- В explanation сначала пиши КАКОЙ вариант правильный

ПРИМЕР:
{{
  "questions": [
    {{
      "question": "Сколько будет 2+2?",
      "options": ["3", "4", "5", "6"],
      "correct": 1,
      "explanation": "Правильный ответ - 4 (второй вариант). Это базовая операция сложения: 2+2=4. Вариант 3 неверен, так как 2+1=3. Вариант 5 неверен, так как 2+3=5. Вариант 6 неверен, так как 2+4=6."
    }}
  ]
}}

Верни ТОЛЬКО JSON:"""

            response = giga.chat(prompt)
            content = response.choices[0].message.content.strip()

            print("=" * 80)
            print("GIGACHAT ОТВЕТ:")
            print(content[:800])
            print("=" * 80)

            # Очистка
            content = content.replace('``````', '').strip()

            json_start = content.find('{')
            json_end = content.rfind('}') + 1

            if json_start == -1 or json_end <= json_start:
                return jsonify({'success': False, 'error': 'Нет JSON в ответе'}), 500

            json_str = content[json_start:json_end]

            try:
                test_data = json.loads(json_str)
            except json.JSONDecodeError as je:
                print(f"❌ JSON error: {je}")
                print(f"Проблемный JSON: {json_str[:200]}")
                return jsonify({'success': False, 'error': f'Невалидный JSON'}), 500

            if 'questions' not in test_data or not test_data['questions']:
                return jsonify({'success': False, 'error': 'Нет вопросов'}), 500

            # ВАЛИДАЦИЯ + АВТОИСПРАВЛЕНИЕ
            valid_questions = []
            for i, q in enumerate(test_data['questions'], 1):
                if not all(k in q for k in ['question', 'options', 'correct', 'explanation']):
                    print(f"⚠️ Вопрос {i}: пропущены поля")
                    continue

                if len(q['options']) != 4:
                    print(f"⚠️ Вопрос {i}: не 4 варианта")
                    continue

                correct_idx = q['correct']

                # Проверка индекса
                if not isinstance(correct_idx, int) or not (0 <= correct_idx <= 3):
                    print(f"⚠️ Вопрос {i}: bad correct={correct_idx}, fix to 0")
                    q['correct'] = 0
                    correct_idx = 0

                # УМНАЯ ПРОВЕРКА: ищем в explanation упоминание правильного варианта
                expl = q['explanation'].lower()
                correct_option = q['options'][correct_idx].lower()

                # Проверяем что правильный вариант действительно в explanation
                if correct_option not in expl[:300]:
                    # Ищем какой вариант упоминается как правильный
                    for idx, opt in enumerate(q['options']):
                        if opt.lower() in expl[:200] and 'правильн' in expl[:200]:
                            print(f"🔧 Вопрос {i}: FIX correct {correct_idx}→{idx} (по explanation)")
                            q['correct'] = idx
                            break

                # Минимальная длина explanation
                if len(q['explanation']) < 30:
                    q['explanation'] = f"Правильный ответ: {q['options'][q['correct']]}."

                valid_questions.append(q)

            if len(valid_questions) < 3:
                return jsonify({'success': False, 'error': f'Мало вопросов: {len(valid_questions)}'}), 500

            test_data['questions'] = valid_questions[:num_questions]

            print(f"✅ Сохраняем {len(test_data['questions'])} вопросов")

            new_test = TestResult(
                user_id=current_user.id,
                subject=subject if not custom_text else "Пользовательский материал",
                topic=topic if not custom_text else "Тест из загруженного текста",
                test_content=json.dumps(test_data, ensure_ascii=False)
            )
            db.session.add(new_test)
            db.session.commit()

            return jsonify({
                'success': True,
                'test_id': new_test.id,
                'questions_count': len(test_data['questions'])
            })

    except Exception as e:
        print(f"❌ ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ПРОХОЖДЕНИЕ ТЕСТА
@app.route('/test/<int:test_id>')
@login_required
def take_test(test_id):
    test = TestResult.query.get_or_404(test_id)
    if test.user_id != current_user.id:
        return redirect(url_for('dashboard'))

    test_data = json.loads(test.test_content)
    return render_template('take_test.html', test=test, test_data=test_data)

# ПРОВЕРКА ТЕСТА
@app.route('/test/<int:test_id>/check', methods=['POST'])
@login_required
def check_test(test_id):
    test = TestResult.query.get_or_404(test_id)
    if test.user_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    test_data = json.loads(test.test_content)
    user_answers = request.json.get('answers', {})

    correct_count = 0
    total = len(test_data['questions'])

    for i, question in enumerate(test_data['questions']):
        user_answer = user_answers.get(str(i))
        if user_answer is not None and int(user_answer) == question['correct']:
            correct_count += 1

    score = round((correct_count / total) * 100) if total > 0 else 0

    # Сохраняем оценку
    test.score = score
    db.session.commit()

    return jsonify({
        'score': score,
        'correct': correct_count,
        'total': total
    })

# УДАЛЕНИЕ ТЕСТА
@app.route('/api/test/<int:test_id>', methods=['DELETE'])
@login_required
def delete_test(test_id):
    test = TestResult.query.filter_by(id=test_id, user_id=current_user.id).first()
    if not test:
        return jsonify({'success': False, 'error': 'Test not found'}), 404

    db.session.delete(test)
    db.session.commit()

    return jsonify({'success': True})

# ФИЗКУЛЬТУРА
@app.route('/physical-education')
@login_required
def physical_education():
    return render_template('physical_education.html')

# СОХРАНЕНИЕ РЕЗУЛЬТАТОВ ФИЗКУЛЬТУРЫ
@app.route('/api/save-pe-result', methods=['POST'])
@login_required
def save_pe_result():
    data = request.get_json()

    pe_result = PhysicalEducationResult(
        user_id=current_user.id,
        exercise_type=data.get('exercise_type'),
        repetitions=data.get('repetitions', 0),
        correct_count=data.get('correct_count', 0),
        incorrect_count=data.get('incorrect_count', 0),
        errors=json.dumps(data.get('errors', []), ensure_ascii=False),
        score=data.get('score', 0)
    )
    db.session.add(pe_result)
    db.session.commit()

    return jsonify({'status': 'success', 'id': pe_result.id})

# API для получения тем
@app.route('/api/topics/<subject>')
def get_topics(subject):
    topics = SUBJECTS_TOPICS.get(subject, [])
    return jsonify({'topics': topics})

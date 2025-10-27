export const pushup = {
    name: 'pushup',
    title: 'Отжимания',
    defaultReps: 10,

    instructions: [
        'Упор лежа на прямых руках',
        'Тело образует прямую линию',
        'Опуститесь грудью почти до пола',
        'Локти согнуты на 90 градусов',
        'Выпрямите руки полностью'
    ],

    svgIcons: {
        bodyDown: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 10 L32 40 M26 34 L32 40 L38 34" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="42" width="8" height="3"/></svg>',
        bodyUp: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 40 L32 10 M26 16 L32 10 L38 16" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="8" width="8" height="3"/></svg>',
        bodyStraight: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><rect x="20" y="28" width="24" height="4"/><circle cx="20" cy="30" r="3"/><circle cx="44" cy="30" r="3"/></svg>',
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
    },

    thresholds: {
        // РЕАЛЬНЫЕ углы для MediaPipe Pose
        elbowDown: 120,          // Опускание засчитывается при угле меньше 120°
        elbowDownGood: 90,       // Идеальная глубина (меньше 90° - отлично)
        elbowUp: 160,            // Подъем засчитывается при угле больше 160°
        
        // Упрощенная проверка прямой линии тела
        bodyAngleMin: 140,       // Минимум (если меньше - сильный прогиб)
        bodyAngleMax: 200        // Максимум (если больше - таз очень высоко)
    },

    getInitialState() {
        return { position: 'up', wasDeep: false };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        // Средний угол локтей
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = (elbowLeft + elbowRight) / 2;
        
        // Средний угол тела
        const bodyLeft = calcAngle(lm[11], lm[23], lm[25]);
        const bodyRight = calcAngle(lm[12], lm[24], lm[26]);
        const bodyAngle = (bodyLeft + bodyRight) / 2;

        let result = { counted: false, correct: false, status: 'Готов' };

        // ===== ФАЗА ОПУСКАНИЯ =====
        if (elbow < this.thresholds.elbowDown && state.position === 'up') {
            state.position = 'down';
            result.counted = true;
            result.status = 'Опустились';

            // Проверяем глубину
            const isDeep = elbow < this.thresholds.elbowDownGood;
            state.wasDeep = isDeep;

            // Проверяем положение тела (но не очень строго)
            const bodyOk = bodyAngle >= this.thresholds.bodyAngleMin && 
                          bodyAngle <= this.thresholds.bodyAngleMax;

            if (!bodyOk) {
                if (bodyAngle < this.thresholds.bodyAngleMin) {
                    showHint('Не прогибайте спину!', this.svgIcons.bodyStraight, 'rgba(245, 158, 11, 0.95)');
                    logError('Прогиб в спине');
                } else {
                    showHint('Опустите таз ниже!', this.svgIcons.bodyStraight, 'rgba(245, 158, 11, 0.95)');
                    logError('Таз слишком высоко');
                }
                result.correct = false;
            } 
            else if (!isDeep) {
                showHint('Можно глубже! Но засчитано', this.svgIcons.bodyDown, 'rgba(245, 158, 11, 0.95)');
                result.correct = true;  // ВСЁ РАВНО ЗАСЧИТЫВАЕМ!
            } 
            else {
                showHint('Отлично! Выпрямляйтесь', this.svgIcons.bodyUp, 'rgba(16, 185, 129, 0.95)');
                result.correct = true;
            }
        } 
        // ===== ФАЗА ПОДЪЕМА =====
        else if (elbow > this.thresholds.elbowUp && state.position === 'down') {
            state.position = 'up';
            
            if (state.wasDeep) {
                showHint('Готов! Можно продолжать', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
            } else {
                showHint('Готов к следующему', this.svgIcons.bodyDown);
            }
            
            result.status = 'Готов';
            state.wasDeep = false;
        }
        // ===== ПРОМЕЖУТОЧНЫЕ СОСТОЯНИЯ =====
        else {
            if (state.position === 'up') {
                if (elbow < 170) {
                    result.status = 'Опускайтесь...';
                }
            } else {
                if (elbow < 140) {
                    result.status = 'Выпрямляйтесь...';
                }
            }
        }

        return result;
    }
};
